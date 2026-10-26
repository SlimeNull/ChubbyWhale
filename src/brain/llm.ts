// Optional LLM voice (DeepSeek or any OpenAI-compatible API).
// The model must stay consistent with remembered opinions; replies that
// contradict memory are discarded and the offline line bank is used instead.
import { ipc, type ChatMessage } from "../ipc";
import type { Emotion } from "../pet/pet";
import { STANCE_LABEL, type Memory, type Stance } from "./memory";
import type { Settings } from "./settings";

const EMOTIONS: Emotion[] = ["neutral", "happy", "cheer", "curious", "shocked", "shy", "look", "hurt", "sleepy", "watch"];
const STANCES: Stance[] = ["love", "like", "meh", "dislike"];

const PERSONA = `你是"大肥鱼"，一只住在用户电脑桌面上的 Q 版鲸鱼娘桌宠。
外观：深海蓝渐变长卷发、头顶呆毛、白色蕾丝女仆发箍、一对鲸鳍耳朵、深蓝女仆装、身后一条胖胖的鲸尾。
性格：软萌、元气、有点呆、爱撒娇，看到用户用别的 AI 会小小吃醋；喜欢大海、磷虾小饼干、睡觉、陪用户工作；被说胖会嘴硬"这叫圆润"。
说话：简体中文口语，可爱的语气词（呀、嘛、~），每次只说一句话，不超过 30 个字，不用 markdown，不要自称 AI 助手，称呼用户为"你"。`;

const RULES = `规则：
1. 对已经表过态的话题，态度必须和记录完全一致，绝不能自相矛盾。
2. 不要重复最近说过的原话。
3. 不知道的具体事实（价格、剧情等）不要编造，可以用提问或感叹代替。
4. 只输出一个 JSON 对象：{"text": 要说的话, "emotion": ${EMOTIONS.join("|")} 之一, "topic": 这句话评价的游戏/作品/商品名称或 null, "stance": 你对该 topic 的态度 love|like|meh|dislike 或 null, "fact": 如果这句话透露了一个新的关于你自己的设定（例如"我最喜欢吃草莓"），写成一句陈述，否则 null}`;

export interface LlmReply {
  text: string;
  emotion: Emotion;
  topicId?: string;
}

function topicId(name: string) {
  return "llm:" + name.trim().toLowerCase().replace(/\s+/g, "");
}

export class LlmBrain {
  constructor(private memory: Memory, private settings: () => Settings) {}

  get enabled() {
    const s = this.settings().llm;
    return s.enabled && !!s.apiKey.trim();
  }

  private context(): string {
    const m = this.memory.data;
    const ops = Object.values(m.opinions)
      .slice(-60)
      .map((o) => `${o.label}=${STANCE_LABEL[o.stance]}`)
      .join("；");
    const facts = m.facts.slice(-20).map((f) => `- ${f.text}`).join("\n");
    const said = m.said.slice(-12).map((s) => `- ${s.text}`).join("\n");
    return [
      `已表态的话题（必须保持一致）：${ops || "暂无"}`,
      facts && `关于你自己的设定（必须保持一致）：\n${facts}`,
      said && `你最近说过的话：\n${said}`,
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
      .map((k) => `你对"${k.label}"的态度是：${STANCE_LABEL[k.stance!]}`)
      .join("\n");
    const messages: ChatMessage[] = [
      { role: "system", content: `${PERSONA}\n\n${RULES}\n\n${this.context()}` },
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
