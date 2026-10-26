// Renders Chubby Whale as a deformable mesh so a single illustration can
// breathe, lean, squash and dangle — a lightweight, Live2D-style puppet.
import { Application, Assets, Container, MeshPlane, Rectangle, Texture } from "pixi.js";

export type PoseName =
  | "idle"
  | "look"
  | "yawn"
  | "sleep"
  | "dragged"
  | "fly"
  | "hurt"
  | "happy"
  | "cheer"
  | "curious"
  | "shocked"
  | "watch"
  | "shy";

interface SpriteMeta {
  w: number;
  h: number;
  /** Horizontal anchor (0..1): center of the head, which reads as the body center. */
  ax: number;
}

interface Manifest {
  poses: Record<string, SpriteMeta>;
  variants: Record<string, SpriteMeta>;
}

/** Critically-damped-ish spring used for squash & stretch and wobbles. */
class Spring {
  v = 0;
  constructor(public x: number, public target: number, private k = 220, private d = 14) {}
  step(dt: number) {
    const a = this.k * (this.target - this.x) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(dv: number) {
    this.v += dv;
  }
}

export class Rig {
  readonly app = new Application();
  readonly root = new Container();
  readonly fxLayer = new Container();
  private mesh!: MeshPlane;
  private textures = new Map<string, Texture>();
  private meta = new Map<string, SpriteMeta>();

  pose: PoseName = "idle";
  /** Override texture for the idle pose (blink / talk). */
  variant: "" | "idle_blink" | "idle_talk" = "";
  /** Display height of the idle pose in CSS px. */
  height = 230;
  flip = false;

  /** Where the feet stand, window-local CSS px. */
  readonly floor = { x: 150, y: 412 };
  /** Dangling from the cursor (during drag): pivot point, window-local. */
  hang: { x: number; y: number } | null = null;
  /** Free flight: sprite centered on the body center and rotated. */
  flying = false;

  lean = 0; // radians-ish, bends the upper body
  leanTarget = 0;
  rotation = 0;
  rotationTarget = 0;
  breathRate = 1;
  bob = 0; // px of floating bob amplitude
  swing = 0; // pendulum while hanging
  private swingV = 0;
  private sx = new Spring(1, 1);
  private sy = new Spring(1, 1);
  private t = 0;
  hop = 0; // px, vertical offset for little jumps
  private hopV = 0;

  async init(canvasHost: HTMLElement) {
    await this.app.init({
      backgroundAlpha: 0,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: "webgl",
    });
    canvasHost.appendChild(this.app.canvas);

    const manifest: Manifest = await (await fetch("/sprites/manifest.json")).json();
    const entries = { ...manifest.poses, ...manifest.variants };
    await Promise.all(
      Object.entries(entries).map(async ([name, meta]) => {
        const tex = await Assets.load<Texture>({
          src: `/sprites/${name}.webp`,
          data: { autoGenerateMipmaps: true, scaleMode: "linear" },
        });
        this.textures.set(name, tex);
        this.meta.set(name, meta);
      }),
    );

    this.mesh = new MeshPlane({ texture: this.textures.get("idle")!, verticesX: 10, verticesY: 16 });
    this.root.addChild(this.mesh);
    this.app.stage.addChild(this.root, this.fxLayer);
    this.app.ticker.add((tk) => this.update(tk.deltaMS / 1000));
  }

  has(name: string) {
    return this.textures.has(name);
  }

  get scale() {
    return this.height / (this.meta.get("idle")?.h ?? 1);
  }

  setPose(pose: PoseName, pop = true) {
    if (!this.textures.has(pose)) pose = "idle";
    if (pose !== this.pose && pop) this.squash(0.9, 1.1);
    this.pose = pose;
  }

  /** Squash & stretch impulse; values are the momentary scale. */
  squash(sx: number, sy: number) {
    this.sx.x = sx;
    this.sy.x = sy;
  }

