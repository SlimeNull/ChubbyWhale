// The pet's body: idle life (gaze, activities, walking), docking at screen
// sides, dragging/throwing reactions, poking, sleep.
import { listen } from "@tauri-apps/api/event";
import { engine } from "../audio/engine";
import { playSfx } from "../audio/sfx";
import { playVoice, type VoiceKind } from "../audio/voice";
import { ipc, type MotionEvent, type Rect } from "../ipc";
import type { Memory } from "../brain/memory";
import type { Voice } from "../brain/lines";
import type { Bubble } from "./bubble";
import { ACTIVITIES, PEEK_MOTIONS, type Activity, type PeekMotion } from "./activities";
import type { Fx, FxKind } from "./fx";
import { GazeController } from "./gaze";
import type { PoseName, Rig } from "./rig";

export type Emotion = "neutral" | "happy" | "cheer" | "curious" | "shocked" | "shy" | "look" | "hurt" | "sleepy" | "watch";
export const EMOTIONS: Emotion[] = ["neutral", "happy", "cheer", "curious", "shocked", "shy", "look", "hurt", "sleepy", "watch"];

const EMOTION_POSE: Record<Emotion, PoseName> = {
  neutral: "idle",
  happy: "happy",
  cheer: "cheer",
  curious: "curious",
  shocked: "shocked",
  shy: "shy",
  look: "look",
  hurt: "hurt",
  sleepy: "yawn",
  watch: "watch",
};

const EMOTION_FX: Partial<Record<Emotion, FxKind>> = {
  happy: "note",
  cheer: "sparkle",
  curious: "question",
  shocked: "exclaim",
  shy: "heart",
  hurt: "sweat",
};

const EMOTION_VOICE: Record<Emotion, VoiceKind> = {
  neutral: "neutral",
  happy: "happy",
  cheer: "cheer",
  curious: "curious",
  shocked: "surprised",
  shy: "shy",
  look: "curious",
  hurt: "hurt",
  sleepy: "sleepy",
  watch: "neutral",
};

/** One way of reacting to something; each situation has several, picked at random. */
interface Reaction {
  pose: PoseName;
  voice: VoiceKind;
  /** Line kind from the line bank. */
  line?: string;
  /** Chance of saying the line (default 1). */
  talk?: number;
  fx?: FxKind;
  fxCount?: number;
  jump?: number;
  squash?: [number, number];
  /** While hanging: >1 floppy, <1 stiff. */
  looseness?: number;
  /** In flight: tumble instead of tilting with the velocity. */
  spin?: boolean;
  /** Stars circling her head. */
  dizzy?: boolean;
}

