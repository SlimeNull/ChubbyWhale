// Decides when she speaks up, based on what the user is doing.
import { ipc, type Activity } from "../ipc";
import type { Pet } from "../pet/pet";
import { fill, type Skin } from "../skin";
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
    private skin: Skin,
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
    const tasks = this.skin.prompts.tasks;
    const desc = s ? this.describe(s, 0) : tasks.talkNoContext;
    if (await this.sayWithLlm(`${desc}\n${tasks.talk}`, [])) return;
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
      if (await this.sayWithLlm(`${this.describe(sit, kindDwell)}\n${this.skin.prompts.tasks.chatter}`, [])) return;
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
    const p = this.skin.prompts.situation;
    const parts = [
      fill(p.doing, {
        kind: p.kinds[sit.kind] ?? p.kinds.other ?? sit.kind,
        app: sit.app || p.unknownApp,
        duration: mins ? fill(p.duration, { mins }) : "",
      }),
    ];
    if (share && sit.title) parts.push(fill(p.title, { title: sit.title.slice(0, 120) }));
    if (sit.file) parts.push(fill(p.file, { file: sit.file }));
    if (sit.topics.length) parts.push(fill(p.topics, { topics: sit.topics.map((t) => t.label).join("、") }));
    if (sit.price) parts.push(fill(p.price, { price: sit.price }));
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
    // Games, AIs and topics the skin has a stance on get a stance that is fixed the first time it comes up.
    const preset = this.skin.opinions.stances[topic.id];
    const opinionated = topic.type === "game" || topic.type === "ai" || preset;
    const op = opinionated ? this.memory.decide(topic.id, topic.label, () => preset ?? pickStance(topic, this.skin.opinions)) : undefined;
    const again = !!op && op.mentions > 0;

    const known = op ? [{ id: topic.id, label: topic.label, stance: op.stance }] : [{ id: topic.id, label: topic.label }];
    const tasks = this.skin.prompts.tasks;
    const hint = fill(op ? (again ? tasks.opinionAgain : tasks.opinion) : tasks.topic, { label: topic.label });
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
    if (await this.sayWithLlm(`${this.describe(sit, secs)}\n${this.skin.prompts.tasks.kind}`, [])) return;
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
