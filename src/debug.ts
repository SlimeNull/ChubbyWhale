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