const REACTIONS = {
  poke: [
    { pose: "shy", voice: "shy", line: "poke", fx: "heart", squash: [1.12, 0.88] },
    { pose: "giggle", voice: "giggle", line: "pokeGiggle", fx: "note", fxCount: 2, jump: 8 },
    { pose: "shocked", voice: "surprised", line: "pokeSurprised", fx: "exclaim", jump: 22 },
    { pose: "happy", voice: "happy", line: "pokeHappy", fx: "sparkle", jump: 26 },
    { pose: "curious", voice: "curious", line: "pokeCurious", fx: "question", squash: [0.94, 1.06] },
  ],
  pokeSpam: [
    { pose: "pout", voice: "angry", line: "pokeSpam", fx: "anger", squash: [1.15, 0.85] },
    { pose: "shocked", voice: "angry", line: "pokeSpam", fx: "anger", jump: 18 },
  ],
  drag: [
    { pose: "dragged", voice: "scared", line: "dragStart", talk: 0.5, fx: "sweat" },
    { pose: "dragged_happy", voice: "happy", line: "dragHappy", talk: 0.5, fx: "note", looseness: 1.3 },
    { pose: "dragged_grumpy", voice: "angry", line: "dragGrumpy", talk: 0.5, fx: "anger", looseness: 0.6 },
    { pose: "dragged_limp", voice: "sigh", line: "dragLimp", talk: 0.4, looseness: 1.8 },
  ],
  fly: [
    { pose: "fly", voice: "scared", line: "throw", talk: 0.5 },
    { pose: "fly_happy", voice: "fly", line: "flyHappy", talk: 0.5, fx: "sparkle" },
    { pose: "fly_ball", voice: "scared", line: "flyBall", talk: 0.4, spin: true },
  ],
  hurt: [
    { pose: "hurt", voice: "hurt", line: "hurt", dizzy: true },
    { pose: "hurt_cry", voice: "cry", line: "hurtCry", fx: "sweat", fxCount: 2 },
    // The art already has spiral eyes and stars.
    { pose: "hurt_dizzy", voice: "dizzy", line: "hurtDizzy" },
  ],
  // Poked while peeking from a screen side.
  pokePeek: [
    { pose: "peek_smile", voice: "giggle", line: "pokePeek", fx: "heart" },
    { pose: "peek_wave", voice: "happy", line: "pokePeek", fx: "note" },
    { pose: "peek", voice: "surprised", line: "pokePeek", fx: "exclaim", squash: [1.1, 0.9] },
  ],
  land: [
    { pose: "proud", voice: "cheer", line: "landProud", talk: 0.7, fx: "sparkle" },
    { pose: "happy", voice: "happy", line: "softLanding", talk: 0.6, fx: "note", jump: 14 },
    { pose: "cheer", voice: "cheer", line: "softLanding", talk: 0.4, fx: "sparkle" },
  ],
} satisfies Record<string, Reaction[]>;

type ReactionKind = keyof typeof REACTIONS;

/**
 * State machine. Two parts:
 *
 *   place — where she is: "floor" (standing, or floating where she was dropped)
 *           or docked at the "left" / "right" screen side, peeking.
 *   mode  — what she's doing: "idle" (at rest) | "action" (an idle motion,
 *           activity, walk, reaction or talking pose) | "drag" (held) | "fly"
 *           (thrown) | "sleep".
 *
 *   idle ⇄ action      every behavior starts through begin(), which refuses it
 *                      unless it's allowed at the current place (see ON_FLOOR /
 *                      DOCKED / ANYWHERE) and she isn't held or flying
 *   idle/action/sleep → drag     drag-start; leaves the dock
 *   drag → idle@floor (drop) | fly (throw) | idle@left/right (dropped against a side)
 *   fly → action@floor (hurt / landing reaction) → idle
 *   idle/action → sleep (user away) → idle (wake), at the same place
 *
 * Returning to rest (toRest) always restores the place's rest pose, and for a
 * dock its exact edge position, so an interrupted motion can't leave her stuck.
 */
type Mode = "idle" | "action" | "drag" | "fly" | "sleep";
type Place = "floor" | "left" | "right";

const ON_FLOOR: Place[] = ["floor"];
const DOCKED: Place[] = ["left", "right"];
const ANYWHERE: Place[] = ["floor", "left", "right"];

const WALK_STEPS_PER_SEC = 2;
const RUN_STEPS_PER_SEC = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const chance = (p: number) => Math.random() < p;

export class Pet {
  private _mode: Mode = "idle";
  private place: Place = "floor";
  /** How far she is currently tucked behind the edge while docked (px). */
  private dockHide = 0;
  private token = 0;
  private nextIdleAction = performance.now() + 6000;
  private pokes: number[] = [];
  private grab = { x: 150, y: 200 };
  private lastDragVx = 0;
  private lastHitRects = "";
  private lastReaction: Partial<Record<ReactionKind, number>> = {};
  private lastActivity = "";
  private flight: Reaction | null = null;
  private lastBoing = 0;
  /** Timers owned by the current animation (activity effects, swaying); cleared on interruption. */
  private animTimers: number[] = [];
  private gaze: GazeController;
  /** Called whenever she says something, so the brain can remember it. */
  onSaid: (text: string, kind: string) => void = () => {};
  /** Called when the user pokes her (the brain may want to chat back). */
  onPoke: () => void = () => {};

