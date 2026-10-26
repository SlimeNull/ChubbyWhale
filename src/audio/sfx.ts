// Synthesized sound effects. Each call is slightly randomized so repeats don't sound canned.
import { engine, envelope, jitter } from "./engine";

export type SfxName = "pop" | "pickup" | "whoosh" | "boing" | "thud" | "softland" | "dizzy" | "puff" | "sparkle";

export const SFX_NAMES: SfxName[] = ["pop", "pickup", "whoosh", "boing", "thud", "softland", "dizzy", "puff", "sparkle"];

/** `intensity` (0..1) scales volume/pitch for impacts. */
export function playSfx(name: SfxName, intensity = 0.6) {
  const ctx = engine.get();
  if (!ctx || !engine.settings.effects) return;
  const t = ctx.currentTime + 0.005;
  const out = engine.sfxBus;
  const i = Math.max(0.1, Math.min(1, intensity));

  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, at = t, attack = 0.005) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = envelope(ctx, at, peak, attack, dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + attack + dur + 0.05);
    return o;
  };

  const hiss = (type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, peak: number, at = t, attack = 0.01) => {
    const n = engine.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = envelope(ctx, at, peak, attack, dur);
    n.connect(f).connect(g).connect(out);
    n.start(at);
    n.stop(at + attack + dur + 0.05);
  };

  switch (name) {
    case "pop": {
      // A water bubble: pitch rises quickly. Sometimes a second, smaller one.
      const f = jitter(320, 0.15);
      tone("sine", f, f * 3.2, 0.07, 0.5);
      if (Math.random() < 0.5) tone("sine", f * 1.4, f * 4.2, 0.05, 0.25, t + jitter(0.07, 0.3));
      break;
    }
    case "pickup":
      tone("triangle", jitter(300, 0.1), jitter(760, 0.1), 0.14, 0.5);
      hiss("bandpass", 1200, 3200, 1.5, 0.12, 0.3);
      break;
    case "whoosh":
      hiss("bandpass", 380, jitter(2600, 0.2), 1.1, 0.22, 0.5, t, 0.08);
      hiss("bandpass", 2600, 500, 1.1, 0.3, 0.3, t + 0.2, 0.02);
      break;
    case "boing": {
      // Spring: a quick rise, then a decaying wobble around the pitch.
      const base = jitter(150 + 120 * i, 0.12);
      const dur = 0.25 + 0.3 * i;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(base * 0.6, t);
      o.frequency.exponentialRampToValueAtTime(base * 2.6, t + 0.04);
      o.frequency.exponentialRampToValueAtTime(base * 1.8, t + dur);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = jitter(17, 0.15);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(base * 0.6, t + 0.04);
      depth.gain.exponentialRampToValueAtTime(1, t + dur);
      lfo.connect(depth).connect(o.frequency);
      const g = envelope(ctx, t, 0.25 + 0.35 * i, 0.004, dur);
      o.connect(g).connect(out);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.05);
      lfo.stop(t + dur + 0.05);
      break;
    }
    case "thud":
      tone("sine", jitter(120, 0.1), 42, 0.22, 0.5 + 0.4 * i);
      hiss("lowpass", 600, 150, 0.7, 0.12, 0.25 + 0.3 * i);
      break;
    case "softland":
      tone("sine", jitter(180, 0.1), 80, 0.14, 0.4 + 0.3 * i);
      hiss("lowpass", 1200, 300, 0.7, 0.1, 0.35);
      break;
    case "dizzy": {
      // Cartoon birds circling: three little chirps, plus a woozy descending warble.
      for (let k = 0; k < 3; k++) {
        const at = t + 0.12 + k * jitter(0.16, 0.2);
        tone("sine", jitter(2500, 0.08), jitter(3500, 0.08), 0.05, 0.12, at, 0.003);
        tone("sine", jitter(3300, 0.08), jitter(2700, 0.08), 0.04, 0.08, at + 0.06, 0.003);
      }
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.9);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const depth = ctx.createGain();
      depth.gain.value = 50;
      lfo.connect(depth).connect(o.frequency);
      const g = envelope(ctx, t, 0.14, 0.05, 0.9);
      o.connect(g).connect(out);
      o.start(t);
      lfo.start(t);
      o.stop(t + 1);
      lfo.stop(t + 1);
      break;
    }
    case "puff":
      hiss("lowpass", 1800, 400, 0.6, 0.16, 0.9);
      tone("sine", jitter(220, 0.1), 120, 0.1, 0.2);
      break;
    case "sparkle":
      [1568, 2093, 2637].forEach((f, k) => tone("sine", f, f * 1.002, 0.45, 0.12, t + k * 0.06, 0.003));
      break;
  }
}
