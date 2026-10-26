import { emit } from "@tauri-apps/api/event";
import { engine } from "../audio/engine";
import { playSfx, SFX_NAMES } from "../audio/sfx";
import { loadVoiceClips, playVoice, VOICE_KINDS } from "../audio/voice";
import { STANCE_LABEL, type MemoryData } from "../brain/memory";
import { loadSettings, saveSettings, type Settings } from "../brain/settings";
import { ipc } from "../ipc";
import "./settings.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings;

function fill() {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="size"]')) r.checked = r.value === settings.size;
  $<HTMLInputElement>("volume").value = String(settings.sound.volume);
  $<HTMLOutputElement>("volumeOut").value = `${Math.round(settings.sound.volume * 100)}%`;
  $<HTMLInputElement>("effects").checked = settings.sound.effects;
  $<HTMLInputElement>("voice").checked = settings.sound.voice;
  $<HTMLInputElement>("activityAware").checked = settings.activityAware;
  $<HTMLInputElement>("commentOnPages").checked = settings.commentOnPages;
  $<HTMLSelectElement>("chattiness").value = settings.chattiness;
  $<HTMLInputElement>("llmEnabled").checked = settings.llm.enabled;
  $<HTMLInputElement>("baseUrl").value = settings.llm.baseUrl;
  $<HTMLInputElement>("model").value = settings.llm.model;
  $<HTMLInputElement>("apiKey").value = settings.llm.apiKey;
  $<HTMLInputElement>("shareTitles").checked = settings.llm.shareTitles;
}

function read(): Settings {
  return {
    size: (document.querySelector<HTMLInputElement>('input[name="size"]:checked')?.value ?? "medium") as Settings["size"],
    activityAware: $<HTMLInputElement>("activityAware").checked,
    commentOnPages: $<HTMLInputElement>("commentOnPages").checked,
    chattiness: $<HTMLSelectElement>("chattiness").value as Settings["chattiness"],
    sound: {
      volume: Number($<HTMLInputElement>("volume").value),
      effects: $<HTMLInputElement>("effects").checked,
      voice: $<HTMLInputElement>("voice").checked,
    },
    llm: {
      enabled: $<HTMLInputElement>("llmEnabled").checked,
      baseUrl: $<HTMLInputElement>("baseUrl").value.trim() || "https://api.deepseek.com",
      model: $<HTMLInputElement>("model").value.trim() || "deepseek-chat",
      apiKey: $<HTMLInputElement>("apiKey").value.trim(),
      shareTitles: $<HTMLInputElement>("shareTitles").checked,
    },
  };
}

async function persist() {
  settings = read();
  $<HTMLOutputElement>("volumeOut").value = `${Math.round(settings.sound.volume * 100)}%`;
  engine.configure(settings.sound);
  await saveSettings(settings);
  await emit("settings-changed");
}

async function showMemory() {
  const mem = await ipc.storeLoad<MemoryData>("memory");
  const list = $("opinions");
  list.replaceChildren();
  const ops = Object.values(mem?.opinions ?? {});
  if (!ops.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "还没有形成喜好~";
    list.append(li);
  }
  for (const o of ops) {
    const li = document.createElement("li");
    li.innerHTML = `<b></b><span class="stance ${o.stance}"></span><q></q>`;
    li.querySelector("b")!.textContent = o.label;
    li.querySelector(".stance")!.textContent = STANCE_LABEL[o.stance];
    li.querySelector("q")!.textContent = o.firstSaid ?? "";
    list.append(li);
  }
}

const SFX_LABEL: Record<string, string> = {
  pop: "戳一下", pickup: "拎起来", whoosh: "丢出去", boing: "撞墙", thud: "摔地上",
  softland: "落地", dizzy: "眩晕", puff: "放下", sparkle: "闪闪", step: "脚步",
};
const VOICE_LABEL: Record<string, string> = {
  neutral: "平常", happy: "开心", giggle: "偷笑", surprised: "惊讶", curious: "好奇", shy: "害羞",
  hurt: "好痛", cry: "大哭", dizzy: "晕乎乎", sleepy: "困", cheer: "加油", angry: "生气",
  scared: "害怕", fly: "飞~", hum: "哼歌", sigh: "叹气",
};

function addPreviewButtons() {
  const add = (host: string, label: string, play: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.addEventListener("click", () => {
      engine.unlock();
      play();
    });
    $(host).append(b);
  };
  for (const n of SFX_NAMES) add("sfxButtons", SFX_LABEL[n] ?? n, () => playSfx(n, n === "boing" || n === "thud" ? 0.7 : 0.6));
  for (const k of VOICE_KINDS) add("voiceButtons", VOICE_LABEL[k] ?? k, () => playVoice(k));
}

async function main() {
  settings = await loadSettings();
  fill();
  for (const el of document.querySelectorAll("input, select")) {
    el.addEventListener("change", persist);
  }
  $("volume").addEventListener("input", persist);
  engine.configure(settings.sound);
  loadVoiceClips();
  addPreviewButtons();

  if (!(await ipc.titlePermission())) {
    $("permission").hidden = false;
    $("grant").addEventListener("click", async () => {
      await ipc.requestTitlePermission();
      $("permission").textContent = "授权后需要重启大肥鱼才能生效。";
    });
  }

  $("test").addEventListener("click", async () => {
    const out = $("testOut");
    out.textContent = "等待回复…";
    const s = read();
    try {
      const reply = await ipc.llmChat({
        baseUrl: s.llm.baseUrl,
        apiKey: s.llm.apiKey,
        model: s.llm.model,
        messages: [{ role: "user", content: "用一句话可爱地打个招呼，不超过 20 字。" }],
      });
      out.textContent = `✓ ${reply}`;
    } catch (e) {
      out.textContent = `✗ ${e}`;
    }
  });

  $("clear").addEventListener("click", async () => {
    if (!confirm("确定要清空大肥鱼的全部记忆吗？她会忘记说过的话和形成的喜好。")) return;
    await emit("memory-cleared");
    setTimeout(showMemory, 800);
  });

  $("dataDir").textContent = `数据目录：${await ipc.dataDir()}`;
  await showMemory();
  window.addEventListener("focus", showMemory);
}

main();