  constructor(
    private rig: Rig,
    private fx: Fx,
    private bubble: Bubble,
    private voice: Voice,
    private memory: Memory,
  ) {
    this.gaze = new GazeController(rig);
    this.gaze.onShift = () => this.blinkOnce();
  }

  async start() {
    this.bindPointer();
    this.blinkLoop();
    setInterval(() => this.mouth(), 110);
    setInterval(() => this.idleTick(), 1000);
    setInterval(() => this.syncHitRects(), 80);
    setInterval(() => this.gaze.update(this.mode === "idle" && this.place === "floor" && this.rig.pose === "idle" && !this.bubble.talking), 120);
    this.bubble.onChange = () => this.placeBubble();
    this.rig.app.ticker.add(() => this.bubble.visible && this.placeBubble());
    // The window is resized when the pet size changes; the physics body (and a dock) follow.
    window.addEventListener("resize", () => {
      ipc.setBody(this.rig.bodyRect());
      if (this.docked) this.dockAt(this.docked, this.dockHide);
    });

    await ipc.setBody(this.rig.bodyRect());
    await listen<MotionEvent>("pet-motion", (e) => this.onMotion(e.payload));
    await listen<[number, number]>("pet-cursor", (e) => this.gaze.onCursor(e.payload[0], e.payload[1]));
  }

  get mode(): Mode {
    return this._mode;
  }

  /** Screen side she is hiding at, or null on the floor. */
  get docked(): "left" | "right" | null {
    return this.place === "floor" ? null : this.place;
  }

  /** Busy = shouldn't be interrupted by unprompted remarks. Resting while docked counts as free. */
  get busy() {
    return this.mode !== "idle" || this.bubble.visible;
  }

  get sleeping() {
    return this.mode === "sleep";
  }

  /** The pose she returns to: standing, or peeking when docked. */
  private get restPose(): PoseName {
    return this.docked ? "peek" : "idle";
  }

  // ---------- state machine core ----------

  /**
   * Start a behavior if it's allowed here and now. Returns its token (compare
   * with this.token later to know whether it was interrupted), or null if refused.
   * `preempt`: may interrupt another action (reactions, talking); idle motions may not.
   */
  private begin(places: Place[], preempt = true): number | null {
    if (!places.includes(this.place)) return null;
    if (this.mode === "drag" || this.mode === "fly") return null;
    if (!preempt && this.mode !== "idle") return null;
    if (this.mode === "sleep") this.fx.sleeping = false;
    this.stopAnims();
    this._mode = "action";
    return ++this.token;
  }

  /** Back to rest at the current place (rest pose, exact dock position, eyes forward). */
  private toRest(pop = true) {
    this.stopAnims();
    this.token++;
    this._mode = "idle";
    this.rig.setPose(this.restPose, pop);
    this.rig.flip = this.place === "left";
    this.rig.bob = 0;
    this.rig.breathRate = 1;
    this.rig.leanTarget = 0;
    if (this.docked && this.dockHide !== 0) this.dockAt(this.docked, 0);
    this.gaze.rest();
    this.nextIdleAction = performance.now() + rand(7000, 16000);
  }

  /** Hold a pose for a while, then return to rest — if allowed at the current place. */
  async act(pose: PoseName, ms: number, setup?: () => void, places = ANYWHERE): Promise<boolean> {
    const my = this.begin(places);
    if (my === null) return false;
    this.rig.setPose(pose);
    setup?.();
    await sleep(ms);
    if (my !== this.token) return false;
    this.toRest();
    return true;
  }

  /** Stop frame cycles (walk, chewing…) and the current animation's timers. */
  private stopAnims() {
    this.rig.stopCycle();
    this.animTimers.forEach((t) => clearInterval(t));
    this.animTimers = [];
  }

  // ---------- talking ----------

