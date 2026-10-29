import { emit } from "@tauri-apps/api/event";
import { engine } from "../audio/engine";
import { playSfx, SFX_NAMES } from "../audio/sfx";
import { playVoice, setVoice, VOICE_KINDS } from "../audio/voice";
import { loadMemoryData, STANCE_LABEL } from "../brain/memory";
import { loadSettings, saveSettings, type Settings } from "../brain/settings";
import { ipc, type SkinMeta } from "../ipc";
import { BASE_SKIN, loadSkin, type Skin } from "../skin";
import "./settings.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings;
/** The chosen skin, loaded (voice previews, LLM test, avatar). */
let skin: Skin;

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
    skin: settings.skin,
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
  $("memorySkin").textContent = skin.meta.name;
  const mem = await loadMemoryData(skin.meta.id);
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

// ---------- skins ----------

/** Object URLs of skin thumbnails, by skin id. */
const thumbs = new Map<string, string>();

async function thumb(id: string) {
  let url = thumbs.get(id);
  if (!url) {
    url = URL.createObjectURL(new Blob([await ipc.skinFile(id, "sprites/idle.webp")], { type: "image/webp" }));
    thumbs.set(id, url);
  }
  return url;
}

async function useSkin(id: string) {
  skin = await loadSkin(id);
  setVoice(skin);
  $<HTMLImageElement>("avatar").src = await thumb(skin.meta.id);
  await showMemory();
}

async function showSkins() {
  const skins = await ipc.skinList();
  const host = $("skins");
  host.replaceChildren();
  for (const s of skins) host.append(await skinCard(s));
}

async function skinCard(s: SkinMeta) {
  const card = document.createElement("label");
  card.className = "skin";
  card.innerHTML = `<input type="radio" name="skin" /><img alt="" /><div class="info"><b></b><p class="muted small"></p></div><div class="buttons"></div>`;
  const radio = card.querySelector("input")!;
  radio.value = s.id;
  radio.checked = s.id === skin.meta.id;
  radio.addEventListener("change", async () => {
    settings.skin = s.id;
    await useSkin(s.id);
    await persist();
  });
  card.querySelector("img")!.src = await thumb(s.id).catch(() => "");
  const title = card.querySelector("b")!;
  title.textContent = s.name;
  if (s.builtin) title.insertAdjacentHTML("beforeend", `<span class="badge">内置</span>`);
  card.querySelector("p")!.textContent = [s.author && `作者：${s.author}`, s.description].filter(Boolean).join(" · ");
  card.title = [s.name, s.version && `版本 ${s.version}`, s.license && `许可：${s.license}`, s.description].filter(Boolean).join("\n");

  const buttons = card.querySelector(".buttons")!;
  const button = (label: string, cls: string, run: () => Promise<void>) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = cls;
    b.addEventListener("click", async (e) => {
      e.preventDefault(); // don't select the card
      try {
        await run();
      } catch (err) {
        $("skinOut").textContent = `✗ ${err}`;
      }
    });
    buttons.append(b);
  };
  button("导出", "", async () => {
    const path = await ipc.skinExport(s.id);
    if (path) $("skinOut").textContent = `已导出到 ${path}`;
  });
  if (!s.builtin) {
    button("删除", "danger", async () => {
      if (!confirm(`确定要删除皮肤「${s.name}」吗？它的记忆会保留，重新导入后还能找回。`)) return;
      await ipc.skinDelete(s.id);
      thumbs.delete(s.id);
      if (settings.skin === s.id) {
        settings.skin = BASE_SKIN;
        await useSkin(BASE_SKIN);
        await persist();
      }
      $("skinOut").textContent = `已删除「${s.name}」`;
      await showSkins();
    });
  }
  return card;
}

async function importSkin() {
  const out = $("skinOut");
  out.textContent = "";
  let pick;
  try {
    pick = await ipc.skinImportPick();
  } catch (e) {
    out.textContent = `✗ 无法导入：${e}`;
    return;
  }
  if (!pick) return;
  if (pick.exists && !confirm(`已经有一个 id 为「${pick.id}」的皮肤了。要用「${pick.name}」替换它吗？`)) return;
  try {
    const meta = await ipc.skinImportInstall(pick.path);
    thumbs.delete(meta.id);
    out.textContent = `✓ 已导入「${meta.name}」`;
    await showSkins();
    // A replaced skin that is in use: reload her with the new files.
    if (settings.skin === meta.id) {
      await useSkin(meta.id);
      await emit("skin-updated");
    }
  } catch (e) {
    out.textContent = `✗ 无法导入：${e}`;
  }
}

async function main() {
  settings = await loadSettings();
  skin = await loadSkin(settings.skin);
  setVoice(skin);
  $<HTMLImageElement>("avatar").src = await thumb(skin.meta.id);
  fill();
  await showSkins();
  $("importSkin").addEventListener("click", importSkin);
  for (const el of document.querySelectorAll("input:not([name=skin]), select")) {
    el.addEventListener("change", persist);
  }
  $("volume").addEventListener("input", persist);
  engine.configure(settings.sound);
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
        messages: [
          { role: "system", content: skin.prompts.persona },
          { role: "user", content: skin.prompts.tasks.test },
        ],
      });
      out.textContent = `✓ ${reply}`;
    } catch (e) {
      out.textContent = `✗ ${e}`;
    }
  });

  $("clear").addEventListener("click", async () => {
    if (!confirm(`确定要清空「${skin.meta.name}」的全部记忆吗？她会忘记说过的话和形成的喜好。`)) return;
    await emit("memory-cleared");
    setTimeout(showMemory, 800);
  });

  $("dataDir").textContent = `数据目录：${await ipc.dataDir()}`;
  await showMemory();
  window.addEventListener("focus", showMemory);
}

main();
