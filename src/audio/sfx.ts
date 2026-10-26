// Synthesized sound effects in a soft, "cute game UI" style: bell and
// music-box tones on a pentatonic scale, slide whistles, chick chirps, and a
// touch of reverb. Each call is slightly randomized so repeats don't sound canned.
import { engine, jitter } from "./engine";

export type SfxName = "pop" | "pickup" | "whoosh" | "boing" | "thud" | "softland" | "dizzy" | "puff" | "sparkle" | "step";

export const SFX_NAMES: SfxName[] = ["pop", "pickup", "whoosh", "boing", "thud", "softland", "dizzy", "puff", "sparkle", "step"];

// Major pentatonic around C6 — anything picked from here sounds pleasant together.
const PENTA = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093, 2349.3, 2637];
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** `intensity` (0..1) scales volume/pitch for impacts. */
export function playSfx(name: SfxName, intensity = 0.6) {
  const ctx = engine.get();
  if (!ctx || !engine.settings.effects) return;
  const t = ctx.currentTime + 0.005;
  const dry = engine.sfxBus;
  const wet = engine.sfxReverb;
  const i = Math.max(0.1, Math.min(1, intensity));

  /** Route a node to the dry bus plus a little reverb. */
  const out = (node: AudioNode, reverb = 0.25) => {
    node.connect(dry);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      node.connect(send).connect(wet);
    }
  };

  /** Soft-attack tone with a pitch glide. */
  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, at = t, attack = 0.008, reverb = 0.25) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + dur);
    o.connect(g);
    out(g, reverb);
    o.start(at);
    o.stop(at + attack + dur + 0.05);
  };

  /** Glassy FM bell / music-box note. */
  const bell = (freq: number, at: number, dur: number, peak: number, reverb = 0.4) => {
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 3.5;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(freq * 1.2, at);
    idx.gain.exponentialRampToValueAtTime(1, at + dur * 0.6);
    mod.connect(idx).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    car.connect(g);
    out(g, reverb);
    car.start(at);
    mod.start(at);
    car.stop(at + dur + 0.05);
    mod.stop(at + dur + 0.05);
  };

  /** Breathy air, band-limited so it stays soft. */
  const air = (f0: number, f1: number, dur: number, peak: number, at = t, q = 1.2) => {
    const n = engine.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
    n.connect(f).connect(g);
    out(g, 0.15);
    n.start(at);
    n.stop(at + dur + 0.05);
  };

  switch (name) {
    case "pop": {
      // "Puni": a round squishy blip that bends up, plus a tiny bell sparkle.
      const f = jitter(520, 0.12);
      tone("sine", f * 0.8, f * 1.6, 0.09, 0.55, t, 0.004, 0.15);
      bell(pick(PENTA.slice(3)), t + 0.03, 0.25, 0.12);
      break;
    }
    case "pickup":
      // "Pyoi": two quick rising notes.
      tone("triangle", 784, 784 * 1.02, 0.06, 0.35, t, 0.004);
      tone("triangle", 1175, 1175 * 1.03, 0.1, 0.35, t + 0.06, 0.004);
      break;
    case "whoosh":
      // Slide whistle up, with a soft swish.
      tone("sine", jitter(600, 0.1), jitter(1900, 0.1), 0.38, 0.32, t, 0.03, 0.3);
      air(800, 3500, 0.3, 0.12, t);
      break;
    case "boing": {
      // "Boyoyon": a bouncy spring, higher and gentler than a cartoon boing.
      const base = jitter(330 + 160 * i, 0.08);
      const dur = 0.22 + 0.2 * i;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(base * 0.7, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.035);
      o.frequency.exponentialRampToValueAtTime(base * 1.15, t + dur);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = jitter(13, 0.1);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(base * 0.22, t + 0.03);
      depth.gain.exponentialRampToValueAtTime(1, t + dur);
      lfo.connect(depth).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3 + 0.25 * i, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      out(g, 0.25);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.05);
      lfo.stop(t + dur + 0.05);
      break;
    }
    case "thud":
      // "Pokon": a wood-block knock with a soft low "pofu" under it.
      tone("sine", jitter(880, 0.06), 820, 0.07, 0.45 * (0.6 + 0.4 * i), t, 0.002, 0.2);
      tone("sine", jitter(1760, 0.06), 1700, 0.04, 0.18, t, 0.002, 0.1);
      tone("sine", 220, 110, 0.16, 0.35 * i, t, 0.006, 0);
      break;
    case "softland":
      // "Pofu": a cushion landing.
      tone("sine", jitter(330, 0.08), 200, 0.12, 0.3 + 0.2 * i, t, 0.008, 0.1);
      air(1200, 500, 0.12, 0.08, t, 0.8);
      break;
    case "dizzy": {
      // "Piyo piyo": chicks circling, then a music-box run tumbling down.
      for (let k = 0; k < 4; k++) {
        const at = t + k * jitter(0.15, 0.15);
        const f = k % 2 ? 2800 : 3300;
        tone("sine", f, f * 1.12, 0.05, 0.14, at, 0.003, 0.2);
        tone("sine", f * 1.12, f, 0.05, 0.1, at + 0.05, 0.003, 0.2);
      }
      [7, 5, 4, 2, 0].forEach((n, k) => bell(PENTA[n], t + 0.15 + k * 0.11, 0.4, 0.1));
      break;
    }
    case "puff":
      // Set down gently: "pofun".
      tone("sine", 600, 420, 0.1, 0.25, t, 0.01, 0.15);
      air(1500, 600, 0.1, 0.06, t, 0.8);
      break;
    case "sparkle":
      // "Kirarin": a quick rising music-box arpeggio.
      [0, 2, 4, 5].forEach((n, k) => bell(PENTA[n] * (Math.random() < 0.5 ? 1 : 1.5), t + k * 0.06, 0.5, 0.13));
      break;
    case "step":
      // "Pata": a tiny soft footstep.
      tone("sine", jitter(700, 0.1), 500, 0.05, 0.3 * (0.6 + 0.4 * i), t, 0.003, 0);
      break;
  }
}
