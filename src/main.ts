import { listen } from "@tauri-apps/api/event";
import { Director } from "./brain/director";
import { Voice } from "./brain/lines";
import { LlmBrain } from "./brain/llm";
import { Memory } from "./brain/memory";
import { loadSettings, type Settings } from "./brain/settings";
import { ipc } from "./ipc";
import { Bubble } from "./pet/bubble";
import { Fx } from "./pet/fx";
import { Pet } from "./pet/pet";
import { Rig } from "./pet/rig";
import "./styles.css";

const BASE_HEIGHT = 230;

async function main() {
  let settings: Settings = await loadSettings();
  const memory = new Memory();
  await memory.load();

  const stage = document.getElementById("stage")!;
  const rig = new Rig();
  rig.height = BASE_HEIGHT * settings.size;
  await rig.init(stage);
  const fx = new Fx(rig, rig.fxLayer);
  const bubble = new Bubble(stage);
  const voice = new Voice(memory);
  const pet = new Pet(rig, fx, bubble, voice, memory);
  const llm = new LlmBrain(memory, () => settings);
  const director = new Director(pet, voice, memory, llm, () => settings);

  if (import.meta.env.DEV) (await import("./debug")).installDebug(rig, pet, fx);
  await pet.start();
  director.start();

  await listen<string>("pet-menu", (e) => {
    if (e.payload === "talk") director.talk();
  });
  await listen("settings-changed", async () => {
    settings = await loadSettings();
    rig.height = BASE_HEIGHT * settings.size;
    await ipc.setBody(rig.bodyRect());
  });
  await listen("memory-cleared", () => memory.clear());
}

main().catch((e) => console.error(e));