  /** Say a line with an emotion; holds a matching pose (for this place) while the bubble is up. */
  say(text: string, emotion: Emotion = "neutral", kind = "say", ms?: number) {
    this.bubble.show(text, ms);
    this.onSaid(text, kind);
    playVoice(EMOTION_VOICE[emotion]);
    if (this.mode === "drag" || this.mode === "fly") return;
    if (this.mode === "sleep") this.wake(false);
    const fx = EMOTION_FX[emotion];
    if (fx) this.fx.emit(fx, fx === "note" || fx === "heart" ? 2 : 1);
    const hold = Math.min(5000, ms ?? Math.min(9000, 2600 + text.length * 160) + text.length * 55);
    if (this.docked) {
      // Stay hidden; only the face changes.
      const happy = emotion === "happy" || emotion === "cheer" || emotion === "shy";
      this.act(happy ? "peek_smile" : "peek", hold, undefined, DOCKED);
      return;
    }
    const pose = EMOTION_POSE[emotion];
    if (pose === "idle") this.rig.jump(10);
    else this.act(pose, hold, undefined, ON_FLOOR);
  }

  /** Say a line from the bank. */
  speak(kind: string, vars: Record<string, string | number> = {}) {
    const { text, emotion } = this.voice.line(kind, vars);
    this.say(text, emotion, kind);
  }

  /** Line from the bank in a bubble, without changing her pose. */
  private mutter(kind: string, chanceToSay = 1) {
    if (!chance(chanceToSay)) return;
    const { text } = this.voice.line(kind);
    this.bubble.show(text);
    this.onSaid(text, kind);
  }

  /**
   * Pick a variant for `kind` (never the same one twice in a row, and only
   * poses that exist) and play its pose, effects, voice and maybe a line.
   */
  private react(kind: ReactionKind, vars: Record<string, string | number> = {}, bubbleMs?: number): Reaction {
    const options: Reaction[] = REACTIONS[kind];
    const usable = options.map((r, i) => [r, i] as const).filter(([r]) => this.rig.has(r.pose));
    const fresh = usable.filter(([, i]) => i !== this.lastReaction[kind]);
    const pool = fresh.length ? fresh : usable;
    const [r, i] = pool[Math.floor(Math.random() * pool.length)] ?? [options[0], 0];
    this.lastReaction[kind] = i;

    this.rig.setPose(r.pose);
    if (r.squash) this.rig.squash(...r.squash);
    if (r.jump) this.rig.jump(r.jump);
    if (r.fx) this.fx.emit(r.fx, r.fxCount ?? 1);
    if (r.dizzy) this.fx.startDizzy(3.2);
    playVoice(r.voice);
    if (r.line && chance(r.talk ?? 1)) {
      const { text } = this.voice.line(r.line, vars);
      this.bubble.show(text, bubbleMs);
      this.onSaid(text, r.line);
    }
    return r;
  }

  // ---------- sleep ----------

  sleep() {
    if (this.mode === "drag" || this.mode === "fly" || this.mode === "sleep") return;
    this.stopAnims();
    this.token++;
    this._mode = "sleep";
    this.bubble.hide();
    if (this.docked && this.dockHide !== 0) this.dockAt(this.docked, 0);
    this.rig.setPose(this.docked ? "peek_sleepy" : "sleep");
    this.rig.breathRate = 0.45;
    this.fx.sleeping = true;
    playVoice("sleepy");
  }

  wake(greet = true) {
    if (this.mode !== "sleep") return;
    this.fx.sleeping = false;
    this.toRest();
    if (greet) this.speak("wake");
  }

  // ---------- docking at a screen side ----------

  /** Hide at a screen side, peeking out (after being dropped against it). */
  private dock(side: "left" | "right") {
    this.place = side;
    this.rig.hang = null;
    this.rig.looseness = 1;
    this.dockHide = 0;
    this.toRest();
    this.rig.squash(1, 1.06);
    this.dockAt(side, 0);
    playSfx("puff");
    playVoice("curious");
    this.mutter("peekIn", 0.5);
  }

