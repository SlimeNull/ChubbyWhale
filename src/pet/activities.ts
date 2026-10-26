// Things she does on her own when left alone: everyday activities while
// standing on the screen, and small motions while hiding at a screen side.
import type { VoiceKind } from "../audio/voice";
import type { FxKind } from "./fx";
import type { PoseName } from "./rig";

export interface Activity {
  id: string;
  /** One pose, or several looped at `fps` (e.g. chewing). */
  frames: PoseName[];
  fps?: number;
  /** Duration range in seconds. */
  secs: [number, number];
  /** Relative chance of being picked. */
  weight: number;
  /** Repeating effect while it lasts. */
  fx?: { kind: FxKind; everyMs: number; count?: number };
  voiceStart?: VoiceKind;
  voiceEnd?: VoiceKind;
  /** Line kind said at the start, with probability `talk` (default 0.4). */
  line?: string;
  talk?: number;
  /** Rocks side to side with this lean amplitude (e.g. to music). */
  sway?: number;
}

export const ACTIVITIES: Activity[] = [
  { id: "eat", frames: ["eat", "eat_b"], fps: 2.5, secs: [8, 14], weight: 1.5, fx: { kind: "heart", everyMs: 3200 }, line: "actEat", voiceEnd: "happy" },
  // Mostly concentrating, with the occasional "yes!" frame.
  { id: "game", frames: ["game", "game", "game", "game_b"], fps: 1.2, secs: [10, 18], weight: 1.5, fx: { kind: "exclaim", everyMs: 3300 }, line: "actGame", voiceEnd: "cheer" },
  { id: "read", frames: ["read"], secs: [12, 22], weight: 1.2, fx: { kind: "sparkle", everyMs: 6000 }, line: "actRead", talk: 0.3 },
  { id: "tea", frames: ["tea"], secs: [6, 10], weight: 1.2, fx: { kind: "heart", everyMs: 2500 }, line: "actTea", voiceEnd: "happy" },
  { id: "music", frames: ["music"], secs: [8, 14], weight: 1.2, fx: { kind: "note", everyMs: 1200 }, voiceStart: "hum", line: "actMusic", talk: 0.3, sway: 0.04 },
  { id: "phone", frames: ["phone"], secs: [8, 14], weight: 1, fx: { kind: "question", everyMs: 5000 }, line: "actPhone", talk: 0.3 },
  { id: "draw", frames: ["draw"], secs: [10, 16], weight: 1, fx: { kind: "sparkle", everyMs: 4000 }, line: "actDraw" },
];

/** Small motions while peeking from a screen side. */
export type PeekMotion = "wave" | "smile" | "tuck" | "lean-out" | "tilt" | "curious" | "doze";

export const PEEK_MOTIONS: [PeekMotion, number][] = [
  ["wave", 2],
  ["smile", 2],
  ["tuck", 1.5], // duck back behind the edge, then peek out again
  ["lean-out", 1.5], // crane her head out (hands stay on the edge)
  ["tilt", 2], // tilt her head side to side
  ["curious", 1.5],
  ["doze", 0.7],
];
