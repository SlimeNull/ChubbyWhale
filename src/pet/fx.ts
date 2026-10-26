// Small cartoon effects drawn around the pet: Zzz, dizzy stars, notes, sweat…
import { Container, Text, TextStyle } from "pixi.js";
import type { Rig } from "./rig";

export type FxKind = "zzz" | "note" | "sparkle" | "sweat" | "question" | "exclaim" | "heart" | "anger" | "bump" | "star";

interface Particle {
  node: Text;
  life: number;
  age: number;
  update(p: Particle, dt: number): void;
}

const GLYPH: Record<FxKind, { text: string; color: string; size: number }> = {
  zzz: { text: "Z", color: "#5b7cff", size: 22 },
  note: { text: "♪", color: "#3c64f0", size: 24 },
  sparkle: { text: "✦", color: "#f5c242", size: 20 },
  sweat: { text: "💧", color: "#58a8ff", size: 18 },
  question: { text: "?", color: "#3c64f0", size: 30 },
  exclaim: { text: "!", color: "#ff5a6a", size: 32 },
  heart: { text: "♥", color: "#ff6b9a", size: 22 },
  anger: { text: "💢", color: "#ff4a4a", size: 22 },
  bump: { text: "咚!", color: "#ff7a3c", size: 22 },
  star: { text: "★", color: "#ffcc33", size: 18 },
};

function style(kind: FxKind) {
  const g = GLYPH[kind];
  return new TextStyle({
    fontFamily: "'PingFang SC','Microsoft YaHei',system-ui,sans-serif",
    fontSize: g.size,
    fontWeight: "900",
    fill: g.color,
    stroke: { color: "#ffffff", width: 4, join: "round" },
  });
}

export class Fx {
  private particles: Particle[] = [];
  private dizzyUntil = 0;
  private dizzy: Text[] = [];
  private zzzTimer = 0;
  sleeping = false;
  private t = 0;

  constructor(private rig: Rig, private layer: Container) {
    layer.sortableChildren = true; // dizzy stars pass behind / in front of the head
    rig.app.ticker.add((tk) => this.update(tk.deltaMS / 1000));
  }

  private spawn(kind: FxKind, x: number, y: number, life: number, update: Particle["update"]) {
    const node = new Text({ text: GLYPH[kind].text, style: style(kind), anchor: 0.5 });
    node.position.set(x, y);
    this.layer.addChild(node);
    this.particles.push({ node, life, age: 0, update });
    return node;
  }

  /** Floating glyphs that rise and fade near the head. */
  emit(kind: FxKind, count = 1) {
    const h = this.rig.head();
    for (let i = 0; i < count; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = h.x + side * (30 + Math.random() * 40);
      const y = h.top + 10 + Math.random() * 20;
      const vx = side * (8 + Math.random() * 12);
      setTimeout(() => {
        this.spawn(kind, x, y, 1.6, (p, dt) => {
          p.node.x += vx * dt;
          p.node.y -= 28 * dt;
          p.node.alpha = 1 - p.age / p.life;
          const s = Math.min(1, p.age * 6);
          p.node.scale.set(s);
        });
      }, i * 220);
    }
  }

  /** A word that pops at a screen side, e.g. when hitting a wall. */
  pop(kind: FxKind, side: string) {
    const b = this.rig.bounds();
    const x = side === "left" ? b.x + 10 : side === "right" ? b.right - 10 : b.x + b.width / 2;
    const y = side === "top" ? b.y + 10 : side === "bottom" ? b.bottom - 20 : b.y + b.height * 0.35;
    this.spawn(kind, x, y, 0.7, (p) => {
      const k = p.age / p.life;
      p.node.scale.set(0.6 + Math.sin(Math.min(1, k * 3) * Math.PI / 2) * 0.6);
      p.node.alpha = 1 - k * k;
    });
  }

  startDizzy(seconds: number) {
    this.dizzyUntil = this.t + seconds;
    if (this.dizzy.length) return;
    for (let i = 0; i < 3; i++) {
      const node = new Text({ text: GLYPH.star.text, style: style("star"), anchor: 0.5 });
      this.layer.addChild(node);
      this.dizzy.push(node);
    }
  }

  stopDizzy() {
    this.dizzyUntil = 0;
  }

  private update(dt: number) {
    this.t += dt;
    for (const p of this.particles) {
      p.age += dt;
      p.update(p, dt);
    }
    this.particles = this.particles.filter((p) => {
      if (p.age < p.life) return true;
      p.node.destroy();
      return false;
    });

    if (this.dizzy.length) {
      const h = this.rig.head();
      this.dizzy.forEach((n, i) => {
        const a = this.t * 4 + (i * Math.PI * 2) / 3;
        n.position.set(h.x + Math.cos(a) * 42, h.top + 6 + Math.sin(a) * 10);
        n.zIndex = Math.sin(a);
        n.alpha = Math.min(1, (this.dizzyUntil - this.t) * 2);
      });
      if (this.t > this.dizzyUntil) {
        this.dizzy.forEach((n) => n.destroy());
        this.dizzy = [];
      }
    }

    if (this.sleeping) {
      this.zzzTimer -= dt;
      if (this.zzzTimer <= 0) {
        this.zzzTimer = 1.3;
        const h = this.rig.head();
        const size = 0.7 + Math.random() * 0.5;
        this.spawn("zzz", h.x + 30, h.top + 20, 2.6, (p, dt2) => {
          p.node.x += 14 * dt2 + Math.sin(p.age * 3) * 0.4;
          p.node.y -= 22 * dt2;
          p.node.scale.set(size * (0.6 + p.age / p.life));
          p.node.alpha = 1 - p.age / p.life;
        });
      }
    }
  }
}