  /**
   * Slide the window so the grip edge of the peek art sits on the screen edge.
   * `hide` > 0 (px) tucks her that much further behind the edge.
   */
  private dockAt(side: "left" | "right", hide: number) {
    const e = this.rig.edge(side);
    // The screen edge lands `hide` px inside her, so that much goes off-screen.
    const x = e.x + (side === "right" ? -hide : hide);
    this.dockHide = hide;
    this.rig.clip = { side, x };
    ipc.dock(side, x, e.top, e.bottom);
  }

  private undock() {
    this.place = "floor";
    this.dockHide = 0;
    this.rig.clip = null;
  }

  // ---------- idle life ----------

  private blinkLoop() {
    const blink = async () => {
      await this.blinkOnce();
      if (chance(0.2)) {
        await sleep(140);
        await this.blinkOnce();
      }
      setTimeout(blink, rand(2200, 5600));
    };
    setTimeout(blink, 1500);
  }

  private async blinkOnce() {
    if (this.rig.pose !== "idle" || this.rig.variant === "idle_talk") return;
    this.rig.variant = "idle_blink";
    await sleep(120);
    if (this.rig.variant === "idle_blink") this.rig.variant = "";
  }

  private mouth() {
    if (this.bubble.talking && this.rig.pose === "idle") {
      this.rig.variant = this.rig.variant === "idle_talk" ? "" : "idle_talk";
    } else if (this.rig.variant === "idle_talk") {
      this.rig.variant = "";
    }
  }

  private idleTick() {
    if (this.mode !== "idle" || this.bubble.visible || performance.now() < this.nextIdleAction) return;
    // Watching the mouse move: don't wander off to something else yet.
    if (this.place === "floor" && this.gaze.watching) {
      this.nextIdleAction = performance.now() + 3000;
      return;
    }
    this.nextIdleAction = performance.now() + rand(8000, 18000);
    weighted(this.docked ? this.peekOptions() : this.floorActions().map(([, w, run]): [number, () => void] => [w, run]))();
  }

  /** What she may do by herself on the floor: [name, weight, start]. */
  floorActions(): [string, number, () => void][] {
    const hour = new Date().getHours();
    const sleepy = hour >= 23 || hour < 6;
    const at = (pose: PoseName, ms: number, setup?: () => void) => () => void this.act(pose, ms, setup, ON_FLOOR);
    return [
      ["look", 2.5, at("look", rand(2200, 3200), () => (this.rig.flip = chance(0.5)))],
      ["curious", 1.5, at("curious", 2600, () => this.fx.emit("question"))],
      ["yawn", sleepy ? 4 : 1.2, at("yawn", 2400, () => {
        this.rig.breathRate = 0.6;
        if (chance(0.4)) this.mutter("yawn");
        playVoice("sleepy");
      })],
      ["happy", 1.5, at("happy", 2600, () => {
        this.fx.emit("note", 3);
        this.rig.jump(18);
        playVoice("hum");
      })],
      ["giggle", 1, at("giggle", 2200, () => this.fx.emit("note", 2))],
      ["wander", 2.5, () => void this.wander()],
      ["watch", 1.5, at("watch", rand(9000, 18000))],
      ["bob", 0.8, at("idle", 4000, () => (this.rig.bob = 5))],
      // Everyday activities (eating, gaming, reading…), never the same one twice in a row.
      ...ACTIVITIES.filter((a) => a.id !== this.lastActivity && a.frames.every((f) => this.rig.has(f))).map(
        (a): [string, number, () => void] => [a.id, a.weight, () => void this.activity(a)],
      ),
    ];
  }

  /** What she may do by herself while docked: only small motions at the edge. */
  private peekOptions(): [number, () => void][] {
    const hour = new Date().getHours();
    return PEEK_MOTIONS.map(([m, w]): [number, () => void] => [m === "doze" && (hour >= 23 || hour < 6) ? w * 4 : w, () => void this.peek(m)]);
  }

