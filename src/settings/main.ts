import { emit } from "@tauri-apps/api/event";
import { STANCE_LABEL, type MemoryData } from "../brain/memory";
import { loadSettings, saveSettings, type Settings } from "../brain/settings";
import { ipc } from "../ipc";
import "./settings.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings;

function fill() {
  $<HTMLInputElement>("size").value = String(settings.size);
  $<HTMLOutputElement>("sizeOut").value = `${Math.round(settings.size * 100)}%`;
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
    size: Number($<HTMLInputElement>("size").value),
    activityAware: $<HTMLInputElement>("activityAware").checked,
    commentOnPages: $<HTMLInputElement>("commentOnPages").checked,
    chattiness: $<HTMLSelectElement>("chattiness").value as Settings["chattiness"],
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
  $<HTMLOutputElement>("sizeOut").value = `${Math.round(settings.size * 100)}%`;
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

async function main() {
  settings = await loadSettings();
  fill();
  for (const el of document.querySelectorAll("input, select")) {
    el.addEventListener("change", persist);
  }
  $("size").addEventListener("input", persist);

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
