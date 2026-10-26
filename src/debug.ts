// Dev-only helpers: forward errors to a log file and, with VITE_PET_DEMO=1,
// cycle through every pose and save a canvas snapshot of each.
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Rectangle } from "pixi.js";
import { ipc, type MotionEvent } from "./ipc";
import type { Fx } from "./pet/fx";
import type { Pet } from "./pet/pet";
import type { Activity, PeekMotion } from "./pet/activities";
import type { PoseName, Rig } from "./pet/rig";

const dump = (name: string, data: string) => invoke("debug_dump", { name, data }).catch(() => {});

export function installDebug(rig: Rig, pet: Pet, fx: Fx) {
  const log = (level: string, args: unknown[]) =>
    dump("log.txt", `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
  for (const level of ["error", "warn"] as const) {
    const orig = console[level];
    console[level] = (...args: unknown[]) => {
      log(level, args);
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => log("uncaught", [e.error ?? e.message]));
  installPanelBridge(rig, pet);
  window.addEventListener("unhandledrejection", (e) => log("unhandled", [e.reason]));
  log("info", ["debug installed", { dpr: devicePixelRatio, w: innerWidth, h: innerHeight }]);

  if (import.meta.env.VITE_PET_DEMO === "throw") return throwTest(log);
  if (import.meta.env.VITE_PET_DEMO === "bubble") {
    // Bubble placement: at the bottom (above her head) and pushed up into the menu bar (beside her head).
    setTimeout(async () => {
      const text = "你好呀，我是大肥鱼~ 今天也要元气满满地陪你一起工作哦！";
      for (const [name, to] of [["bottom", null], ["top", [300, -60]]] as const) {
        if (to) log("info", [name, "moved", await invoke("debug_windows", { to })]);
        pet.say(text, "happy");
        await new Promise((r) => setTimeout(r, 1200));
        log("info", [name, await invoke("debug_windows", { to: null }), { head: rig.head(), height: rig.height }]);
      }
      log("info", ["bubble done"]);
    }, 3000);
    // rAF is paused while the display sleeps; keep the renderer ticking for this test.
    setInterval(() => rig.app.ticker.update(performance.now()), 16);
    return;
  }
  if (import.meta.env.VITE_PET_DEMO === "dock") return dockTest(rig, pet, log);
  if (import.meta.env.VITE_PET_DEMO === "gaze") return gazeFilm(rig, pet, log);
  if (import.meta.env.VITE_PET_DEMO === "follow") return followTest(rig, pet, log);
  if (import.meta.env.VITE_PET_DEMO === "panel") {
    // Smoke test: replay the panel's commands as if its buttons were clicked.
    setTimeout(async () => {
      const cmds: [string, unknown?][] = [
        ["rest"], ["idle", "look"], ["idle", "giggle"], ["activity", "eat"], ["activity", "music"], ["wander"],
        ["gaze-hold", "l"], ["gaze-hold", "ur"], ["gaze-hold", null], ["gaze-mode", "follow"],
        ["dock", "right"], ["peek", "wave"], ["peek", "tuck"], ["activity", "read"], ["undock"],
        ["sleep"], ["wake"], ["throw", [0, -1500]],
      ];
      for (const [cmd, arg] of cmds) {
        await emitTo("main", "debug-cmd", { cmd, arg });
        await new Promise((r) => setTimeout(r, 1800));
      }
      log("info", ["panel done"]);
    }, 3000);
  }
  if (import.meta.env.VITE_PET_DEMO === "probe") {
    setTimeout(async () => {
      for (const above of [0, 40, 150]) log("info", ["probe", above, await invoke("debug_probe_top", { above })]);
      log("info", ["probe done"]);
    }, 2500);
    return;
  }
  if (import.meta.env.VITE_PET_DEMO === "features") return featureTest(rig, pet, log);
  if (import.meta.env.VITE_PET_DEMO !== "1") return;
  let frames = 0;
  rig.app.ticker.add(() => frames++);
  setTimeout(() => {
    log("info", ["after 3s", { frames, visibility: document.visibilityState, hasFocus: document.hasFocus() }]);
    // requestAnimationFrame is paused when the display sleeps; drive the ticker by hand so the demo still renders.
    if (frames < 10) setInterval(() => rig.app.ticker.update(performance.now()), 16);
  }, 3000);
  const snap = async (name: string) => {
    // Snapshot the whole window area, not just the content bounds.
    rig.app.ticker.update(performance.now());
    const frame = new Rectangle(0, 0, innerWidth, innerHeight);
    await dump(`snap-${name}.png`, await rig.app.renderer.extract.base64({ target: rig.app.stage, frame }));
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const poses: PoseName[] = ["idle", "look", "yawn", "sleep", "fly", "hurt", "happy", "cheer", "curious", "shocked", "watch", "shy"];
  (async () => {
    await wait(4000);
    // Hold her in an action so idle behaviors don't change the pose under the snapshots.
    (pet as unknown as { begin(places: string[]): number | null }).begin(["floor", "left", "right"]);
    for (const p of poses) {
      rig.setPose(p, false);
      if (p === "hurt") fx.startDizzy(3);
      fx.sleeping = p === "sleep";
      if (p === "fly") rig.flying = true;
      await wait(1600);
      await snap(p);
      rig.flying = false;
    }
    fx.sleeping = false;
    rig.hang = { x: 150, y: 120 };
    rig.setPose("dragged", false);
    rig.kickSwing(3);
    await wait(1600);
    await snap("dragged");
    rig.hang = null;
    rig.setPose("idle", false);
    rig.variant = "idle_blink";
    await wait(300);
    await snap("blink");
    rig.variant = "";
    pet.say("你好呀，我是大肥鱼~ 今天也要元气满满！", "happy");
    await wait(1200);
    await snap("say");
    dump("log.txt", "demo done");
  })();
}

/** Throw her around repeatedly while the frontend keeps calling the backend; log any stall. */
function throwTest(log: (level: string, args: unknown[]) => void) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let worst = 0;
  setInterval(async () => {
    const t = performance.now();
    await invoke("activity");
    const dt = performance.now() - t;
    worst = Math.max(worst, dt);
    if (dt > 1000) log("STALL", [`backend round-trip took ${Math.round(dt)}ms`]);
  }, 200);

  (async () => {
    await wait(3000);
    const throws: [number, number][] = [[-2200, -1800], [2600, -1200], [-900, -2600], [3500, 400], [-3000, -3000], [1500, -2200]];
    for (const [i, [vx, vy]] of throws.entries()) {
      const landed = new Promise<MotionEvent>((resolve) => {
        const off = listen<MotionEvent>("pet-motion", (e) => {
          if (e.payload.kind === "landed") {
            off.then((f) => f());
            resolve(e.payload);
          }
        });
      });
      const t = performance.now();
      await invoke("debug_throw", { vx, vy });
      const ev = await Promise.race([landed, wait(12000).then(() => null)]);
      log("info", [`throw ${i + 1}`, ev ? { ms: Math.round(performance.now() - t), impact: Math.round(ev.impact) } : "NO LANDING within 12s"]);
    }
    log("info", ["throw test done", { worstRoundTripMs: Math.round(worst) }]);
  })();
}

/** 16-bit mono WAV as a data URL. */
function wav(buf: AudioBuffer): string {
  const pcm = buf.getChannelData(0);
  const bytes = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  bytes.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVEfmt ");
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 1, true);
  bytes.setUint32(24, buf.sampleRate, true);
  bytes.setUint32(28, buf.sampleRate * 2, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  str(36, "data");
  bytes.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  let bin = "";
  const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** Sizes, offline audio renders, and every reaction variant. */
async function featureTest(rig: Rig, pet: Pet, log: (level: string, args: unknown[]) => void) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const { SIZE_SCALE } = await import("./brain/settings");
  const { engine } = await import("./audio/engine");
  const { playSfx, SFX_NAMES } = await import("./audio/sfx");
  const { playVoice, VOICE_KINDS } = await import("./audio/voice");
  const tick = setInterval(() => rig.app.ticker.update(performance.now()), 16);
  await wait(2500);

  for (const [name, k] of Object.entries(SIZE_SCALE)) {
    await invoke("set_pet_scale", { factor: k });
    await wait(700);
    rig.height = 230 * k;
    log("info", [`size ${name}`, { window: [innerWidth, innerHeight], body: rig.bodyRect().map(Math.round) }]);
  }
  await invoke("set_pet_scale", { factor: 1 });
  rig.height = 230;

  const render = async (name: string, play: () => void, secs = 1.6) => {
    const ctx = new OfflineAudioContext(1, Math.round(44100 * secs), 44100);
    engine.attach(ctx);
    play();
    const buf = await ctx.startRendering();
    await dump(`audio-${name}.wav`, wav(buf));
  };
  for (const n of SFX_NAMES) await render(`sfx-${n}`, () => playSfx(n, 0.7));
  for (const v of VOICE_KINDS) await render(`voice-${v}`, () => playVoice(v), 2);
  log("info", ["audio rendered", { sfx: SFX_NAMES.length, voice: VOICE_KINDS.length }]);

  const snap = async (name: string) => {
    rig.app.ticker.update(performance.now());
    const frame = new Rectangle(0, 0, innerWidth, innerHeight);
    await dump(`snap-${name}.png`, await rig.app.renderer.extract.base64({ target: rig.app.stage, frame }));
  };
  const poses: PoseName[] = ["giggle", "pout", "proud", "dragged_happy", "dragged_grumpy", "dragged_limp", "fly_happy", "fly_ball", "hurt_cry", "hurt_dizzy"];
  for (const p of poses) {
    rig.hang = p.startsWith("dragged") ? { x: 150, y: 120 } : null;
    rig.flying = p.startsWith("fly");
    rig.spin = p === "fly_ball" ? 6 : 0;
    rig.setPose(p, false);
    await wait(900);
    await snap(p);
  }
  // Walk / run: drive the real wander() and snapshot mid-stride frames.
  rig.hang = null;
  rig.flying = false;
  rig.spin = 0;
  const internals = pet as unknown as { wander(): Promise<void>; toRest(): void };
  for (let k = 0; k < 4; k++) {
    internals.toRest();
    const done = internals.wander();
    for (let f = 0; f < 3; f++) {
      await wait(170);
      await snap(`move${k}-${f}`);
    }
    await done;
    log("info", [`wander ${k} done`]);
  }
  clearInterval(tick);
  log("info", ["features done"]);
}

/** Docking at both screen sides, every peek motion, every activity, and gaze modes. */
async function dockTest(rig: Rig, pet: Pet, log: (level: string, args: unknown[]) => void) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const p = pet as unknown as {
    dock(side: "left" | "right"): void;
    peek(m: PeekMotion): Promise<void>;
    activity(a: Activity): Promise<void>;
    toRest(): void;
    undock(): void;
    gaze: { mode: string; update(active: boolean): void; onCursor(x: number, y: number): void };
  };
  const { ACTIVITIES, PEEK_MOTIONS } = await import("./pet/activities");
  setInterval(() => rig.app.ticker.update(performance.now()), 16);
  const snap = async (name: string) => {
    rig.app.ticker.update(performance.now());
    const frame = new Rectangle(0, 0, innerWidth, innerHeight);
    await dump(`snap-${name}.png`, await rig.app.renderer.extract.base64({ target: rig.app.stage, frame }));
  };
  await wait(3000);
  // Where her grip line is relative to the screen edge, in physical px (0 = flush),
  // using both the analytic edge and the deformed sprite's actual bounds.
  const align = async (side: "left" | "right") => {
    const w = String(await invoke("debug_windows", { to: null }));
    const [, k, left, right, px] = w.match(/scale ([\d.]+) area left (-?\d+) top -?\d+ right (-?\d+) pet \((-?\d+)/)!.map(Number);
    const screenEdge = side === "right" ? right : left;
    const b = rig.bounds();
    const drawn = side === "right" ? b.right : b.x;
    return { edge: Math.round(px + rig.edge(side).x * k - screenEdge), drawn: Math.round(px + drawn * k - screenEdge), clip: Math.round(px + (rig.clip?.x ?? NaN) * k - screenEdge) };
  };
  for (const side of ["right", "left"] as const) {
    p.dock(side);
    await wait(700);
    log("info", [`dock ${side} rest`, { pose: rig.pose, flip: rig.flip }, await align(side)]);
    await snap(`dock-${side}`);
    log("info", [`windows ${side}`, await invoke("debug_windows", { to: null })]);
    for (const [m] of PEEK_MOTIONS) {
      p.toRest(); // idle motions don't preempt each other; start each from rest
      const done = p.peek(m);
      await wait(600);
      log("info", [`  ${side} ${m} during`, rig.pose, await align(side)]);
      await snap(`peek-${side}-${m}`);
      await done;
      await wait(m === "doze" ? 200 : 2600);
      log("info", [`  ${side} ${m} after`, rig.pose, await align(side)]);
    }
  }
  // State machine: floor-only behaviors must be refused while docked (left side now).
  p.toRest();
  void p.activity(ACTIVITIES[0]);
  void (pet as unknown as { wander(): Promise<void> }).wander();
  await wait(400);
  log("info", ["docked: activity/wander refused?", { pose: rig.pose, mode: pet.mode, docked: pet.docked }]);
  // An interrupted tuck must not leave her hidden.
  p.toRest();
  void p.peek("tuck");
  await wait(500);
  const hidden = await align("left");
  pet.say("测试：打断缩回去", "happy");
  await wait(5600);
  log("info", ["tuck interrupted", { whileTucked: hidden, afterTalking: await align("left"), pose: rig.pose, mode: pet.mode }]);
  p.undock();
  p.toRest();
  await invoke("set_pet_scale", { factor: 0.75 });
  for (const a of ACTIVITIES) {
    p.toRest();
    const done = p.activity(a);
    await wait(900);
    await snap(`act-${a.id}`);
    log("info", [`activity ${a.id}`, { pose: rig.pose }]);
    p.toRest();
    await done;
  }
  // Gaze: follow a cursor placed up-left of her head, then right.
  for (const [name, dx, dy] of [["ul", -200, -200], ["r", 200, 0], ["d", 0, 200]] as const) {
    p.gaze.mode = "follow";
    (p.gaze as unknown as { until: number }).until = performance.now() + 60000;
    const h = rig.head();
    p.gaze.onCursor(h.x + dx, h.y + dy);
    p.gaze.update(true);
    await wait(200);
    log("info", [`gaze follow ${name}`, { gaze: rig.gaze }]);
    await snap(`gaze-${name}`);
  }
  log("info", ["dock done"]);
}

/** Commands from the debug panel window (devpanel.html), and a live state readout for it. */
function installPanelBridge(rig: Rig, pet: Pet) {
  type Internals = {
    toRest(): void;
    poke(): void;
    wander(): Promise<void>;
    dock(side: "left" | "right"): void;
    undock(): void;
    peek(m: PeekMotion): Promise<void>;
    activity(a: Activity): Promise<void>;
    thrown(): void;
    floorActions(): [string, number, () => void][];
    place: string;
    gaze: {
      mode: string;
      force(mode: "front" | "around" | "follow" | null): void;
      hold(g: string | null): void;
    };
  };
  const p = pet as unknown as Internals;
  const reply = (msg: string) => {
    dump("log.txt", `panel ${msg}`);
    emitTo("devpanel", "debug-result", msg).catch(() => {});
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  listen<{ cmd: string; arg: unknown }>("debug-cmd", async ({ payload: { cmd, arg } }) => {
    const { ACTIVITIES } = await import("./pet/activities");
    switch (cmd) {
      case "rest": p.toRest(); break;
      case "sleep": pet.sleep(); break;
      case "wake": pet.wake(); break;
      case "say": pet.speak("chatter"); break;
      case "poke": p.poke(); break;
      case "gaze-mode":
        p.toRest();
        p.gaze.force(arg as "front" | "around" | "follow" | null);
        break;
      case "gaze-hold":
        if (arg !== null) p.toRest();
        p.gaze.hold(arg as string | null);
        break;
      case "gaze-tour":
        p.toRest();
        for (const g of ["", "l", "ul", "u", "ur", "r", "d", ""]) {
          p.gaze.hold(g);
          await wait(1200);
        }
        p.gaze.hold(null);
        break;
      case "idle": {
        p.toRest();
        const found = p.floorActions().find(([name]) => name === arg);
        if (found) found[2]();
        else return reply(`没有这个动作：${arg}`);
        break;
      }
      case "wander": p.toRest(); void p.wander(); break;
      case "activity": {
        p.toRest();
        const a = ACTIVITIES.find((x) => x.id === arg);
        if (a) void p.activity(a);
        break;
      }
      case "dock": p.dock(arg as "left" | "right"); break;
      case "undock":
        p.undock();
        p.toRest();
        await ipc.glideBy(0, 600); // glide_by also brings her back on screen
        break;
      case "peek": p.toRest(); void p.peek(arg as PeekMotion); break;
      case "throw": {
        const [vx, vy] = arg as [number, number];
        p.undock();
        p.thrown();
        await invoke("debug_throw", { vx, vy });
        break;
      }
    }
    await wait(150);
    reply(`${cmd}${arg === undefined ? "" : ` ${JSON.stringify(arg)}`} → ${pet.mode} / ${rig.pose}`);
  });

  setInterval(() => {
    emitTo("devpanel", "debug-state", {
      place: p.place,
      mode: pet.mode,
      pose: rig.pose,
      gazeMode: p.gaze.mode,
      gaze: rig.gaze || "(正前)",
      variant: rig.variant || "-",
      size: `${innerWidth}×${innerHeight}`,
    }).catch(() => {});
  }, 300);
}

/** "Look around" for 30 s with snapshots every 0.6 s and a log of every eye change. */
async function gazeFilm(rig: Rig, pet: Pet, log: (level: string, args: unknown[]) => void) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const p = pet as unknown as { toRest(): void; nextIdleAction: number; gaze: { force(m: string): void } };
  setInterval(() => rig.app.ticker.update(performance.now()), 16);
  await wait(3000);
  p.toRest();
  const t0 = performance.now();
  let last = "?";
  const watch = setInterval(() => {
    const now = `${rig.gaze || "front"}${rig.variant === "idle_blink" ? "+blink" : ""}`;
    if (now !== last) log("info", [`t=${((performance.now() - t0) / 1000).toFixed(2)}s eyes ${now}`]);
    last = now;
  }, 40);
  await wait(3500); // the settle period after returning to rest
  p.gaze.force("around");
  for (let i = 0; i < 50; i++) {
    // Keep her standing at rest (no idle actions, no sleep) so only the eyes change.
    p.nextIdleAction = Infinity;
    if (pet.mode !== "idle" || rig.pose !== "idle") {
      p.toRest();
      p.nextIdleAction = Infinity;
      p.gaze.force("around");
    }
    await wait(600);
    rig.app.ticker.update(performance.now());
    const frame = new Rectangle(0, 0, innerWidth, innerHeight);
    await dump(`snap-film-${String(i).padStart(2, "0")}.png`, await rig.app.renderer.extract.base64({ target: rig.app.stage, frame }));
  }
  clearInterval(watch);
  log("info", ["gaze film done"]);
}

/** Follow mode: a simulated cursor circles her head; log eyes + lean, snapshot frames. */
async function followTest(rig: Rig, pet: Pet, log: (level: string, args: unknown[]) => void) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const p = pet as unknown as {
    toRest(): void;
    nextIdleAction: number;
    gaze: { force(m: string | null): void; simulateCursor(pos: { x: number; y: number } | null): void };
  };
  setInterval(() => rig.app.ticker.update(performance.now()), 16);
  await wait(3000);
  p.toRest();
  p.gaze.force("follow");
  const h0 = rig.head();
  const t0 = performance.now();
  let last = "";
  for (let i = 0; i < 160; i++) {
    // One lap every 8 s, radius 260 px (well outside the dead zone).
    const a = ((performance.now() - t0) / 8000) * Math.PI * 2;
    const pos = { x: h0.x + Math.cos(a) * 260, y: h0.y + Math.sin(a) * 260 };
    p.gaze.simulateCursor(pos);
    if (pet.mode !== "idle") p.toRest(); // stay at rest so only the eyes / lean move
    p.nextIdleAction = Infinity;
    const now = `${rig.gaze || "front"} lean ${rig.leanTarget.toFixed(3)}`;
    const deg = Math.round(((a * 180) / Math.PI) % 360);
    if ((rig.gaze || "front") !== last.split(" ")[0]) log("info", [`t=${((performance.now() - t0) / 1000).toFixed(1)}s cursor at ${deg}° → eyes ${now}`]);
    last = now;
    if (i % 10 === 0) {
      rig.app.ticker.update(performance.now());
      const frame = new Rectangle(0, 0, innerWidth, innerHeight);
      await dump(`snap-follow-${String(i / 10).padStart(2, "0")}.png`, await rig.app.renderer.extract.base64({ target: rig.app.stage, frame }));
    }
    await wait(100);
  }
  p.gaze.simulateCursor(null);
  log("info", ["follow done"]);
}