  jump(px = 26) {
    this.hopV = Math.sqrt(2 * 2000 * px);
  }

  kickSwing(v: number) {
    this.swingV += v;
  }

  /** Idle-pose body rectangle in window coordinates, for physics. */
  bodyRect(): [number, number, number, number] {
    const m = this.meta.get("idle")!;
    const s = this.scale;
    const w = m.w * s * 0.62;
    return [this.floor.x - w / 2, this.floor.y - m.h * s * 0.97, this.floor.x + w / 2, this.floor.y];
  }

  /** Current on-screen bounds of the character. */
  bounds(): Rectangle {
    return this.root.getBounds().rectangle;
  }

  /** Approximate head center, for effects and the speech bubble. */
  head(): { x: number; y: number; top: number } {
    const b = this.bounds();
    const top = b.y + b.height * 0.04;
    return { x: b.x + b.width * this.anchorX(), y: b.y + b.height * 0.2, top };
  }

  private anchorX() {
    const ax = this.meta.get(this.pose)?.ax ?? 0.5;
    return this.flip ? 1 - ax : ax;
  }

  private update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const texName = this.pose === "idle" && this.variant && this.textures.has(this.variant) ? this.variant : this.pose;
    const tex = this.textures.get(texName)!;
    if (this.mesh.texture !== tex) this.mesh.texture = tex;
    const meta = this.meta.get(texName)!;

    const sx = this.sx.step(dt);
    const sy = this.sy.step(dt);
    this.lean += (this.leanTarget - this.lean) * Math.min(1, dt * 6);
    this.rotation += (this.rotationTarget - this.rotation) * Math.min(1, dt * 8);

    // Little hops use simple gravity.
    if (this.hop > 0 || this.hopV > 0) {
      this.hopV -= 2000 * dt;
      this.hop = Math.max(0, this.hop + this.hopV * dt);
      if (this.hop === 0) {
        this.hopV = 0;
        this.squash(1.12, 0.88);
      }
    }

    // Pendulum while hanging from the cursor.
    this.swingV += (-40 * this.swing - 3.2 * this.swingV) * dt;
    this.swing += this.swingV * dt;
    this.swing = Math.max(-1.2, Math.min(1.2, this.swing));

    const breath = (Math.sin(this.t * 2.2 * this.breathRate) + 1) / 2;
    const { w, h, ax } = meta;
    const hangPivot = 0.3; // hold her by the collar
    const ay = this.hang ? hangPivot : this.flying ? 0.55 : 1;

    const geo = this.mesh.geometry;
    const pos = geo.getBuffer("aPosition");
    const uvs = geo.getBuffer("aUV").data as Float32Array;
    const out = pos.data as Float32Array;
    for (let i = 0; i < uvs.length; i += 2) {
      const u = uvs[i];
      const v = uvs[i + 1];
      let x = (u - ax) * w;
      let y = (v - ay) * h;
      if (this.hang) {
        const down = Math.max(0, v - hangPivot) / (1 - hangPivot);
        x += this.swing * h * 0.22 * down * down;
        y += h * 0.05 * down;
      } else {
        const up = 1 - v;
        y -= breath * h * 0.014 * up;
        x *= 1 + breath * 0.01 * up;
        x += this.lean * h * Math.pow(up, 1.7);
      }
      out[i] = x * sx;
      out[i + 1] = y * sy;
    }
    pos.update();

    const s = this.scale;
    this.mesh.scale.set(this.flip ? -s : s, s);
    if (this.hang) {
      this.root.position.set(this.hang.x, this.hang.y);
      this.root.rotation = -this.swing * 0.35;
    } else if (this.flying) {
      const b = this.bodyRect();
      this.root.position.set((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      this.root.rotation = this.rotation;
    } else {
      const float = this.bob ? Math.sin(this.t * 1.6) * this.bob : 0;
      this.root.position.set(this.floor.x, this.floor.y - this.hop + float);
      this.root.rotation = this.rotation;
    }
  }
}
