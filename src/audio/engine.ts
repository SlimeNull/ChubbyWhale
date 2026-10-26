// Shared WebAudio plumbing: one context, separate buses for effects and voice.
// Everything is synthesized on the fly — there are no audio files.

export interface SoundSettings {
  /** 0..1 */
  volume: number;
  effects: boolean;
  voice: boolean;
}

export class Engine {
  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  sfxBus!: GainNode;
  voiceBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  settings: SoundSettings = { volume: 0.6, effects: true, voice: true };

  /** The context, created lazily; null if audio can't play. */
  get(): BaseAudioContext | null {
    if (!this.ctx) this.attach(new AudioContext());
    const ctx = this.ctx!;
    if (ctx instanceof AudioContext && ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx.state === "closed" ? null : ctx;
  }

  /** Route everything into `ctx` (an OfflineAudioContext in dev renders). */
  attach(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    // A hard-knee limiter that only catches peaks, so overlapping sounds never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    this.master.connect(limiter).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.voiceBus.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.apply();
  }

  /** Call from a user gesture: browsers only start audio after one. */
  unlock() {
    this.get();
  }

  configure(s: SoundSettings) {
    this.settings = s;
    if (this.ctx) this.apply();
  }

  private apply() {
    const s = this.settings;
    this.master.gain.value = s.volume * s.volume; // perceptual curve
    // Effects are synthesized quieter than the voice; bring them to a similar loudness.
    this.sfxBus.gain.value = s.effects ? 3 : 0;
    this.voiceBus.gain.value = s.voice ? 0.8 : 0;
  }

  noise(ctx: BaseAudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopStart = Math.random() * 0.5;
    return src;
  }
}

export const engine = new Engine();

/** Attack/decay envelope on a fresh gain node. */
export function envelope(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

export const jitter = (x: number, amount: number) => x * (1 + (Math.random() * 2 - 1) * amount);
