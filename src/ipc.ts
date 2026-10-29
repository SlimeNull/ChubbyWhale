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

export type StoreName = "settings" | "memory" | `memory-${string}`;

export interface SkinMeta {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  license: string;
  format: number;
  /** Ships with the app (can't be deleted or replaced). */
  builtin: boolean;
}

/** A checked skin package, not installed yet. */
export interface SkinImport extends Omit<SkinMeta, "builtin"> {
  path: string;
  /** An imported skin with this id exists and will be replaced. */
  exists: boolean;
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
  /** Logical px; the feet (bottom center) stay put. */
  setPetSize: (width: number, height: number) => invoke<void>("set_pet_size", { width, height }),
  /** Slide so window-local x `edgeX` sits on that screen edge; `top..bottom` stays on screen. */
  dock: (side: "left" | "right", edgeX: number, top: number, bottom: number) => invoke<void>("dock", { side, edgeX, top, bottom }),

  /** "memory-<skin id>": that skin's memory; "memory": the file from before skins (migration only). */
  storeLoad: <T>(name: StoreName) => invoke<T | null>("store_load", { name }),
  storeSave: (name: StoreName, value: unknown) => invoke<void>("store_save", { name, value }),
  dataDir: () => invoke<string>("data_dir"),
  skinList: () => invoke<SkinMeta[]>("skin_list"),
  /** Raw bytes of `path` (e.g. "sprites/idle.webp") in skin `id`. */
  skinFile: (id: string, path: string) => invoke<ArrayBuffer>("skin_file", { id, path }),
  /** Ask for a .zip and check it; null if the dialog was cancelled. */
  skinImportPick: () => invoke<SkinImport | null>("skin_import_pick"),
  skinImportInstall: (path: string) => invoke<Omit<SkinMeta, "builtin">>("skin_import_install", { path }),
  /** Save skin `id` as a .zip; resolves to the path, or null if cancelled. */
  skinExport: (id: string) => invoke<string | null>("skin_export", { id }),
  skinDelete: (id: string) => invoke<void>("skin_delete", { id }),

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
