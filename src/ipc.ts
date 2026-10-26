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
  dragEnd: () => invoke<"click" | "drop" | "throw" | "edge-left" | "edge-right" | "none">("drag_end"),
  setBody: (body: Rect) => invoke<void>("set_body", { body }),
  setHitRects: (rects: Rect[]) => invoke<void>("set_hit_rects", { rects }),
  /** Where the speech bubble should point: [head x, head top, head half-width], or null when hidden. */
  setBubble: (anchor: [number, number, number] | null) => invoke<void>("set_bubble", { anchor }),
  fall: () => invoke<void>("fall"),
  /**
   * Move by `dx` at `speed` px/s; resolves to the actual distance once the move has started.
   * `span`: window-local [left, right] of what is drawn while moving, kept on screen.
   */
  glideBy: (dx: number, speed: number, linear = false, span?: [number, number]) =>
    invoke<number>("glide_by", { dx, speed, linear, span: span ?? null }),
  setPetScale: (factor: number) => invoke<void>("set_pet_scale", { factor }),
  /** Slide so window-local x `edgeX` sits on that screen edge; `top..bottom` stays on screen. */
  dock: (side: "left" | "right", edgeX: number, top: number, bottom: number) => invoke<void>("dock", { side, edgeX, top, bottom }),

  storeLoad: <T>(name: "settings" | "memory") => invoke<T | null>("store_load", { name }),
  storeSave: (name: "settings" | "memory", value: unknown) => invoke<void>("store_save", { name, value }),
  dataDir: () => invoke<string>("data_dir"),
  /** Append a line to frontend.log in the app log dir. */
  logError: (line: string) => invoke<void>("log_error", { line }).catch(() => {}),

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
