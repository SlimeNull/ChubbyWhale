// Wordless "character voice": short emotive interjections.
// Recorded clips in public/voice/ (see manifest.json, built by art/voice/build_voice.py)
// are used when available; otherwise a tiny formant synthesizer strings
// vowel-like syllables together and the pitch contour carries the emotion.
import { engine, jitter } from "./engine";

export type VoiceKind =
  | "neutral"
  | "happy"
  | "giggle"
  | "surprised"
  | "curious"
  | "shy"
  | "hurt"
  | "cry"
  | "dizzy"
  | "sleepy"
  | "cheer"
  | "angry"
  | "scared"
  | "fly"
  | "hum"
  | "sigh";

export const VOICE_KINDS: VoiceKind[] = ["neutral", "happy", "giggle", "surprised", "curious", "shy", "hurt", "cry", "dizzy", "sleepy", "cheer", "angry", "scared", "fly", "hum", "sigh"];

type Vowel = "a" | "i" | "u" | "e" | "o" | "m" | "n";

interface Syl {
  /** Vowel, or a glide "u>a". */
  v: string;
  /** Duration in seconds. */
  d: number;
  /** Pitch contour, multipliers of the base pitch spread over the syllable. */
  p: number[];
  /** Onset consonant. */
  c?: "h" | "t" | "k" | "m" | "w" | "y" | "f";
  /** Loudness 0..1. */
  a?: number;
  /** Vibrato depth (fraction of pitch). */
  vib?: number;
  /** Breathiness 0..1. */
  breath?: number;
  /** Silence after, seconds. */
  gap?: number;
}

// Formants (Hz) for a small, bright voice.
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [1050, 1650, 3300],
  i: [380, 2900, 3800],
  u: [420, 1150, 2700],
  e: [600, 2450, 3500],
  o: [580, 980, 3000],
  m: [280, 1300, 2500],
  n: [300, 1600, 2600],
};
const FORMANT_GAIN = [1, 0.55, 0.25];
const FORMANT_BW = [160, 140, 200];
const ONSET_VOWEL: Partial<Record<NonNullable<Syl["c"]>, Vowel>> = { m: "m", w: "u", y: "i" };

const BASE_PITCH = 520;

const S = (v: string, d: number, p: number[], o: Omit<Syl, "v" | "d" | "p"> = {}): Syl => ({ v, d, p, ...o });

