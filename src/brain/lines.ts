// Offline lines: the skin's line bank (lines.json). Every line can use
// {placeholders} filled from `vars`.
import { fill, type LineBank } from "../skin";
import { EMOTIONS, type Emotion } from "../pet/pet";
import type { Memory, Stance } from "./memory";

export class Voice {
  constructor(
    private memory: Memory,
    private lines: LineBank,
  ) {}

  has(kind: string) {
    return kind in this.lines;
  }

  /** Pick a line of `kind`, avoiding ones said recently. */
  line(kind: string, vars: Record<string, string | number> = {}): { text: string; emotion: Emotion } {
    const entry = this.lines[kind]?.lines?.length ? this.lines[kind] : this.lines.chatter;
    const options = entry.lines.map((s) => fill(String(s), vars));
    const fresh = options.filter((s) => !this.memory.saidRecently(s));
    const list = fresh.length ? fresh : options;
    // Skins are user-made: an unknown emotion reads as neutral.
    const emotion = EMOTIONS.includes(entry.emotion) ? entry.emotion : "neutral";
    return { text: list[Math.floor(Math.random() * list.length)], emotion };
  }

  topicLine(stance: Stance, again: boolean, vars: Record<string, string>) {
    return this.line(`topic_${stance}${again ? "_again" : ""}`, vars);
  }
}