  private async activity(a: Activity) {
    const my = this.begin(ON_FLOOR, false);
    if (my === null) return;
    this.lastActivity = a.id;
    this.rig.flip = chance(0.5);
    this.rig.setPose(a.frames[0]);
    if (a.frames.length > 1) this.rig.playCycle(a.frames, a.fps ?? 2, { stepsPerFrame: 0 });
    if (a.voiceStart) playVoice(a.voiceStart);
    if (a.line) this.mutter(a.line, a.talk ?? 0.4);
    if (a.fx) {
      const { kind, everyMs, count } = a.fx;
      this.animTimers.push(window.setInterval(() => this.fx.emit(kind, count ?? 1), everyMs));
    }
    if (a.sway) {
      let dir = 1;
      this.animTimers.push(window.setInterval(() => (this.rig.leanTarget = (dir *= -1) * a.sway!), 600));
    }
    await sleep(rand(...a.secs) * 1000);
    if (my !== this.token) return;
    if (a.voiceEnd) playVoice(a.voiceEnd);
    this.toRest();
  }

  /** Small motions while hiding at a screen side. */
  private async peek(m: PeekMotion) {
    const side = this.docked;
    if (!side) return;
    const at = (pose: PoseName, ms: number, setup?: () => void) => this.act(pose, ms, setup, DOCKED);
    switch (m) {
      case "wave":
        await at("peek_wave", 2200, () => {
          this.fx.emit("note");
          if (chance(0.5)) playVoice("happy");
        });
        break;
      case "smile":
        await at("peek_smile", 2000, () => this.fx.emit("heart"));
        break;
      case "curious":
        await at("peek", 2000, () => {
          this.fx.emit("question");
          this.rig.leanTarget = side === "right" ? -0.05 : 0.05;
        });
        break;
      case "lean-out":
        // Crane her head out from the edge; the hands stay put.
        await at("peek", rand(1500, 2500), () => {
          this.rig.leanTarget = side === "right" ? -0.09 : 0.09;
          this.fx.emit("exclaim");
        });
        break;
      case "doze":
        await at("peek_sleepy", rand(5000, 9000), () => {
          this.fx.sleeping = true;
          this.rig.breathRate = 0.5;
        });
        if (this.mode !== "sleep") this.fx.sleeping = false;
        break;
      case "tilt": {
        const my = this.begin(DOCKED, false);
        if (my === null) return;
        this.rig.setPose("peek", false);
        for (const lean of [0.05, -0.05, 0.04, 0]) {
          this.rig.leanTarget = lean;
          await sleep(450);
          if (my !== this.token) return;
        }
        this.toRest(false);
        break;
      }
      case "tuck": {
        // Duck behind the edge (only a sliver stays visible), wait, peek out again.
        // If interrupted, toRest() puts her back at the edge.
        const my = this.begin(DOCKED, false);
        if (my === null) return;
        this.rig.setPose("peek", false);
        this.dockAt(side, this.rig.edge(side).width * 0.75);
        await sleep(rand(1200, 2600));
        if (my !== this.token) return;
        this.dockAt(side, 0);
        playSfx("pop", 0.3);
        await sleep(400);
        if (my === this.token) this.toRest(false);
        break;
      }
    }
  }