/** Several alternative phrases per emotion; one is picked at random each time. */
const PHRASES: Record<VoiceKind, () => Syl[][]> = {
  neutral: () => [[S("n", 0.16, [1, 1.08])], [S("a", 0.14, [1, 1.1], { c: "h" })], [S("e", 0.12, [1, 1.05]), S("o", 0.14, [1.05, 0.95])]],
  happy: () => [
    [S("a", 0.11, [1.15, 1.3], { c: "h" }), S("a", 0.16, [1.35, 1.2], { c: "h" })],
    [S("i>a", 0.26, [1, 1.45, 1.3], { c: "y" })],
    [S("u>a", 0.14, [1.1, 1.3], { c: "w" }), S("i", 0.18, [1.4, 1.5, 1.35])],
  ],
  giggle: () => [
    [0, 1, 2, 3].map((k) => S("e", 0.07, [1.45 - k * 0.07, 1.4 - k * 0.07], { c: k ? "h" : undefined, gap: 0.03 })),
    [S("u", 0.08, [1.3, 1.25], { c: "f" }), S("u", 0.08, [1.35, 1.28], { c: "f" }), S("u", 0.1, [1.25, 1.15], { c: "f" })],
  ],
  surprised: () => [[S("a", 0.24, [0.95, 1.65])], [S("u>a", 0.2, [1.1, 1.6], { c: "w" })], [S("e", 0.22, [1, 1.55])]],
  curious: () => [[S("m", 0.3, [0.95, 0.92, 1.35])], [S("e", 0.22, [1, 1.4])], [S("n", 0.12, [1, 1]), S("u", 0.18, [1.05, 1.4])]],
  shy: () => [
    [S("u", 0.34, [1.1, 0.98, 1.06], { a: 0.55, vib: 0.03 })],
    [S("e", 0.08, [1.15, 1.1], { a: 0.5, c: "h" }), S("e", 0.1, [1.1, 1], { a: 0.45, c: "h" }), S("e", 0.12, [1, 0.95], { a: 0.4 })],
    [S("a>u", 0.3, [1.05, 0.95], { a: 0.5, breath: 0.4 })],
  ],
  hurt: () => [
    [S("u", 0.09, [1.25, 1.2]), S("u>a", 0.38, [1.35, 1, 0.75], { vib: 0.05 })],
    [S("i", 0.09, [1.3, 1.3], { c: "t" }), S("a", 0.12, [1.25, 1.1], { c: "t" }), S("i", 0.2, [1, 0.8])],
    [S("a>u", 0.42, [1.3, 0.8], { vib: 0.04 })],
  ],
  cry: () => [
    [S("u>a", 0.35, [1.3, 1.4, 1.1], { vib: 0.08, c: "w" }), S("a>u", 0.4, [1.4, 1.2, 0.9], { vib: 0.08 })],
    [S("e", 0.3, [1.35, 1], { vib: 0.09 }), S("e", 0.35, [1.3, 0.9], { vib: 0.09, c: "h" })],
  ],
  dizzy: () => [
    [S("u", 0.18, [1.1, 0.85]), S("e", 0.18, [0.95, 0.8]), S("u", 0.3, [0.9, 0.7], { vib: 0.06 })],
    [S("a>u", 0.55, [1.1, 1.25, 0.9, 1.05, 0.7], { vib: 0.03 })],
  ],
  sleepy: () => [
    [S("u>a", 0.55, [1, 1.08, 0.75], { c: "f", breath: 0.5 }), S("a", 0.25, [0.75, 0.65], { a: 0.5, breath: 0.6 })],
    [S("m", 0.45, [0.9, 0.8], { a: 0.5, breath: 0.3 })],
  ],
  cheer: () => [
    [S("i>a", 0.16, [1.15, 1.45], { c: "y" }), S("o", 0.18, [1.5, 1.4], { c: "h" })],
    [S("e", 0.08, [1.2, 1.25], { c: "h" }), S("i", 0.2, [1.35, 1.55, 1.45], { c: "y" })],
    [S("a", 0.2, [1.2, 1.55], { c: "y" })],
  ],
  angry: () => [
    [S("m", 0.12, [0.9, 0.95]), S("u", 0.28, [0.95, 1, 0.88], { vib: 0.03 })],
    [S("m", 0.22, [1, 0.85], { c: "h", breath: 0.3 })],
    [S("u", 0.1, [1, 1.05], { c: "m" }), S("u", 0.14, [1.1, 1], { c: "m" })],
  ],
  scared: () => [
    [0, 1, 2].map(() => S("u>a", 0.1, [1.35, 1.5], { c: "w", gap: 0.03 })),
    [S("i>a", 0.22, [1.45, 1.75, 1.6], { c: "k" })],
    [S("a", 0.4, [1.4, 1.6, 1.4], { vib: 0.07, c: "w" })],
  ],
  fly: () => [[S("u>a", 0.7, [1.2, 1.75, 1.3], { vib: 0.04, c: "w" })], [S("i", 0.6, [1.3, 1.8, 1.5], { vib: 0.03, c: "y" })]],
  hum: () => {
    // A little random tune on a pentatonic scale.
    const scale = [1, 1.125, 1.25, 1.5, 1.667];
    let idx = Math.floor(Math.random() * 3);
    const notes = Array.from({ length: 4 + Math.floor(Math.random() * 2) }, (_, k) => {
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(Math.random() * 3) - 1));
      return S(k % 2 ? "a" : "n", jitter(0.17, 0.15), [scale[idx], scale[idx]], { a: 0.5, vib: 0.02, gap: 0.02 });
    });
    return [notes];
  },
  sigh: () => [[S("a", 0.5, [1, 0.75], { breath: 0.7, a: 0.45, c: "h" })]],
};

const waves = new WeakMap<BaseAudioContext, PeriodicWave>();

/** Glottal-ish source: harmonics rolling off faster than a sawtooth. */
function glottal(ctx: BaseAudioContext) {
  let w = waves.get(ctx);
  if (!w) {
    const n = 40;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = 1 / Math.pow(k, 1.4);
    w = ctx.createPeriodicWave(real, imag);
    waves.set(ctx, w);
  }
  return w;
}

