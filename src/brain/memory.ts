// Long-term memory: what she has said, and opinions she must stay consistent with.
// Each skin is its own character with its own memory: memory-<skin id>.json in
// the app data directory.
import { ipc, type StoreName } from "../ipc";
import { BASE_SKIN } from "../skin";

export type Stance = "love" | "like" | "meh" | "dislike";

export const STANCE_LABEL: Record<Stance, string> = {
  love: "超喜欢",
  like: "喜欢",
  meh: "一般般",
  dislike: "不太喜欢",
};

export interface Opinion {
  label: string;
  stance: Stance;
  /** The line in which she first expressed it. */
  firstSaid?: string;
  since: number;
  mentions: number;
}

export interface SaidLine {
  t: number;
  text: string;
  topic?: string;
  ctx?: string;
}

export interface MemoryData {
  version: 1;
  firstMet: number;
  opinions: Record<string, Opinion>;
  /** Self-facts she has stated (e.g. "我最爱吃磷虾小饼干"). */
  facts: { t: number; text: string }[];
  said: SaidLine[];
  stats: { pokes: number; throws: number; drags: number };
}

const MAX_SAID = 400;
const MAX_FACTS = 80;

function empty(): MemoryData {
  return {
    version: 1,
    firstMet: Date.now(),
    opinions: {},
    facts: [],
    said: [],
    stats: { pokes: 0, throws: 0, drags: 0 },
  };
}

/** Store name of a skin's memory. */
export const memoryStore = (skinId: string): StoreName => `memory-${skinId}`;

/** A skin's saved memory. The base skin inherits memory.json from before skins existed. */
export async function loadMemoryData(skinId: string): Promise<MemoryData | null> {
  const saved = await ipc.storeLoad<MemoryData>(memoryStore(skinId)).catch(() => null);
  if (saved || skinId !== BASE_SKIN) return saved;
  return ipc.storeLoad<MemoryData>("memory").catch(() => null);
}

export class Memory {
  data: MemoryData = empty();
  private saveTimer = 0;

  constructor(private skinId: string) {}

  async load() {
    const saved = await loadMemoryData(this.skinId);
    if (saved && saved.version === 1) this.data = { ...empty(), ...saved, stats: { ...empty().stats, ...saved.stats } };
    // Also writes memory-<id>.json the first time (e.g. right after inheriting memory.json).
    this.save();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      ipc.storeSave(memoryStore(this.skinId), this.data).catch((e) => console.warn("memory save failed", e));
    }, 400);
  }

  opinion(topic: string): Opinion | undefined {
    return this.data.opinions[topic];
  }

  /** Returns the existing stance, or fixes a new one forever. */
  decide(topic: string, label: string, pick: () => Stance): Opinion {
    let op = this.data.opinions[topic];
    if (!op) {
      op = { label, stance: pick(), since: Date.now(), mentions: 0 };
      this.data.opinions[topic] = op;
      this.save();
    }
    return op;
  }

  /** Record a stance stated by the LLM; refuses to overwrite an existing one. */
  adopt(topic: string, label: string, stance: Stance, line: string): boolean {
    const op = this.data.opinions[topic];
    if (op) return op.stance === stance;
    this.data.opinions[topic] = { label, stance, firstSaid: line, since: Date.now(), mentions: 0 };
    this.save();
    return true;
  }

  mention(topic: string, line: string) {
    const op = this.data.opinions[topic];
    if (!op) return;
    op.mentions++;
    op.firstSaid ??= line;
    this.save();
  }

  addFact(text: string) {
    text = text.trim();
    if (!text || this.data.facts.some((f) => f.text === text)) return;
    this.data.facts.push({ t: Date.now(), text });
    if (this.data.facts.length > MAX_FACTS) this.data.facts.shift();
    this.save();
  }

  recordSaid(text: string, topic?: string, ctx?: string) {
    this.data.said.push({ t: Date.now(), text, topic, ctx });
    if (this.data.said.length > MAX_SAID) this.data.said.splice(0, this.data.said.length - MAX_SAID);
    this.save();
  }

  saidRecently(text: string, within = 40) {
    return this.data.said.slice(-within).some((s) => s.text === text);
  }

  lastAbout(topic: string): SaidLine | undefined {
    for (let i = this.data.said.length - 1; i >= 0; i--) if (this.data.said[i].topic === topic) return this.data.said[i];
    return undefined;
  }

  bump(stat: keyof MemoryData["stats"]) {
    this.data.stats[stat]++;
    this.save();
    return this.data.stats[stat];
  }

  clear() {
    this.data = empty();
    this.save();
  }
}
