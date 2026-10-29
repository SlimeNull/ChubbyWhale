// Rule-based understanding of what the user is doing, from app name + window title.
import type { Activity } from "../ipc";
import type { Opinions } from "../skin";
import type { Stance } from "./memory";

export type Kind = "code" | "terminal" | "doc" | "browser" | "video" | "game" | "chat" | "music" | "design" | "mail" | "other";

export type TopicType = "game" | "product" | "shop" | "ai" | "site" | "anime";

export interface Topic {
  id: string;
  label: string;
  type: TopicType;
  match: RegExp;
}

export interface Situation {
  kind: Kind;
  app: string;
  title: string;
  topics: Topic[];
  /** File being edited, if the title shows one. */
  file?: string;
  /** Price found in the title, e.g. "¥12999". */
  price?: string;
}

const APP_KINDS: [Kind, RegExp][] = [
  ["code", /visual studio|vscode|\bcode\b|cursor|windsurf|\bzed\b|sublime|intellij|idea|pycharm|webstorm|goland|rustrover|clion|\brider\b|android studio|xcode|neovim|nvim|\bvim\b|emacs|\bfleet\b|hbuilder|\btrae\b|\bkiro\b/i],
  ["terminal", /terminal|iterm|\bwarp\b|wezterm|alacritty|kitty|ghostty|powershell|cmd\.exe|conhost|\bhyper\b/i],
  ["doc", /word|pages|wps|notion|obsidian|typora|logseq|onenote|evernote|印象笔记|语雀|飞书|lark|feishu|钉钉文档|marktext|scrivener|libreoffice|keynote|powerpoint|excel|numbers|\bcraft\b|\bbear\b/i],
  ["browser", /chrome|safari|\bedge\b|firefox|\barc\b|brave|opera|vivaldi|360|qq浏览器|qqbrowser|sogou|搜狗|夸克|quark|chromium|\bzen\b/i],
  ["video", /bilibili|哔哩哔哩|iina|vlc|potplayer|mpv|爱奇艺|优酷|腾讯视频|quicktime|infuse/i],
  ["game", /minecraft|steam|genshin|原神|yuanshen|starrail|崩坏|league of legends|英雄联盟|wegame|epic games|battle\.net|valorant|terraria|stardew|roblox|zenless|绝区零|鸣潮|wuthering/i],
  ["chat", /wechat|微信|^qq\b|\btim\b|telegram|discord|slack|\bteams\b|钉钉|dingtalk|whatsapp|^line$|kook/i],
  ["music", /music|网易云|cloudmusic|spotify|qq音乐|酷狗|kugou|酷我|apple music/i],
  ["design", /figma|sketch|photoshop|illustrator|blender|krita|procreate|clip studio|aseprite|affinity|after effects|premiere|davinci|剪映|capcut/i],
  ["mail", /mail|outlook|thunderbird|\bspark\b|foxmail|网易邮箱/i],
];

// Titles of web pages that change the kind (a browser showing bilibili is "video").
const TITLE_KINDS: [Kind, RegExp][] = [
  ["video", /bilibili|哔哩哔哩|youtube|优酷|爱奇艺|腾讯视频|抖音|douyin|tiktok|netflix|twitch|斗鱼|虎牙/i],
  ["doc", /google docs|google 文档|腾讯文档|石墨文档|飞书文档|语雀|notion|overleaf|金山文档|confluence/i],
  ["code", /github\.dev|vscode\.dev|codesandbox|stackblitz|replit|colab|jupyter|leetcode|力扣/i],
  ["mail", /gmail|outlook|qq邮箱|163邮箱|网易邮箱/i],
];

