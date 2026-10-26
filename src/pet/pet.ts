// The pet's body: idle behaviors, dragging/throwing reactions, poking, sleep.
import { listen } from "@tauri-apps/api/event";
import { ipc, type MotionEvent, type Rect } from "../ipc";
import type { Memory } from "../brain/memory";
import type { Voice } from "../brain/lines";
import type { Bubble } from "./bubble";
import type { Fx } from "./fx";
import type { PoseName, Rig } from "./rig";

export type Emotion = "neutral" | "happy" | "cheer" | "curious" | "shocked" | "shy" | "look" | "hurt" | "sleepy" | "watch";

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

const EMOTION_FX = {
  happy: "note",
  cheer: "sparkle",
  curious: "question",
  shocked: "exclaim",
  shy: "heart",
  hurt: "sweat",
} as const;

type Mode = "idle" | "action" | "drag" | "fly" | "sleep";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const chance = (p: number) => Math.random() < p;

export class Pet {
  mode: Mode = "idle";
  private token = 0;
  private nextIdleAction = performance.now() + 6000;
  private pokes: number[] = [];
  private grab = { x: 150, y: 200 };
  private lastDragVx = 0;
  private lastHitRects = "";
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
  ) {}

  async start() {
    this.bindPointer();
    this.blinkLoop();
    setInterval(() => this.mouth(), 110);
    setInterval(() => this.idleTick(), 1000);
    setInterval(() => this.syncHitRects(), 80);
    this.bubble.onChange = () => this.placeBubble();
    this.rig.app.ticker.add(() => this.bubble.visible && this.placeBubble());

    await ipc.setBody(this.rig.bodyRect());
    await listen<MotionEvent>("pet-motion", (e) => this.onMotion(e.payload));
    await listen<[number, number]>("pet-cursor", (e) => this.onCursor(e.payload[0]));
  }

  get busy() {
    return this.mode !== "idle" || this.bubble.visible;
  }

  get sleeping() {
    return this.mode === "sleep";
  }

  /** Say a line with an emotion; holds the matching pose while the bubble is up. */
  say(text: string, emotion: Emotion = "neutral", kind = "say", ms?: number) {
    this.bubble.show(text, ms);
    this.onSaid(text, kind);
    if (this.mode === "drag" || this.mode === "fly") return;
    if (this.mode === "sleep") this.wake(false);
    const fx = EMOTION_FX[emotion as keyof typeof EMOTION_FX];
    if (fx) this.fx.emit(fx, fx === "note" || fx === "heart" ? 2 : 1);
    const pose = EMOTION_POSE[emotion];
    const hold = ms ?? Math.min(9000, 2600 + text.length * 160) + text.length * 55;
    if (pose === "idle") {
      this.rig.jump(10);
    } else {
      this.act(pose, Math.min(hold, 5000));
    }
  }

  /** Say a line from the bank. */
  speak(kind: string, vars: Record<string, string | number> = {}) {
    const { text, emotion } = this.voice.line(kind, vars);
    this.say(text, emotion, kind);
  }

  /** Hold a pose for a while, then return to idle unless interrupted. */
  async act(pose: PoseName, ms: number, setup?: () => void) {
    const my = ++this.token;
    this.mode = "action";
    this.rig.setPose(pose);
    setup?.();
    await sleep(ms);
    if (my !== this.token) return false;
    this.toIdle();
    return true;
  }

  private toIdle(pop = true) {
    this.token++;
    this.mode = "idle";
    this.rig.setPose("idle", pop);
    this.rig.flip = false;
    this.rig.bob = 0;
    this.rig.breathRate = 1;
    this.rig.leanTarget = 0;
    this.nextIdleAction = performance.now() + rand(7000, 16000);
  }

  sleep() {
    if (this.mode === "drag" || this.mode === "fly" || this.mode === "sleep") return;
    this.token++;
    this.mode = "sleep";
    this.bubble.hide();
    this.rig.setPose("sleep");
    this.rig.breathRate = 0.45;
    this.fx.sleeping = true;
  }

  wake(greet = true) {
    if (this.mode !== "sleep") return;
    this.fx.sleeping = false;
    this.toIdle();
    if (greet) this.speak("wake");
  }

  // ---------- idle life ----------

  private blinkLoop() {
    const blink = async () => {
      if (this.rig.pose === "idle" && this.rig.variant !== "idle_talk") {
        this.rig.variant = "idle_blink";
        await sleep(120);
        if (this.rig.variant === "idle_blink") this.rig.variant = "";
        if (chance(0.2)) {
          await sleep(140);
          this.rig.variant = "idle_blink";
          await sleep(110);
          if (this.rig.variant === "idle_blink") this.rig.variant = "";
        }
      }
      setTimeout(blink, rand(2200, 5600));
    };
    setTimeout(blink, 1500);
  }

  private mouth() {
    if (this.bubble.talking && this.rig.pose === "idle") {
      this.rig.variant = this.rig.variant === "idle_talk" ? "" : "idle_talk";
    } else if (this.rig.variant === "idle_talk") {
      this.rig.variant = "";
    }
  }

  private onCursor(x: number) {
    if (this.mode !== "idle") return;
    const dx = x - this.rig.floor.x;
    this.rig.leanTarget = Math.max(-0.035, Math.min(0.035, dx / 5000));
  }

  private idleTick() {
    if (this.mode !== "idle" || this.bubble.visible || performance.now() < this.nextIdleAction) return;
    const hour = new Date().getHours();
    const sleepy = hour >= 23 || hour < 6;
    const actions: [number, () => void][] = [
      [3, () => this.act("look", rand(2200, 3200), () => (this.rig.flip = chance(0.5)))],
      [2, () => this.act("curious", 2600, () => this.fx.emit("question"))],
      [sleepy ? 4 : 1.5, () => this.act("yawn", 2400, () => {
        this.rig.breathRate = 0.6;
        if (chance(0.4)) this.speak("yawn");
      })],
      [2, () => this.act("happy", 2600, () => {
        this.fx.emit("note", 3);
        this.rig.jump(18);
      })],
      [2.5, () => this.wander()],
      [2, () => this.act("watch", rand(9000, 18000))],
      [1, () => this.act("idle", 4000, () => (this.rig.bob = 5))],
    ];
    let r = Math.random() * actions.reduce((s, [w]) => s + w, 0);
    for (const [w, run] of actions) {
      if ((r -= w) <= 0) {
        run();
        break;
      }
    }
    this.nextIdleAction = performance.now() + rand(8000, 18000);
  }

  private async wander() {
    const dir = chance(0.5) ? -1 : 1;
    const secs = rand(1.6, 2.6);
    const my = ++this.token;
    this.mode = "action";
    this.rig.flip = dir < 0;
    this.rig.leanTarget = dir * 0.05;
    this.rig.bob = 4;
    const moved = await ipc.glideBy(dir * rand(60, 180), secs).catch(() => 0);
    await sleep(Math.abs(moved) > 1 ? secs * 1000 : 300);
    if (my === this.token) this.toIdle(false);
  }

  // ---------- pointer & motion ----------

  private bindPointer() {
    const el = this.rig.app.canvas;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      this.grab = { x: e.clientX, y: e.clientY };
      pressed = ipc.dragBegin().catch(() => {});
    });
    // Commands are async, so make sure the press is registered before the release.
    let pressed: Promise<void> = Promise.resolve();
    el.addEventListener("pointerup", async (e) => {
      if (e.button !== 0) return;
      await pressed;
      const r = await ipc.dragEnd();
      if (r === "click") this.poke();
      else if (r === "drop") this.dropped();
      else if (r === "throw") this.thrown();
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
    if (this.mode === "sleep") return this.speak("pokeAwake");
    if (this.mode === "drag" || this.mode === "fly") return;
    if (this.pokes.length >= 4) {
      this.fx.emit("anger");
      this.speak("pokeSpam");
      this.pokes = [];
    } else {
      this.rig.squash(1.12, 0.88);
      this.speak("poke");
      this.onPoke();
    }
  }

  private onMotion(e: MotionEvent) {
    switch (e.kind) {
      case "drag-start": {
        this.token++;
        this.mode = "drag";
        this.memory.bump("drags");
        this.fx.sleeping = false;
        this.fx.stopDizzy();
        this.rig.flip = false;
        this.rig.flying = false;
        // Hold her by the collar; keep the dangling body inside the window.
        const h = this.rig.height;
        this.rig.hang = {
          x: Math.max(70, Math.min(window.innerWidth - 70, this.grab.x)),
          y: Math.max(h * 0.3 + 10, Math.min(window.innerHeight - h * 0.72, this.grab.y)),
        };
        this.rig.setPose("dragged");
        this.rig.squash(0.92, 1.12);
        this.lastDragVx = 0;
        if (chance(0.45)) this.speak("dragStart");
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
        this.rig.rotationTarget = Math.max(-0.6, Math.min(0.6, e.vx / 2500));
        break;
      case "bump":
        this.fx.pop("bump", e.side);
        if (e.side === "left" || e.side === "right") this.rig.squash(0.8, 1.12);
        else this.rig.squash(1.2, 0.8);
        break;
      case "landed":
        this.landed(e.impact);
        break;
    }
  }

  private dropped() {
    this.rig.hang = null;
    this.toIdle();
    this.rig.squash(1.1, 0.9);
    if (chance(0.25)) this.speak("drop");
  }

  private thrown() {
    this.rig.hang = null;
    this.rig.flying = true;
    this.mode = "fly";
    this.rig.setPose("fly");
    const n = this.memory.bump("throws");
    if (n > 3 && n % 5 === 0) this.speak("throwAgain", { n });
    else if (chance(0.6)) this.speak("throw");
  }

  private async landed(impact: number) {
    this.rig.flying = false;
    this.rig.hang = null;
    this.rig.rotationTarget = 0;
    this.rig.rotation = 0;
    this.mode = "idle";
    if (impact > 1100) {
      this.rig.squash(1.3, 0.7);
      this.fx.startDizzy(3.2);
      const my = ++this.token;
      this.mode = "action";
      this.rig.setPose("hurt");
      const { text } = this.voice.line("hurt");
      this.bubble.show(text, 3200);
      this.onSaid(text, "hurt");
      await sleep(3800);
      if (my !== this.token) return;
      this.toIdle();
      if (chance(0.5)) this.speak("hurtAfter");
    } else {
      this.toIdle();
      this.rig.squash(1.18, 0.84);
      if (impact > 500 && chance(0.6)) this.speak("softLanding");
    }
  }

  // ---------- layout ----------

  private placeBubble() {
    const h = this.rig.head();
    this.bubble.anchor(h.x, h.top);
  }

  private syncHitRects() {
    const b = this.rig.bounds();
    // Trim the transparent margins of the illustration a little.
    const body: Rect = [b.x + b.width * 0.12, b.y + b.height * 0.04, b.right - b.width * 0.12, b.bottom];
    const rects: Rect[] = [body];
    const br = this.bubble.rect();
    if (br) rects.push(br);
    const key = rects.map((r) => r.map(Math.round).join(",")).join("|");
    if (key !== this.lastHitRects) {
      this.lastHitRects = key;
      ipc.setHitRects(rects);
    }
  }
}
