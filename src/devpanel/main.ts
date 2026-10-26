// Debug panel (dev builds only): buttons that send commands to the pet window,
// plus a live readout of her state. Commands are handled in src/debug.ts.
import { emitTo, listen } from "@tauri-apps/api/event";
import "./devpanel.css";

type Cmd = [label: string, cmd: string, arg?: unknown];

const GROUPS: [title: string, cmds: Cmd[]][] = [
  ["状态", [["回到休息", "rest"], ["睡觉", "sleep"], ["醒来", "wake"], ["说一句", "say"], ["戳一下", "poke"]]],
  ["视线", [
    ["看前方（模式）", "gaze-mode", "front"],
    ["随机看看（模式）", "gaze-mode", "around"],
    ["看鼠标（模式）", "gaze-mode", "follow"],
    ["正前", "gaze-hold", ""], ["左", "gaze-hold", "l"], ["右", "gaze-hold", "r"], ["下", "gaze-hold", "d"],
    ["左上", "gaze-hold", "ul"], ["右上", "gaze-hold", "ur"], ["上", "gaze-hold", "u"],
    ["解除锁定", "gaze-hold", null],
    ["轮流看一遍", "gaze-tour"],
  ]],
  ["待机动作", [
    ["张望", "idle", "look"], ["好奇", "idle", "curious"], ["打哈欠", "idle", "yawn"], ["哼歌", "idle", "happy"],
    ["偷笑", "idle", "giggle"], ["坐下", "idle", "watch"], ["漂浮", "idle", "bob"], ["走路 / 小跑", "wander"],
  ]],
  ["日常活动", [
    ["吃饭", "activity", "eat"], ["打游戏", "activity", "game"], ["看书", "activity", "read"], ["喝奶茶", "activity", "tea"],
    ["听音乐", "activity", "music"], ["玩手机", "activity", "phone"], ["画画", "activity", "draw"],
  ]],
  ["贴边", [
    ["贴左边", "dock", "left"], ["贴右边", "dock", "right"], ["回到地面", "undock"],
    ["挥手", "peek", "wave"], ["偷笑", "peek", "smile"], ["缩回去", "peek", "tuck"], ["伸头", "peek", "lean-out"],
    ["歪头", "peek", "tilt"], ["问号", "peek", "curious"], ["打瞌睡", "peek", "doze"],
  ]],
  ["物理", [["往左上丢", "throw", [-2200, -1800]], ["往右上丢", "throw", [2600, -1200]], ["往上丢", "throw", [0, -3000]], ["原地落下", "throw", [0, 0]]]],
];

const host = document.getElementById("groups")!;
for (const [title, cmds] of GROUPS) {
  const section = document.createElement("section");
  const h = document.createElement("h2");
  h.textContent = title;
  section.append(h);
  for (const [label, cmd, arg] of cmds) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => emitTo("main", "debug-cmd", { cmd, arg }));
    section.append(b);
  }
  host.append(section);
}

const state = document.getElementById("state")!;
listen<Record<string, unknown>>("debug-state", (e) => {
  state.textContent = Object.entries(e.payload)
    .map(([k, v]) => `${k.padEnd(8)} ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
});
listen<string>("debug-result", (e) => {
  state.dataset.result = e.payload;
});
