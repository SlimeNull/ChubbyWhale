// Dev-only helpers: forward errors to a log file and, with VITE_PET_DEMO=1,
// cycle through every pose and save a canvas snapshot of each.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Rectangle } from "pixi.js";
import type { MotionEvent } from "./ipc";
import type { Fx } from "./pet/fx";
import type { Pet } from "./pet/pet";
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
    pet.mode = "action";
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
  const wander = (pet as unknown as { wander(): Promise<void> }).wander.bind(pet);
  for (let k = 0; k < 4; k++) {
    pet.mode = "idle";
    const done = wander();
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