  /** Walk (or sometimes run) along the bottom of the screen. */
  private async wander() {
    const my = this.begin(ON_FLOOR, false);
    if (my === null) return;
    const run = chance(0.3) && this.rig.has("run_a");
    const dir = chance(0.5) ? -1 : 1;
    const size = this.rig.height / 230;
    // Move exactly one stride per step so the planted foot doesn't slide.
    // Strides are the distance between the feet in walk_a / run_a when she is
    // 230px tall; they depend on the art, so each skin's sprite manifest has them.
    const stepsPerSec = run ? RUN_STEPS_PER_SEC : WALK_STEPS_PER_SEC;
    const { walkStride, runStride } = this.rig.motion;
    const speed = (run ? runStride : walkStride) * stepsPerSec * size;
    const dist = (run ? rand(220, 420) : rand(120, 320)) * size;
    // Keep the whole walk / run frame on screen, not just the (narrower) body.
    const frames = run ? ["run_a", "run_b"] : ["walk_a", "walk_pass", "walk_b"];
    const [l, r] = this.rig.spanX(frames, dir > 0);
    const moved = await ipc.glideBy(dir * dist, speed, true, [l - 4, r + 4]).catch(() => 0);
    if (my !== this.token) return;
    if (Math.abs(moved) < 8) {
      // Blocked by the screen edge: look that way instead.
      this.rig.setPose("look");
      this.rig.flip = dir > 0;
      await sleep(1800);
      if (my === this.token) this.toRest();
      return;
    }
    // The walk / run art faces left.
    this.rig.flip = moved > 0;
    const onStep = () => playSfx("step", run ? 0.7 : 0.4);
    if (run) {
      // Two frames, one step each; a bounce per stride.
      this.rig.playCycle(["run_a", "run_b"], stepsPerSec, { stepsPerFrame: 1, phase: 0, bob: 6, onStep });
      if (chance(0.5)) playVoice("happy");
    } else {
      // A, pass, B, pass: two steps per cycle; feet land mid-A and mid-B.
      this.rig.playCycle(["walk_a", "walk_pass", "walk_b", "walk_pass"], stepsPerSec * 2, { stepsPerFrame: 0.5, phase: 0.5, bob: 3, onStep });
    }
    await sleep((Math.abs(moved) / speed) * 1000);
    if (my !== this.token) return; // interrupted: whoever took over already stopped the walk
    this.toRest(false);
    this.rig.squash(1.08, 0.94);
  }

  // ---------- pointer & motion ----------