function vowels(v: string): [Vowel, Vowel] {
  const [a, b] = v.split(">") as Vowel[];
  return [a, b ?? a];
}

function syllable(ctx: BaseAudioContext, out: AudioNode, s: Syl, t: number, base: number, tempo: number) {
  const d = s.d * tempo;
  const amp = (s.a ?? 1) * 0.5;
  const [v0, v1] = vowels(s.v);
  const onsetVowel = s.c ? ONSET_VOWEL[s.c] : undefined;
  const voiceStart = s.c === "h" || s.c === "f" ? t + 0.045 : s.c === "t" || s.c === "k" ? t + 0.018 : t;
  const end = voiceStart + d;

  // Formant filter bank, shared by the voiced source and breath noise.
  const sum = ctx.createGain();
  sum.gain.value = 3.2;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, voiceStart);
  env.gain.linearRampToValueAtTime(amp * (onsetVowel === "m" ? 0.55 : 1), voiceStart + 0.018);
  if (onsetVowel === "m") env.gain.linearRampToValueAtTime(amp, voiceStart + 0.07);
  env.gain.setValueAtTime(amp, Math.max(voiceStart + 0.07, end - 0.05));
  env.gain.linearRampToValueAtTime(0.0001, end);
  sum.connect(env).connect(out);

  // Her pitch is above the first formant of closed vowels (i/u/m/n), which would
  // filter the voice away; keep F1 just above the pitch.
  const f1Floor = base * Math.max(...s.p) * 1.15;
  const formant = (v: Vowel, k: number) => (k === 0 ? Math.max(FORMANTS[v][0], f1Floor) : FORMANTS[v][k]);
  const filters = FORMANTS[v0].map((_, k) => {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    const from = formant(onsetVowel ?? v0, k);
    const mid = formant(v0, k);
    const to = formant(v1, k);
    f.frequency.setValueAtTime(from, voiceStart);
    if (onsetVowel) f.frequency.linearRampToValueAtTime(mid, voiceStart + Math.min(0.07, d * 0.4));
    f.frequency.setValueAtTime(mid, voiceStart + Math.min(0.07, d * 0.4));
    f.frequency.linearRampToValueAtTime(to, voiceStart + d * 0.55);
    f.Q.value = mid / FORMANT_BW[k];
    const g = ctx.createGain();
    g.gain.value = FORMANT_GAIN[k];
    f.connect(g).connect(sum);
    return f;
  });

  // Voiced source with a pitch contour and vibrato.
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(glottal(ctx));
  const p = s.p.length > 1 ? s.p : [s.p[0], s.p[0]];
  p.forEach((m, k) => {
    const at = voiceStart + (d * k) / (p.length - 1);
    if (k === 0) osc.frequency.setValueAtTime(base * m, at);
    else osc.frequency.exponentialRampToValueAtTime(base * m, at);
  });
  const vib = ctx.createOscillator();
  vib.frequency.value = jitter(5.8, 0.1);
  const vibDepth = ctx.createGain();
  vibDepth.gain.value = base * (s.vib ?? 0.012);
  vib.connect(vibDepth).connect(osc.frequency);
  const voiced = ctx.createGain();
  voiced.gain.value = 1 - (s.breath ?? 0) * 0.6;
  osc.connect(voiced);
  filters.forEach((f) => voiced.connect(f));
  // A little unfiltered low end keeps loudness even across vowels.
  const body = ctx.createBiquadFilter();
  body.type = "lowpass";
  body.frequency.value = base * 2.5;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.12;
  voiced.connect(body).connect(bodyGain).connect(sum);
  osc.start(voiceStart);
  vib.start(voiceStart);
  osc.stop(end + 0.05);
  vib.stop(end + 0.05);

  // Breath noise through the same formants.
  const breath = s.breath ?? 0.08;
  const n = engine.noise(ctx);
  const ng = ctx.createGain();
  ng.gain.value = breath * 0.35;
  n.connect(ng);
  filters.forEach((f) => ng.connect(f));
  n.start(voiceStart);
  n.stop(end + 0.05);

  // Consonant onsets.
  if (s.c === "h" || s.c === "f") {
    const h = engine.noise(ctx);
    const hf = ctx.createBiquadFilter();
    hf.type = s.c === "f" ? "highpass" : "bandpass";
    hf.frequency.value = s.c === "f" ? 1800 : FORMANTS[v0][1];
    hf.Q.value = 0.8;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.linearRampToValueAtTime(amp * 0.35, t + 0.02);
    hg.gain.linearRampToValueAtTime(0.0001, voiceStart + 0.02);
    h.connect(hf).connect(hg).connect(out);
    h.start(t);
    h.stop(voiceStart + 0.05);
  } else if (s.c === "t" || s.c === "k") {
    const c = engine.noise(ctx);
    const cf = ctx.createBiquadFilter();
    cf.type = "highpass";
    cf.frequency.value = s.c === "t" ? 3500 : 1800;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(amp * 0.5, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    c.connect(cf).connect(cg).connect(out);
    c.start(t);
    c.stop(t + 0.03);
  }
  return end + (s.gap ?? 0.02) * tempo;
}

