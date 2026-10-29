import { listen } from "@tauri-apps/api/event";
import { engine } from "./audio/engine";
import { setVoice } from "./audio/voice";
import { Director } from "./brain/director";
import { Voice } from "./brain/lines";
import { LlmBrain } from "./brain/llm";
import { Memory } from "./brain/memory";
import { loadSettings, SIZE_SCALE, type Settings } from "./brain/settings";
import { ipc } from "./ipc";
import { Bubble } from "./pet/bubble";
import { Fx } from "./pet/fx";
import { Pet } from "./pet/pet";
import { Rig } from "./pet/rig";
import { loadSkin } from "./skin";
import "./styles.css";

const BASE_HEIGHT = 230;

// Keep a log of frontend errors in release builds too (see store::log_error).
const report = (what: string, e: unknown) =>
  ipc.logError(`${new Date().toISOString()} ${what} ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`);
window.addEventListener("error", (e) => report("uncaught", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => report("unhandled", e.reason));

async function main() {
  let settings: Settings = await loadSettings();
  // Dev: VITE_PET_SKIN=<id> wears that skin without touching settings.json.
  const chosenSkin = (import.meta.env.DEV && import.meta.env.VITE_PET_SKIN) || settings.skin;
  const skin = await loadSkin(chosenSkin); // the base skin if that one is gone
  const memory = new Memory(skin.meta.id);
  await memory.load();

  const stage = document.getElementById("stage")!;
  const rig = new Rig();
  // Resize the window to the chosen size; the layout follows the window.
  const applySize = async () => {
    const k = SIZE_SCALE[settings.size];
    rig.height = BASE_HEIGHT * k;
    await ipc.setPetScale(k);
    if (rig.ready) await ipc.setBody(rig.bodyRect());
  };
  await applySize();
  engine.configure(settings.sound);
  setVoice(skin);
  await rig.init(stage, skin);
  const fx = new Fx(rig, rig.fxLayer);
  const bubble = new Bubble();
  const voice = new Voice(memory, skin.lines);
  const pet = new Pet(rig, fx, bubble, voice, memory);
  const llm = new LlmBrain(memory, () => settings, skin.prompts);
  const director = new Director(pet, voice, memory, llm, () => settings, skin);

  if (import.meta.env.DEV) (await import("./debug")).installDebug(rig, pet, fx);
  await pet.start();
  director.start();

  await listen<string>("pet-menu", (e) => {
    if (e.payload === "talk") director.talk();
  });
  await listen("settings-changed", async () => {
    settings = await loadSettings();
    // A new skin changes everything (sprites, lines, voice, memory): start over.
    if (settings.skin !== chosenSkin) {
      location.reload();
      return;
    }
    engine.configure(settings.sound);
    await applySize();
  });
  await listen("memory-cleared", () => memory.clear());
  // The skin she wears was replaced by an import: load the new files.
  await listen("skin-updated", () => location.reload());
}

main().catch((e) => {
  console.error(e);
  report("startup failed", e);
});
