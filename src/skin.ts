// Skins: her look (sprites), personality (lines, opinions, LLM prompts) and voice.
// One fixed directory per skin, see skins/standard/ and docs/STRUCTURE.md ("皮肤").
// Every file is read through Rust (skin_file), for built-in and imported skins alike.
//
// Anything a skin leaves out comes from the base skin ("标准大肥鱼"): missing
// line kinds, prompt pieces, voice settings. Sprites must be complete (checked on
// import); a sprite that is still missing falls back to the base one.
import type { VoiceProfile } from "./audio/voice";
import type { Stance } from "./brain/memory";
import { ipc, type SkinMeta } from "./ipc";
import type { Emotion } from "./pet/pet";

export const BASE_SKIN = "standard";

export type LineBank = Record<string, { emotion: Emotion; lines: string[] }>;

export interface Opinions {
  /** Fixed stances on topics (topic ids from brain/topics.ts). */
  stances: Record<string, Stance>;
  /** Weights for picking a stance on a topic seen for the first time, per topic type ("default" for the rest). */
  random: Record<string, Partial<Record<Stance, number>>>;
}

export interface Prompts {
  persona: string;
  rules: string[];
  memory: { opinions: string; noOpinions: string; facts: string; said: string; stance: string };
  situation: {
    doing: string;
    unknownApp: string;
    duration: string;
    title: string;
    file: string;
    topics: string;
    price: string;
    kinds: Record<string, string>;
  };
  tasks: Record<"talk" | "talkNoContext" | "chatter" | "kind" | "opinion" | "opinionAgain" | "topic" | "test", string>;
}

export interface SpriteMeta {
  w: number;
  h: number;
  /** Horizontal anchor (0..1): center of the head, which reads as the body center. */
  ax: number;
}

export interface SpriteManifest {
  /** Distance between the feet in walk_a / run_a when she is 230px tall (px). */
  motion?: { walkStride: number; runStride: number };
  poses: Record<string, SpriteMeta>;
  variants: Record<string, SpriteMeta>;
}

export interface Skin {
  meta: SkinMeta;
  lines: LineBank;
  opinions: Opinions;
  prompts: Prompts;
  voice: VoiceProfile;
  /** Skin whose voice/ folder holds the clips listed in `voice.clips`. */
  voiceFrom: string;
  sprites: SpriteManifest;
  /** Raw bytes of one of this skin's sprites (`sprites/<name>.webp`). */
  sprite(name: string): Promise<Blob>;
  /** Raw bytes of a file in the skin that owns the voice clips. */
  voiceFile(name: string): Promise<ArrayBuffer>;
}

/** Fill `{name}` placeholders. */
export function fill(s: string, vars: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const decoder = new TextDecoder();

async function readJson<T>(id: string, path: string): Promise<T | null> {
  try {
    return JSON.parse(decoder.decode(await ipc.skinFile(id, path))) as T;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Objects merge key by key; anything else (strings, numbers, arrays) is replaced. */
function merge<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : v;
  return out as T;
}

export async function listSkins() {
  return ipc.skinList();
}

/** Load skin `id` (the base skin if it's gone, e.g. deleted). */
export async function loadSkin(id: string): Promise<Skin> {
  const skins = await ipc.skinList();
  const meta = skins.find((s) => s.id === id) ?? skins.find((s) => s.id === BASE_SKIN);
  if (!meta) throw new Error("base skin missing");
  const own = meta.id;
  const [baseLines, baseOpinions, basePrompts, baseVoice, baseSprites] = await Promise.all([
    readJson<LineBank>(BASE_SKIN, "lines.json"),
    readJson<Opinions>(BASE_SKIN, "opinions.json"),
    readJson<Prompts>(BASE_SKIN, "prompts.json"),
    readJson<VoiceProfile>(BASE_SKIN, "voice.json"),
    readJson<SpriteManifest>(BASE_SKIN, "sprites/manifest.json"),
  ]);
  if (!baseLines || !baseOpinions || !basePrompts || !baseVoice || !baseSprites) throw new Error("base skin incomplete");
  if (own === BASE_SKIN) {
    return build(meta, baseLines, baseOpinions, basePrompts, baseVoice, BASE_SKIN, baseSprites, baseSprites);
  }
  const [lines, opinions, prompts, voice, sprites] = await Promise.all([
    readJson<LineBank>(own, "lines.json"),
    readJson<Opinions>(own, "opinions.json"),
    readJson<Prompts>(own, "prompts.json"),
    readJson<VoiceProfile>(own, "voice.json"),
    readJson<SpriteManifest>(own, "sprites/manifest.json"),
  ]);
  return build(
    meta,
    { ...baseLines, ...(lines ?? {}) },
    // A character's likes are her own: her stances replace the base ones entirely.
    opinions ? { stances: opinions.stances ?? {}, random: { ...baseOpinions.random, ...(opinions.random ?? {}) } } : baseOpinions,
    merge(basePrompts, prompts),
    voice ? { ...merge(baseVoice, voice), clips: voice.clips ?? {} } : baseVoice,
    voice ? own : BASE_SKIN,
    sprites ?? { poses: {}, variants: {} },
    baseSprites,
  );
}

function build(
  meta: SkinMeta,
  lines: LineBank,
  opinions: Opinions,
  prompts: Prompts,
  voice: VoiceProfile,
  voiceFrom: string,
  sprites: SpriteManifest,
  baseSprites: SpriteManifest,
): Skin {
  // Sprites the skin doesn't have (shouldn't happen after import checks) come from the base skin.
  const fromBase = new Set<string>();
  const all: SpriteManifest = { motion: sprites.motion ?? baseSprites.motion, poses: { ...sprites.poses }, variants: { ...sprites.variants } };
  for (const group of ["poses", "variants"] as const) {
    for (const [name, m] of Object.entries(baseSprites[group])) {
      if (!all[group][name]) {
        all[group][name] = m;
        fromBase.add(name);
      }
    }
  }
  if (fromBase.size && meta.id !== BASE_SKIN) console.warn(`skin ${meta.id}: missing sprites from base`, [...fromBase]);
  return {
    meta,
    lines,
    opinions,
    prompts,
    voice,
    voiceFrom,
    sprites: all,
    async sprite(name) {
      const from = fromBase.has(name) ? BASE_SKIN : meta.id;
      return new Blob([await ipc.skinFile(from, `sprites/${name}.webp`)], { type: "image/webp" });
    },
    voiceFile: (name) => ipc.skinFile(voiceFrom, `voice/${name}`),
  };
}
