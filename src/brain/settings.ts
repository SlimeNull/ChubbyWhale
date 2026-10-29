import type { SoundSettings } from "../audio/engine";
import { ipc } from "../ipc";

export type Chattiness = "quiet" | "normal" | "chatty";
export type PetSize = "small" | "medium" | "large";

/** Scale of the pet (and its window) for each size; 1 = 230px tall. */
export const SIZE_SCALE: Record<PetSize, number> = { small: 0.55, medium: 0.75, large: 1 };

export interface Settings {
  /** Id of the skin she wears (skins/<id>/ or an imported one). */
  skin: string;
  size: PetSize;
  /** Watch the foreground app / window title and comment on it. */
  activityAware: boolean;
  /** Comment on web pages (needs window titles). */
  commentOnPages: boolean;
  chattiness: Chattiness;
  sound: SoundSettings;
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
  skin: "standard",
  size: "medium",
  activityAware: true,
  commentOnPages: true,
  chattiness: "normal",
  sound: { volume: 0.6, effects: true, voice: true },
  llm: {
    enabled: false,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "",
    shareTitles: false,
  },
};

/** Older versions stored size as a number (0.7–1.3). */
function migrateSize(size: unknown): PetSize {
  if (size === "small" || size === "medium" || size === "large") return size;
  if (typeof size === "number") return size < 0.88 ? "small" : size > 1.15 ? "large" : "medium";
  return DEFAULT_SETTINGS.size;
}

export async function loadSettings(): Promise<Settings> {
  const saved = (await ipc.storeLoad<Partial<Settings>>("settings").catch(() => null)) ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    skin: typeof saved.skin === "string" && saved.skin ? saved.skin : DEFAULT_SETTINGS.skin,
    size: migrateSize(saved.size),
    sound: { ...DEFAULT_SETTINGS.sound, ...(saved.sound ?? {}) },
    llm: { ...DEFAULT_SETTINGS.llm, ...(saved.llm ?? {}) },
  };
}

export function saveSettings(s: Settings) {
  return ipc.storeSave("settings", s);
}

/** Minimum gap between unprompted remarks, in seconds. */
export const REMARK_GAP: Record<Chattiness, number> = { quiet: 600, normal: 200, chatty: 75 };
