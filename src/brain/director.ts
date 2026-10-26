// Decides when she speaks up, based on what the user is doing.
import { ipc, type Activity } from "../ipc";
import type { Pet } from "../pet/pet";
import type { Voice } from "./lines";
import type { LlmBrain } from "./llm";
import type { Memory, Stance } from "./memory";
import { REMARK_GAP, type Settings } from "./settings";
import { classify, pickStance, type Kind, type Situation, type Topic } from "./topics";

const POLL_MS = 2000;
const SLEEP_AFTER_IDLE = 5 * 60; // seconds of no input before she dozes off
const PAGE_DWELL = 25; // seconds on a page before commenting on its topic
const TOPIC_COOLDOWN = 40 * 60e3;

/** Minimum time in a kind of activity before remarking, and the cooldown after. */
const KIND_RULES: Partial<Record<Kind, { dwell: number; cooldown: number }>> = {
  code: { dwell: 120, cooldown: 12 * 60e3 },
  terminal: { dwell: 90, cooldown: 20 * 60e3 },
  doc: { dwell: 120, cooldown: 12 * 60e3 },
  design: { dwell: 120, cooldown: 20 * 60e3 },
  video: { dwell: 60, cooldown: 20 * 60e3 },
  chat: { dwell: 60, cooldown: 25 * 60e3 },
  music: { dwell: 60, cooldown: 30 * 60e3 },
  mail: { dwell: 90, cooldown: 30 * 60e3 },
  game: { dwell: 60, cooldown: 30 * 60e3 },
  browser: { dwell: 90, cooldown: 25 * 60e3 },
};

const KIND_LINE: Partial<Record<Kind, string>> = { browser: "browse" };

const KIND_DESC: Record<Kind, string> = {
  code: "写代码",
  terminal: "在终端里敲命令",
  doc: "编辑文档",
  browser: "浏览网页",
  video: "看视频",
  game: "玩游戏",
  chat: "和别人聊天",
  music: "听音乐",
  design: "画画或做设计",
  mail: "处理邮件",
  other: "使用电脑",
};

export class Director {
  private current = { key: "", since: Date.now() };
  private kindSince = { kind: "other" as Kind, since: Date.now() };
  private lastRemark = Date.now();
  private cooldowns = new Map<string, number>();
  private asleepSince = 0;
  private thinking = false;
  private lastSituation: Situation | null = null;

  constructor(
    private pet: Pet,
    private voice: Voice,
    private memory: Memory,
    private llm: LlmBrain,
    private settings: () => Settings,
  ) {
    pet.onSaid = (text, kind) => {
      this.lastRemark = Date.now();
      memory.recordSaid(text, kind.startsWith("topic:") ? kind.slice(6) : undefined, kind);
    };
  }

  start() {
    setTimeout(() => this.greet(), 2500);
    setInterval(() => this.tick().catch((e) => console.warn("director", e)), POLL_MS);
  }

  private greet() {
    const h = new Date().getHours();
    const kind = h < 5 ? "lateNight" : h < 11 ? "morning" : h < 14 ? "noon" : h < 18 ? "afternoon" : h < 23 ? "evening" : "lateNight";
    this.pet.speak(kind);
  }

  /** Tray "talk to her": always answers, LLM if available. */
  async talk() {
    const s = this.lastSituation;
    const desc = s ? this.describe(s, 0) : "用户点了一下你，想和你说说话。";
    if (await this.sayWithLlm(`${desc}\n用户主动想和你说说话，随便聊一句吧。`, [])) return;
    this.pet.speak(chanceOf(0.5) && s && s.kind !== "other" ? (KIND_LINE[s.kind] ?? s.kind) : "chatter", { mins: 0, file: s?.file ?? "" });
  }

  private async tick() {
    const a = await ipc.activity();
    const settings = this.settings();

    // Sleep while the user is away; wake up when they come back.
    if (a.idleSecs > SLEEP_AFTER_IDLE && !this.pet.sleeping && !this.pet.busy) {
      this.pet.sleep();
      this.asleepSince = Date.now();
    } else if (this.pet.sleeping && a.idleSecs < 3) {
      const long = Date.now() - this.asleepSince > 2 * 60e3;
      this.pet.wake(long);
    }
    if (this.pet.sleeping || a.idleSecs > 60) return;

    if (a.isSelf || (!a.appName && !a.title)) return;
    const sit = this.observe(a);
    if (!settings.activityAware || this.pet.busy || this.thinking) return;

    const gap = REMARK_GAP[settings.chattiness] * 1000;
    const now = Date.now();
    if (now - this.lastRemark < gap) return;

    const dwell = (now - this.current.since) / 1000;
    const kindDwell = (now - this.kindSince.since) / 1000;

    // 1) Something recognizable on screen (game, product, site…)
    if (settings.commentOnPages && dwell > PAGE_DWELL) {
      const topic = sit.topics.find((t) => now - (this.cooldowns.get(t.id) ?? 0) > TOPIC_COOLDOWN);
      if (topic) {
        this.cooldowns.set(topic.id, now);
        return this.commentTopic(sit, topic, dwell);
      }
    }

    // 2) The activity itself (coding, writing…)
    const rule = KIND_RULES[sit.kind];
    if (rule && kindDwell > rule.dwell && now - (this.cooldowns.get(`kind:${sit.kind}`) ?? 0) > rule.cooldown) {
      this.cooldowns.set(`kind:${sit.kind}`, now);
      return this.commentKind(sit, kindDwell);
    }

    // 3) Otherwise an occasional bit of chatter.
    if (now - this.lastRemark > gap * 2 && chanceOf(0.15)) {
      if (await this.sayWithLlm(`${this.describe(sit, kindDwell)}\n随便说一句闲聊或关心的话。`, [])) return;
      this.pet.speak(chanceOf(0.3) ? "missYou" : "chatter");
    }
  }