  private bindPointer() {
    const el = this.rig.app.canvas;
    // Commands are async, so make sure the press is registered before the release.
    let pressed: Promise<void> = Promise.resolve();
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      engine.unlock();
      el.setPointerCapture(e.pointerId);
      this.grab = { x: e.clientX, y: e.clientY };
      pressed = ipc.dragBegin().catch(() => {});
    });
    el.addEventListener("pointerup", async (e) => {
      if (e.button !== 0) return;
      await pressed;
      const r = await ipc.dragEnd();
      if (r === "click") this.poke();
      else if (r === "drop") this.dropped();
      else if (r === "throw") this.thrown();
      else if (r === "edge-left") this.dock("left");
      else if (r === "edge-right") this.dock("right");
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      ipc.showMenu();
    });
  }

  private poke() {
    this.memory.bump("pokes");
    const now = performance.now();
    this.pokes = this.pokes.filter((t) => now - t < 4000).concat(now);
    playSfx("pop");
    if (this.mode === "sleep") return this.speak("pokeAwake");
    const spam = this.pokes.length >= 4;
    const my = this.begin(ANYWHERE);
    if (my === null) return;
    if (spam) this.pokes = [];
    this.react(this.docked ? "pokePeek" : spam ? "pokeSpam" : "poke");
    if (!spam) this.onPoke();
    sleep(spam ? 2600 : 2000).then(() => my === this.token && this.toRest());
  }

  private onMotion(e: MotionEvent) {
    switch (e.kind) {
      case "drag-start": {
        this.stopAnims();
        this.undock();
        this.token++;
        this._mode = "drag";
        this.memory.bump("drags");
        this.fx.sleeping = false;
        this.fx.stopDizzy();
        this.rig.flip = false;
        this.rig.flying = false;
        this.rig.leanTarget = 0;
        this.rig.gaze = "";
        // Hold her by the collar; keep the dangling body inside the window.
        const h = this.rig.height;
        const pivot = this.rig.figure.hang;
        this.rig.hang = {
          x: Math.max(h * 0.3, Math.min(window.innerWidth - h * 0.3, this.grab.x)),
          y: Math.max(h * pivot + 10, Math.min(window.innerHeight - h * (1.02 - pivot), this.grab.y)),
        };
        this.rig.squash(0.92, 1.12);
        this.lastDragVx = 0;
        playSfx("pickup");
        const r = this.react("drag");
        this.rig.looseness = r.looseness ?? 1;
        break;
      }
      case "dragging": {
        // Swing like a pendulum against the acceleration of the cursor.
        const dv = e.vx - this.lastDragVx;
        this.lastDragVx = e.vx;
        this.rig.kickSwing(-dv * 0.0009);
        break;
      }
      case "flying":
        if (this.flight?.spin) this.rig.spin = Math.max(-14, Math.min(14, e.vx / 220)) || 4;
        else this.rig.rotationTarget = Math.max(-0.6, Math.min(0.6, e.vx / 2500));
        break;
      case "bump": {
        this.fx.pop("bump", e.side);
        if (e.side === "left" || e.side === "right") this.rig.squash(0.8, 1.12);
        else this.rig.squash(1.2, 0.8);
        const now = performance.now();
        if (now - this.lastBoing > 90) {
          this.lastBoing = now;
          playSfx("boing", e.impact / 2500);
        }
        break;
      }
      case "landed":
        this.landed(e.impact);
        break;
    }
  }

  private dropped() {
    this.place = "floor";
    this.rig.hang = null;
    this.rig.looseness = 1;
    this.toRest();
    this.rig.squash(1.1, 0.9);
    playSfx("puff");
    if (chance(0.25)) this.speak("drop");
  }

  private thrown() {
    this.place = "floor";
    this.rig.hang = null;
    this.rig.looseness = 1;
    this.rig.flying = true;
    this._mode = "fly";
    playSfx("whoosh");
    const n = this.memory.bump("throws");
    this.flight = this.react("fly");
    if (n > 3 && n % 5 === 0) {
      const { text } = this.voice.line("throwAgain", { n });
      this.bubble.show(text);
      this.onSaid(text, "throwAgain");
    }
  }

  private async landed(impact: number) {
    this.rig.flying = false;
    this.rig.hang = null;
    this.rig.spin = 0;
    this.rig.rotationTarget = 0;
    this.rig.rotation = 0;
    this.flight = null;
    this._mode = "idle";
    if (impact > 1100) {
      this.rig.squash(1.3, 0.7);
      playSfx("thud", impact / 3000);
      const my = this.begin(ON_FLOOR);
      if (my === null) return;
      const r = this.react("hurt", {}, 3200);
      if (r.dizzy || r.pose === "hurt_dizzy") playSfx("dizzy");
      await sleep(3800);
      if (my !== this.token) return;
      this.toRest();
      if (chance(0.5)) this.speak("hurtAfter");
    } else if (impact > 500) {
      this.rig.squash(1.18, 0.84);
      playSfx("softland");
      const my = this.begin(ON_FLOOR);
      if (my === null) return;
      this.react("land");
      await sleep(2200);
      if (my === this.token) this.toRest();
    } else {
      this.toRest();
      this.rig.squash(1.12, 0.9);
      playSfx("softland", 0.3);
    }
  }

  // ---------- layout ----------

  private placeBubble() {
    const h = this.rig.head();
    this.bubble.anchor(h.x, h.top, this.rig.height * this.rig.figure.headR);
  }

  private syncHitRects() {
    const b = this.rig.bounds();
    // Trim the transparent margins of the illustration a little; when docked,
    // only the part on this side of the screen edge counts.
    let [l, r] = [b.x + b.width * 0.12, b.right - b.width * 0.12];
    if (this.rig.clip) {
      if (this.rig.clip.side === "right") r = Math.min(r, this.rig.clip.x);
      else l = Math.max(l, this.rig.clip.x);
    }
    const rects: Rect[] = [[l, b.y + b.height * 0.04, r, b.bottom]];
    const key = rects.map((r) => r.map(Math.round).join(",")).join("|");
    if (key !== this.lastHitRects) {
      this.lastHitRects = key;
      ipc.setHitRects(rects);
    }
  }
}

/** Run one of the options, picked with probability proportional to its weight. */
function weighted(options: [number, () => void][]): () => void {
  let r = Math.random() * options.reduce((s, [w]) => s + w, 0);
  for (const [w, run] of options) if ((r -= w) <= 0) return run;
  return options[options.length - 1][1];
}
