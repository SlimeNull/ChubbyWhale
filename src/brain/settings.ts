import { ipc } from "../ipc";

export type Chattiness = "quiet" | "normal" | "chatty";

export interface Settings {
  /** On-screen size multiplier. */
  size: number;
  /** Watch the foreground app / window title and comment on it. */
  activityAware: boolean;
  /** Comment on web pages (needs window titles). */
  commentOnPages: boolean;
  chattiness: Chattiness;
  llm: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    apiKey: string;
    /** Allow window titles to be sent to the API (otherwise only categories). */
    shareTitles: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  size: 1,
  activityAware: true,
  commentOnPages: true,
  chattiness: "normal",
  llm: {
    enabled: false,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "",
    shareTitles: false,
  },
};

export async function loadSettings(): Promise<Settings> {
  const saved = (await ipc.storeLoad<Partial<Settings>>("settings").catch(() => null)) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved, llm: { ...DEFAULT_SETTINGS.llm, ...(saved.llm ?? {}) } };
}

export function saveSettings(s: Settings) {
  return ipc.storeSave("settings", s);
}

/** Minimum gap between unprompted remarks, in seconds. */
export const REMARK_GAP: Record<Chattiness, number> = { quiet: 600, normal: 200, chatty: 75 };