  private observe(a: Activity): Situation {
    const sit = classify(a);
    this.lastSituation = sit;
    const key = `${sit.app}\u0000${sit.title}`;
    if (key !== this.current.key) this.current = { key, since: Date.now() };
    if (sit.kind !== this.kindSince.kind) this.kindSince = { kind: sit.kind, since: Date.now() };
    return sit;
  }

  private describe(sit: Situation, secs: number) {
    const share = this.settings().llm.shareTitles;
    const mins = Math.round(secs / 60);
    const parts = [`用户正在${KIND_DESC[sit.kind]}（应用：${sit.app || "未知"}${mins ? `，已经持续约 ${mins} 分钟` : ""}）。`];
    if (share && sit.title) parts.push(`窗口标题：「${sit.title.slice(0, 120)}」。`);
    if (sit.file) parts.push(`正在编辑的文件：${sit.file}。`);
    if (sit.topics.length) parts.push(`识别到的话题：${sit.topics.map((t) => t.label).join("、")}。`);
    if (sit.price) parts.push(`页面上的价格：${sit.price}。`);
    return parts.join("");
  }

  private async sayWithLlm(prompt: string, known: { id: string; label: string; stance?: Stance }[]) {
    if (!this.llm.enabled) return false;
    this.thinking = true;
    try {
      const r = await this.llm.remark(prompt, known);
      if (!r || this.pet.mode === "drag" || this.pet.mode === "fly") return false;
      this.pet.say(r.text, r.emotion, r.topicId ? `topic:${r.topicId}` : "llm");
      if (r.topicId) this.memory.mention(r.topicId, r.text);
      return true;
    } finally {
      this.thinking = false;
    }
  }

  private async commentTopic(sit: Situation, topic: Topic, dwell: number) {
    // Games, the ocean and AIs get a stance that is fixed the first time it comes up.
    const opinionated = topic.type === "game" || topic.type === "ai" || topic.stance;
    const op = opinionated ? this.memory.decide(topic.id, topic.label, () => topic.stance ?? pickStance(topic)) : undefined;
    const again = !!op && op.mentions > 0;

    const known = op ? [{ id: topic.id, label: topic.label, stance: op.stance }] : [{ id: topic.id, label: topic.label }];
    const hint = op ? `请对"${topic.label}"发表一句评价${again ? "（你以前评价过它，可以提到这一点）" : ""}。` : `请针对"${topic.label}"说一句话。`;
    if (await this.sayWithLlm(`${this.describe(sit, dwell)}\n${hint}`, known)) return;

    let line;
    if (topic.type === "game") line = this.voice.topicLine(op!.stance, again, { label: topic.label });
    else if (topic.type === "product") line = this.voice.line(sit.price ? "productPrice" : "product", { label: topic.label, price: sit.price ?? "" });
    else if (topic.type === "ai") line = this.voice.line(topic.id === "deepseek" ? "ai_deepseek" : "ai_other");
    else if (this.voice.has(`${topic.type}_${topic.id}`)) line = this.voice.line(`${topic.type}_${topic.id}`);
    else line = this.voice.line(topic.type === "shop" ? "shop" : "browse", { label: topic.label });

    this.pet.say(line.text, line.emotion, `topic:${topic.id}`);
    if (op) this.memory.mention(topic.id, line.text);
  }

  private async commentKind(sit: Situation, secs: number) {
    const mins = Math.round(secs / 60);
    if (await this.sayWithLlm(`${this.describe(sit, secs)}\n请对用户正在做的事说一句话（鼓励、好奇或关心）。`, [])) return;
    let kind = KIND_LINE[sit.kind] ?? sit.kind;
    if (sit.kind === "code" && mins >= 60 && chanceOf(0.6)) kind = "codeLong";
    else if (sit.kind === "code" && sit.file && chanceOf(0.5)) kind = "codeFile";
    if (!this.voice.has(kind)) return;
    this.pet.speak(kind, { mins, file: sit.file ?? "" });
  }
}

function chanceOf(p: number) {
  return Math.random() < p;
}
