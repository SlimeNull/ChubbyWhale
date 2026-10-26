// Typed wrappers around the Rust commands in src-tauri/src.
import { invoke } from "@tauri-apps/api/core";

export type Rect = [number, number, number, number];

export interface Activity {
  appName: string;
  title: string;
  processPath: string;
  isSelf: boolean;
  idleSecs: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface MotionEvent {
  kind: "drag-start" | "dragging" | "flying" | "bump" | "landed" | "glide-end";
  vx: number;
  vy: number;
  impact: number;
  side: "" | "left" | "right" | "top" | "bottom";
}

export const ipc = {
  activity: () => invoke<Activity>("activity"),
  titlePermission: () => invoke<boolean>("title_permission"),
  requestTitlePermission: () => invoke<boolean>("request_title_permission"),

  dragBegin: () => invoke<void>("drag_begin"),
  dragEnd: () => invoke<"click" | "drop" | "throw" | "none">("drag_end"),
  setBody: (body: Rect) => invoke<void>("set_body", { body }),
  setHitRects: (rects: Rect[]) => invoke<void>("set_hit_rects", { rects }),
  fall: () => invoke<void>("fall"),
  glideBy: (dx: number, secs: number) => invoke<number>("glide_by", { dx, secs }),

  storeLoad: <T>(name: "settings" | "memory") => invoke<T | null>("store_load", { name }),
  storeSave: (name: "settings" | "memory", value: unknown) => invoke<void>("store_save", { name, value }),
  dataDir: () => invoke<string>("data_dir"),

  llmChat: (req: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    jsonMode?: boolean;
    temperature?: number;
  }) => invoke<string>("llm_chat", { req }),

  showMenu: () => invoke<void>("show_menu"),
  openSettings: () => invoke<void>("open_settings_window"),
};
