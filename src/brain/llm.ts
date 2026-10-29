// Optional LLM voice (DeepSeek or any OpenAI-compatible API).
// Persona, rules and the wording of every prompt come from the skin
// (prompts.json); only the reply format is fixed here, since the code parses it.
// The model must stay consistent with remembered opinions; replies that
// contradict memory are discarded and the offline line bank is used instead.
import { ipc, type ChatMessage } from "../ipc";
import { EMOTIONS, type Emotion } from "../pet/pet";
import { fill, type Prompts } from "../skin";
import { STANCE_LABEL, type Memory, type Stance } from "./memory";
import type { Settings } from "./settings";

const STANCES: Stance[] = ["love", "like", "meh", "dislike"];

/** The reply format the code parses. Not part of the skin. */
const FORMAT_RULE = `只输出一个 JSON 对象：{"text": 要说的话, "emotion": ${EMOTIONS.join("|")} 之一, "topic": 这句话评价的游戏/作品/商品名称或 null, "stance": 你对该 topic 的态度 love|like|meh|dislike 或 null, "fact": 如果这句话透露了一个新的关于你自己的设定（例如"我最喜欢吃草莓"），写成一句陈述，否则 null}`;

export interface LlmReply {
  text: string;
  emotion: Emotion;
  topicId?: string;
}

function topicId(name: string) {
  return "llm:" + name.trim().toLowerCase().replace(/\s+/g, "");
}

export class LlmBrain {
  constructor(
    private memory: Memory,
    private settings: () => Settings,
    private prompts: Prompts,
  ) {}

  private system() {
    const own = Array.isArray(this.prompts.rules) ? this.prompts.rules : [];
    const rules = [...own, FORMAT_RULE].map((r, i) => `${i + 1}. ${r}`).join("\n");
    return `${this.prompts.persona}\n\n规则：\n${rules}\n\n${this.context()}`;
  }

  get enabled() {
    const s = this.settings().llm;
    return s.enabled && !!s.apiKey.trim();
  }

  private context(): string {
    const m = this.memory.data;
    const p = this.prompts.memory;
    const ops = Object.values(m.opinions)
      .slice(-60)
      .map((o) => `${o.label}=${STANCE_LABEL[o.stance]}`)
      .join("；");
    const facts = m.facts.slice(-20).map((f) => `- ${f.text}`).join("\n");
    const said = m.said.slice(-12).map((s) => `- ${s.text}`).join("\n");
    return [
      fill(p.opinions, { list: ops || p.noOpinions }),
      facts && fill(p.facts, { list: facts }),
      said && fill(p.said, { list: said }),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Ask for one remark about `situation` (a Chinese description).
   * `known` lists topics recognized locally, with the stance she must use.
   */
  async remark(situation: string, known: { id: string; label: string; stance?: Stance }[] = []): Promise<LlmReply | null> {
    const s = this.settings().llm;
    const constraints = known
      .filter((k) => k.stance)
      .map((k) => fill(this.prompts.memory.stance, { label: k.label, stance: STANCE_LABEL[k.stance!] }))
      .join("\n");
    const messages: ChatMessage[] = [
      { role: "system", content: this.system() },
      { role: "user", content: [situation, constraints].filter(Boolean).join("\n") },
    ];
    let raw: string;
    try {
      raw = await ipc.llmChat({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, messages, jsonMode: true });
    } catch (e) {
      console.warn("llm failed", e);
      return null;
    }
    return this.accept(raw, known);
  }

  private accept(raw: string, known: { id: string; label: string; stance?: Stance }[]): LlmReply | null {
    let j: { text?: unknown; emotion?: unknown; topic?: unknown; stance?: unknown; fact?: unknown };
    try {
      j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      return null;
    }
    const text = typeof j.text === "string" ? j.text.trim().slice(0, 60) : "";
    if (!text || this.memory.saidRecently(text, 80)) return null;
    const emotion = EMOTIONS.includes(j.emotion as Emotion) ? (j.emotion as Emotion) : "neutral";

    let id: string | undefined;
    if (typeof j.topic === "string" && j.topic.trim()) {
      const label = j.topic.trim();
      const match = known.find((k) => k.label.toLowerCase() === label.toLowerCase());
      id = match?.id ?? Object.entries(this.memory.data.opinions).find(([, o]) => o.label.toLowerCase() === label.toLowerCase())?.[0] ?? topicId(label);
      if (STANCES.includes(j.stance as Stance)) {
        // Contradicting a remembered opinion is not allowed.
        if (!this.memory.adopt(id, match?.label ?? label, j.stance as Stance, text)) return null;
      }
    }
    if (typeof j.fact === "string" && j.fact.trim()) this.memory.addFact(j.fact);
    return { text, emotion, topicId: id };
  }
}
