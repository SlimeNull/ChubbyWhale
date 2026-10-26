// Where she looks while standing idle: straight ahead, glancing around, or
// following the mouse. Eye directions are the idle_gaze_* sprite variants
// (both eyes shifted by the same amount, see build_sprites.py), plus a slight lean.
//
// Calm by design: after any other action she first looks straight ahead for a
// few seconds, and glances are seconds apart. Following the mouse is the
// exception: while in that mode she tracks it the whole time (eyes plus a
// continuous lean), and she doesn't wander off to other idle actions while the
// mouse keeps moving.
import type { Gaze, Rig } from "./rig";

export type GazeMode = "front" | "around" | "follow";

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Lean toward where she looks (radians-ish). */
// The art only lets the eyes move a little sideways, so the lean carries part of the look.
const LEAN: Record<Gaze, number> = { "": 0, l: -0.03, r: 0.03, u: 0, d: 0, ul: -0.022, ur: 0.022 };

/** Minimum time on one direction while following, ms (just enough to avoid flicker). */
const FOLLOW_DWELL = 250;
/** The mouse counts as "moving" for this long after it last moved, ms. */
const MOVING_MS = 3000;

export class GazeController {
  mode: GazeMode = "front";
  /** Called when the eyes change direction (the pet blinks then — it reads as natural). */
  onShift: () => void = () => {};
  private until = 0;
  private nextGlance = 0;
  private lastShift = 0;
  private cursor: { x: number; y: number } | null = null;
  private smooth: { x: number; y: number } | null = null;
  private lastMove = -Infinity;

  constructor(private rig: Rig) {}

  /** Dev tests: a simulated cursor replaces the real one while set. */
  private simulated = false;
  simulateCursor(pos: { x: number; y: number } | null) {
    this.simulated = !!pos;
    if (pos) this.feed(pos.x, pos.y);
  }

  /** Cursor position, window-local CSS px (about 10 Hz). */
  onCursor(x: number, y: number) {
    if (!this.simulated) this.feed(x, y);
  }

  private feed(x: number, y: number) {
    const c = this.cursor;
    if (!c || Math.hypot(x - c.x, y - c.y) > 6) this.lastMove = performance.now();
    this.cursor = { x, y };
  }

  /** A fixed direction (debug panel); while set, modes are suspended. */
  private held: Gaze | null = null;
  /** A mode pinned from the debug panel; survives returning to rest. */
  private forced: GazeMode | null = null;

  /** Debug: stay in `mode` until called with null (back to switching on its own). */
  force(mode: GazeMode | null) {
    this.held = null;
    this.forced = mode;
    if (mode) this.mode = mode;
    this.until = mode ? Infinity : 0;
    this.nextGlance = 0;
    this.lastShift = 0;
  }

  /** Following a mouse that is moving: she is busy watching it. */
  get watching() {
    return this.mode === "follow" && performance.now() - this.lastMove < MOVING_MS;
  }

  /** Debug: look in one direction until released with null. */
  hold(g: Gaze | null) {
    this.held = g;
    if (g !== null) this.set(g);
  }

  /** She just came back to rest: look straight ahead for a while before anything else. */
  rest() {
    if (this.forced) return; // pinned from the debug panel
    // Keep following a mouse that is still moving; otherwise settle facing forward.
    if (this.watching) return;
    this.mode = "front";
    this.until = performance.now() + rand(2500, 4500);
    this.set("");
  }

  /** Call regularly; `active` is false whenever she isn't standing at rest in the idle pose. */
  update(active: boolean) {
    if (!active) {
      if (this.rig.gaze) this.set("");
      return;
    }
    if (this.held !== null) return this.set(this.held);
    const now = performance.now();
    if (now > this.until) this.switchMode(now);

    if (this.mode === "front") {
      this.set("");
    } else if (this.mode === "around") {
      if (now > this.nextGlance) {
        this.nextGlance = now + rand(2000, 4500);
        // Often come back to center between glances.
        const next = this.rig.gaze && Math.random() < 0.45 ? "" : pick<Gaze>(["l", "r", "ul", "ur", "u", "d", "l", "r"]);
        this.shift(next, now);
      }
    } else {
      // Follow: track the mouse all the time — the lean follows continuously,
      // the eyes switch direction as soon as the mouse crosses into another one.
      const g = now - this.lastShift > FOLLOW_DWELL ? this.towardCursor() : this.rig.gaze;
      this.shift(g, now);
      this.rig.leanTarget = this.followLean();
    }
  }

  /** Lean toward the (smoothed) cursor, proportional to how far to the side it is. */
  private followLean() {
    if (!this.smooth) return LEAN[this.rig.gaze];
    const dx = this.smooth.x - this.rig.head().x;
    return Math.max(-0.045, Math.min(0.045, dx / 900));
  }

  private switchMode(now: number) {
    // Following is more likely while the mouse is moving; she keeps following while it moves.
    const moving = now - this.lastMove < MOVING_MS;
    if (moving && this.mode === "follow" && Math.random() < 0.85) {
      this.until = now + rand(6000, 15000);
      return;
    }
    const weights: [GazeMode, number][] = [
      ["follow", moving ? 0.6 : 0.3],
      ["around", 0.35],
      ["front", 0.35],
    ];
    let r = Math.random() * weights.reduce((s, [, w]) => s + w, 0);
    for (const [m, w] of weights) if ((r -= w) <= 0) { this.mode = m; break; }
    this.until = now + rand(6000, 15000);
    this.nextGlance = now + rand(600, 1500);
    this.smooth = null;
  }

  /** Direction toward a smoothed cursor, with hysteresis around the current direction. */
  private towardCursor(): Gaze {
    if (!this.cursor) return "";
    const s = (this.smooth ??= { ...this.cursor });
    s.x += (this.cursor.x - s.x) * 0.5;
    s.y += (this.cursor.y - s.y) * 0.5;
    const h = this.rig.head();
    const dx = s.x - h.x;
    const dy = s.y - h.y;
    const cur = this.rig.gaze;
    // Harder to start looking a way than to keep looking that way.
    const hx = cur.includes("l") || cur.includes("r") ? 20 : 40;
    const hy = cur.includes("u") || cur === "d" ? 30 : 50;
    const horiz = dx < -hx ? "l" : dx > hx ? "r" : "";
    const vert = dy < -hy ? "u" : dy > hy ? "d" : "";
    if (vert === "u") return horiz ? (`u${horiz}` as Gaze) : "u";
    if (vert === "d") return horiz || "d"; // no down-left/right art; sideways reads better
    return horiz;
  }

  private shift(g: Gaze, now: number) {
    if (g === this.rig.gaze) return;
    this.lastShift = now;
    // A small blink on bigger jumps (left ↔ right), not on every small adjustment.
    if (this.rig.gaze && g && this.rig.gaze[this.rig.gaze.length - 1] !== g[g.length - 1]) this.onShift();
    this.set(g);
  }

  private set(g: Gaze) {
    this.rig.gaze = g;
    this.rig.leanTarget = LEAN[g];
  }
}