export const TOPICS: Topic[] = [
  // Games. Stances come from the skin (opinions.json); the rest are decided when first seen.
  { id: "minecraft", label: "Minecraft", type: "game", match: /minecraft|我的世界|mc百科|mcmod/i },
  { id: "stardew", label: "星露谷物语", type: "game", match: /stardew|星露谷/i },
  { id: "subnautica", label: "深海迷航", type: "game", match: /subnautica|深海迷航/i },
  { id: "animalcrossing", label: "动物森友会", type: "game", match: /animal crossing|动物森友会|动森/i },
  { id: "genshin", label: "原神", type: "game", match: /genshin|原神/i },
  { id: "starrail", label: "崩坏：星穹铁道", type: "game", match: /star ?rail|星穹铁道/i },
  { id: "zzz", label: "绝区零", type: "game", match: /zenless|绝区零/i },
  { id: "wuwa", label: "鸣潮", type: "game", match: /wuthering|鸣潮/i },
  { id: "lol", label: "英雄联盟", type: "game", match: /league of legends|英雄联盟|\blol\b/i },
  { id: "honorofkings", label: "王者荣耀", type: "game", match: /王者荣耀|honor of kings/i },
  { id: "terraria", label: "泰拉瑞亚", type: "game", match: /terraria|泰拉瑞亚/i },
  { id: "eldenring", label: "艾尔登法环", type: "game", match: /elden ring|艾尔登法环|老头环/i },
  { id: "wukong", label: "黑神话：悟空", type: "game", match: /black myth|黑神话|悟空/i },
  { id: "zelda", label: "塞尔达传说", type: "game", match: /zelda|塞尔达/i },
  { id: "pokemon", label: "宝可梦", type: "game", match: /pok[eé]mon|宝可梦|神奇宝贝/i },
  { id: "valorant", label: "无畏契约", type: "game", match: /valorant|无畏契约|瓦罗兰特/i },
  { id: "cs", label: "CS2", type: "game", match: /counter-strike|\bcs2\b|反恐精英/i },
  { id: "roblox", label: "Roblox", type: "game", match: /roblox|罗布乐思/i },
  { id: "steam", label: "Steam", type: "site", match: /\bsteam\b|steampowered/i },

  // Pricey things on shopping pages.
  { id: "macbook", label: "MacBook", type: "product", match: /macbook/i },
  { id: "iphone", label: "iPhone", type: "product", match: /iphone/i },
  { id: "ipad", label: "iPad", type: "product", match: /ipad/i },
  { id: "visionpro", label: "Vision Pro", type: "product", match: /vision pro/i },
  { id: "gpu", label: "显卡", type: "product", match: /rtx ?\d{4}|rx ?\d{4}|显卡|geforce/i },
  { id: "switch", label: "Switch", type: "product", match: /nintendo switch|switch ?2|任天堂/i },
  { id: "ps5", label: "PS5", type: "product", match: /ps5|playstation ?5/i },
  { id: "camera", label: "相机", type: "product", match: /相机|camera|单反|微单|sony a7|佳能|尼康|富士/i },
  { id: "mech-keyboard", label: "机械键盘", type: "product", match: /机械键盘|mechanical keyboard/i },
  { id: "shop", label: "购物", type: "shop", match: /淘宝|taobao|天猫|tmall|京东|\bjd\.com|拼多多|pinduoduo|闲鱼|amazon|亚马逊|ebay|得物|唯品会|当当|小红书商城|apple store|apple \(中国|苹果官网/i },

  // AI assistants (deepseek gets its own lines: ai_deepseek).
  { id: "deepseek", label: "DeepSeek", type: "ai", match: /deepseek|深度求索/i },
  { id: "other-ai", label: "别的 AI", type: "ai", match: /chatgpt|openai|claude|gemini|kimi|豆包|doubao|通义|qwen|文心|copilot|grok|元宝/i },

  // Sites
  { id: "github", label: "GitHub", type: "site", match: /github/i },
  { id: "stackoverflow", label: "Stack Overflow", type: "site", match: /stack ?overflow/i },
  { id: "wiki", label: "维基百科", type: "site", match: /wikipedia|维基百科|百度百科|萌娘百科/i },
  { id: "zhihu", label: "知乎", type: "site", match: /知乎|zhihu/i },
  { id: "social", label: "社交网站", type: "site", match: /微博|weibo|twitter|\bx\.com|reddit|小红书|贴吧|nga|v2ex|豆瓣/i },
  { id: "news", label: "新闻", type: "site", match: /新闻|news|头条|澎湃|财经/i },
  { id: "map", label: "地图", type: "site", match: /地图|google maps|高德|百度地图/i },
  { id: "ocean", label: "海洋", type: "site", match: /鲸|whale|海洋|ocean|海豚|dolphin|深海/i },
  { id: "anime", label: "动画", type: "anime", match: /动画|番剧|anime|新番|bangumi/i },
];

const FILE_RE = /([\w\-.@]+\.(?:ts|tsx|js|jsx|mjs|vue|svelte|rs|py|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|lua|dart|zig|md|json|toml|yaml|yml|html|css|scss|sql|sh))\b/i;
const PRICE_RE = /([¥￥$]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?元)/;

export function classify(a: Activity): Situation {
  const app = a.appName || a.processPath.split(/[\\/]/).pop() || "";
  const title = a.title || "";
  let kind: Kind = APP_KINDS.find(([, re]) => re.test(app))?.[0] ?? "other";
  if (kind === "browser" || kind === "other") {
    kind = TITLE_KINDS.find(([, re]) => re.test(title))?.[0] ?? kind;
  }
  // Editor / terminal / document titles are file and project names, not things she should review.
  const browsing = kind === "browser" || kind === "video" || kind === "game" || kind === "other";
  const haystack = `${title} ${kind === "game" ? app : ""}`;
  const topics = browsing ? TOPICS.filter((t) => t.match.test(haystack)) : [];
  const file = kind === "code" ? title.match(FILE_RE)?.[1] : undefined;
  const price = topics.some((t) => t.type === "product" || t.type === "shop") ? title.match(PRICE_RE)?.[1] : undefined;
  return { kind, app, title, topics, file, price };
}

/**
 * Random-but-persistent stance for topics the skin has no stance on, weighted by
 * the skin's opinions.json (`random[type]`, else `random.default`).
 */
export function pickStance(t: Topic, opinions: Opinions): Stance {
  const weights = Object.entries(opinions.random[t.type] ?? opinions.random.default ?? {}).filter(
    (e): e is [Stance, number] => ["love", "like", "meh", "dislike"].includes(e[0]) && typeof e[1] === "number" && e[1] > 0,
  );
  if (!weights.length) return "like";
  let r = Math.random() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [stance, w] of weights) if ((r -= w) <= 0) return stance;
  return weights[weights.length - 1][0];
}
