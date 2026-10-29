// Wordless "character voice": short emotive interjections.
// Everything about the voice comes from the skin's voice.json (VoiceProfile):
// recorded clips in the skin's voice/ folder are used when it lists them;
// otherwise a tiny formant synthesizer strings vowel-like syllables together
// and the pitch contour carries the emotion.
import type { Skin } from "../skin";
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

/** One syllable of a phrase (voice.json "phrases"). */
export interface Syl {
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

/** A skin's voice.json. */
export interface VoiceProfile {
  /** Base pitch, Hz, and its random variation per phrase (fraction). */
  pitch: number;
  pitchJitter: number;
  /** Speed multiplier for syllable lengths, and its variation. */
  tempo: number;
  tempoJitter: number;
  /** Low-pass cutoff on the whole voice, Hz: lower is softer. */
  brightness: number;
  /** How fast the source's harmonics fall off (1 = sawtooth; higher is duller). */
  rolloff: number;
  vibratoRate: number;
  /** Default vibrato depth (fraction of pitch) and breathiness for syllables that don't set one. */
  vibratoDepth: number;
  breath: number;
  /** F1–F3 per vowel, Hz. */
  formants: Record<Vowel, [number, number, number]>;
  formantGain: [number, number, number];
  formantBandwidth: [number, number, number];
  /** Pitch multipliers the hummed tune ("hum") walks on. */
  humScale: number[];
  /** Recorded clips per kind, files in the skin's voice/ folder. */
  clips: Partial<Record<VoiceKind, string[]>>;
  /** Alternative phrases per kind; one is picked at random each time. "hum" is generated. */
  phrases: Partial<Record<VoiceKind, Syl[][]>>;
}

let profile: VoiceProfile | null = null;

/** Use this skin's voice from now on. */
export function setVoice(skin: Skin) {
  profile = skin.voice;
  void loadVoiceClips(skin);
}

const ONSET_VOWEL: Partial<Record<NonNullable<Syl["c"]>, Vowel>> = { m: "m", w: "u", y: "i" };
const VOWELS: Vowel[] = ["a", "i", "u", "e", "o", "m", "n"];

const S = (v: string, d: number, p: number[], o: Omit<Syl, "v" | "d" | "p"> = {}): Syl => ({ v, d, p, ...o });

/** A little random tune on the skin's scale. */
function hum(scale: number[]): Syl[] {
  const steps = scale.length ? scale : [1];
  let idx = Math.floor(Math.random() * Math.min(3, steps.length));
  return Array.from({ length: 4 + Math.floor(Math.random() * 2) }, (_, k) => {
    idx = Math.max(0, Math.min(steps.length - 1, idx + Math.floor(Math.random() * 3) - 1));
    return S(k % 2 ? "a" : "n", jitter(0.17, 0.15), [steps[idx], steps[idx]], { a: 0.5, vib: 0.02, gap: 0.02 });
  });
}

/** Skins are user-made: drop syllables that can't be played. */
function playable(s: Syl): boolean {
  const vs = typeof s?.v === "string" ? s.v.split(">") : [];
  return (
    vs.length >= 1 && vs.length <= 2 && vs.every((v) => VOWELS.includes(v as Vowel)) &&
    typeof s.d === "number" && s.d > 0 && s.d < 3 &&
    Array.isArray(s.p) && s.p.length > 0 && s.p.every((m) => typeof m === "number" && m > 0.1 && m < 8)
  );
}

const waves = new WeakMap<BaseAudioContext, { rolloff: number; wave: PeriodicWave }>();

/** Glottal-ish source: harmonics rolling off faster than a sawtooth. */
function glottal(ctx: BaseAudioContext, rolloff: number) {
  let w = waves.get(ctx);
  if (!w || w.rolloff !== rolloff) {
    const n = 40;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = 1 / Math.pow(k, rolloff);
    w = { rolloff, wave: ctx.createPeriodicWave(real, imag) };
    waves.set(ctx, w);
  }
  return w.wave;
}

function vowels(v: string): [Vowel, Vowel] {
  const [a, b] = v.split(">") as Vowel[];
  return [a, b ?? a];
}

function syllable(ctx: BaseAudioContext, out: AudioNode, pr: VoiceProfile, s: Syl, t: number, base: number, tempo: number) {
  const FORMANTS = pr.formants;
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
    f.Q.value = mid / pr.formantBandwidth[k];
    const g = ctx.createGain();
    g.gain.value = pr.formantGain[k];
    f.connect(g).connect(sum);
    return f;
  });

  // Voiced source with a pitch contour and vibrato.
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(glottal(ctx, pr.rolloff));
  const p = s.p.length > 1 ? s.p : [s.p[0], s.p[0]];
  p.forEach((m, k) => {
    const at = voiceStart + (d * k) / (p.length - 1);
    if (k === 0) osc.frequency.setValueAtTime(base * m, at);
    else osc.frequency.exponentialRampToValueAtTime(base * m, at);
  });
  const vib = ctx.createOscillator();
  vib.frequency.value = jitter(pr.vibratoRate, 0.1);
  const vibDepth = ctx.createGain();
  vibDepth.gain.value = base * (s.vib ?? pr.vibratoDepth);
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
  const breath = s.breath ?? pr.breath;
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
  const pr = profile;
  if (!ctx || !pr || !engine.settings.voice) return 0;
  // Don't talk over herself.
  if (ctx.currentTime < (busyUntil.get(ctx) ?? 0) - 0.05) return 0;
  const recorded = playClip(ctx, kind);
  if (recorded) return recorded;
  const options = kind === "hum" ? [hum(pr.humScale)] : (pr.phrases[kind] ?? pr.phrases.neutral ?? []);
  const phrase = (options[Math.floor(Math.random() * options.length)] ?? []).filter(playable);
  if (!phrase.length) return 0;
  const base = jitter(pr.pitch, pr.pitchJitter);
  const tempo = jitter(pr.tempo, pr.tempoJitter);
  const bus = ctx.createGain();
  // Soften the top end a little so it reads as a voice, not a buzzer.
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = pr.brightness;
  bus.connect(tone).connect(engine.voiceBus);
  let t = ctx.currentTime + 0.01;
  const start = t;
  for (const s of phrase) t = syllable(ctx, bus, pr, s, t, base, tempo);
  busyUntil.set(ctx, t);
  return t - start;
}

// ---------- recorded clips ----------

/** Decoded clips of the current skin (voice.json "clips": { "<kind>": ["happy-1.mp3", …] }). */
const clips = new Map<VoiceKind, AudioBuffer[]>();
const lastClip = new Map<VoiceKind, AudioBuffer>();

/** Decode every clip the skin lists. No clips = synth only. */
async function loadVoiceClips(skin: Skin) {
  clips.clear();
  // AudioBuffers aren't tied to a context; decode once and play anywhere.
  const decoder = new OfflineAudioContext(1, 1, 48000);
  await Promise.all(
    Object.entries(skin.voice.clips ?? {}).map(async ([kind, files]) => {
      const bufs = await Promise.all(
        (Array.isArray(files) ? files : []).map(async (f) => {
          try {
            return await decoder.decodeAudioData(await skin.voiceFile(String(f)));
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