/** When the current phrase ends, per context (so she doesn't talk over herself). */
const busyUntil = new WeakMap<BaseAudioContext, number>();

/** Play one emotive phrase. Returns its duration in seconds. */
export function playVoice(kind: VoiceKind): number {
  const ctx = engine.get();
  if (!ctx || !engine.settings.voice) return 0;
  // Don't talk over herself.
  if (ctx.currentTime < (busyUntil.get(ctx) ?? 0) - 0.05) return 0;
  const recorded = playClip(ctx, kind);
  if (recorded) return recorded;
  const options = PHRASES[kind]();
  const phrase = options[Math.floor(Math.random() * options.length)];
  const base = jitter(BASE_PITCH, 0.05);
  const tempo = jitter(1, 0.1);
  const bus = ctx.createGain();
  // Soften the top end a little so it reads as a voice, not a buzzer.
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 5200;
  bus.connect(tone).connect(engine.voiceBus);
  let t = ctx.currentTime + 0.01;
  const start = t;
  for (const s of phrase) t = syllable(ctx, bus, s, t, base, tempo);
  busyUntil.set(ctx, t);
  return t - start;
}

// ---------- recorded clips ----------

/** public/voice/manifest.json: { "<kind>": ["happy-1.mp3", …] } */
const clips = new Map<VoiceKind, AudioBuffer[]>();
const lastClip = new Map<VoiceKind, AudioBuffer>();

/** Fetch and decode every clip listed in the manifest. Missing manifest = synth only. */
export async function loadVoiceClips() {
  let manifest: Partial<Record<VoiceKind, string[]>>;
  try {
    const r = await fetch("/voice/manifest.json");
    if (!r.ok) return;
    manifest = await r.json();
  } catch {
    return;
  }
  // AudioBuffers aren't tied to a context; decode once and play anywhere.
  const decoder = new OfflineAudioContext(1, 1, 48000);
  await Promise.all(
    Object.entries(manifest).map(async ([kind, files]) => {
      const bufs = await Promise.all(
        (files ?? []).map(async (f) => {
          try {
            return await decoder.decodeAudioData(await (await fetch(`/voice/${f}`)).arrayBuffer());
          } catch (e) {
            console.warn("voice clip failed", f, e);
            return null;
          }
        }),
      );
      const ok = bufs.filter((b): b is AudioBuffer => !!b);
      if (ok.length) clips.set(kind as VoiceKind, ok);
    }),
  );
}

export function hasVoiceClips() {
  return clips.size > 0;
}

function playClip(ctx: BaseAudioContext, kind: VoiceKind): number {
  const list = clips.get(kind);
  if (!list?.length) return 0;
  const fresh = list.filter((b) => b !== lastClip.get(kind));
  const buf = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
  lastClip.set(kind, buf);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // A hair of pitch variation so repeats don't sound copy-pasted.
  src.playbackRate.value = jitter(1, 0.03);
  // Clips are normalized to -18 LUFS; lift them to sit level with the effects.
  const gain = ctx.createGain();
  gain.gain.value = 2;
  src.connect(gain).connect(engine.voiceBus);
  const t = ctx.currentTime + 0.01;
  src.start(t);
  const dur = buf.duration / src.playbackRate.value;
  busyUntil.set(ctx, t + dur);
  return dur;
}
