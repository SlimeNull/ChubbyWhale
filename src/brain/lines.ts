// Offline line bank. Every line can use {placeholders} filled from `vars`.
import type { Emotion } from "../pet/pet";
import type { Memory, Stance } from "./memory";

type Bank = Record<string, [Emotion, string[]]>;

export const LINES: Bank = {
  // Body reactions
  poke: ["shy", ["呀！别戳啦~", "干、干嘛呀……", "嘿嘿，好痒~", "戳一下要给一块磷虾饼干哦！", "唔？叫我吗？", "再戳……再戳我就脸红了！"]],
  pokeSpam: ["shocked", ["再戳我真的要生气了！", "呜——不许连续戳！", "我的脸要被戳扁啦！"]],
  pokeAwake: ["shocked", ["呜哇！我、我没睡着！", "唔……是谁在戳我……", "我只是闭目养神而已！"]],
  dragStart: ["shocked", ["哇啊！放我下来！", "要、要带我去哪里呀？", "飞起来了~", "轻点轻点！"]],
  throw: ["shocked", ["呜哇啊啊啊——！", "不要扔我呀——！", "飞——走——啦——"]],
  throwAgain: ["shocked", ["又扔我！这已经是第 {n} 次了！", "第 {n} 次了！你是不是很喜欢扔鱼？"]],
  hurt: ["hurt", ["哎哟，好痛……", "呜……屁股要摔成两半了……", "头上起包了啦……", "你、你欺负鱼！", "痛痛痛……要呼呼才能好……"]],
  hurtAfter: ["shy", ["下次轻点嘛……", "哼，原谅你了。", "……我没哭，是海水。"]],
  softLanding: ["happy", ["稳稳落地！", "嘿咻，满分落地！", "我果然是一条灵活的胖鱼！"]],
  drop: ["neutral", ["呼~", "这里视野不错~", "就放这儿吧~"]],
  // Reaction variants (see REACTIONS in pet/pet.ts)
  pokeGiggle: ["shy", ["嘿嘿嘿，好痒~", "噗——不要挠我啦！", "咯咯咯……停、停下来~"]],
  pokeSurprised: ["shocked", ["呀！吓我一跳！", "诶？！刚才是什么？", "哇！突然袭击！"]],
  pokeHappy: ["happy", ["嗯？找我玩吗！", "嘿！我在这儿~", "要和我玩吗？好呀好呀！"]],
  pokeCurious: ["curious", ["唔？有什么事吗？", "嗯？怎么啦？", "是要我帮忙吗？"]],
  dragHappy: ["happy", ["哇~ 荡秋千！", "再高一点再高一点！", "嘿嘿，被拎着也挺好玩的~"]],
  dragGrumpy: ["shy", ["……哼，放我下来。", "我又不是猫！", "你、你要拎到什么时候嘛！"]],
  dragLimp: ["neutral", ["……", "我已经放弃抵抗了……", "随便你吧……"]],
  flyHappy: ["happy", ["我会飞啦——！", "呀呼——！", "超人鱼出发！"]],
  flyBall: ["shocked", ["呜呜呜要转晕了——", "团起来就不怕了！……才怪！"]],
  hurtCry: ["hurt", ["哇——好痛好痛！", "呜哇——你欺负我！", "痛死了……要抱抱……"]],
  hurtDizzy: ["hurt", ["天、天在转……", "星星……好多星星……", "我是谁……我在哪……"]],
  landProud: ["happy", ["满分落地！", "看到没有，完美着陆！", "嘿嘿，我果然是天才~"]],
  // Everyday activities (see ACTIVITIES in pet/activities.ts)
  actEat: ["happy", ["开饭啦~ 今天吃小鱼饭！", "嗯~ 好好吃！", "吃饱了才有力气陪你~"]],
  actGame: ["cheer", ["这关我一定能过！", "看我的超级连招！", "嘿嘿，又赢啦~"]],
  actRead: ["neutral", ["这本书好有意思~", "嘘——我在看书哦"]],
  actTea: ["happy", ["珍珠奶茶最棒了~", "吸溜——好甜！"]],
  actMusic: ["happy", ["♪ 这首歌好好听~", "啦啦啦~"]],
  actPhone: ["curious", ["在刷什么呢……啊，是鲸鱼视频！", "嘿嘿，看到一个好好笑的东西"]],
  actDraw: ["happy", ["我在画一条小鲸鱼~", "画好了给你看！"]],
  // Hiding at a screen side
  peekIn: ["shy", ["躲起来啦~", "嘿嘿，你找不到我~", "我在这里偷偷看着你哦"]],
  pokePeek: ["shy", ["被发现了！", "嘿嘿，躲猫猫~", "嘘——我在偷看呢"]],
  wake: ["shocked", ["唔……我没睡着！", "啊！欢迎回来~ 我一直在等你哦", "嗯……你回来啦？"]],
  yawn: ["sleepy", ["哈啊~ 好困……", "呼啊……想睡觉了……"]],

  // Greetings
  morning: ["happy", ["早上好呀！今天也要元气满满~", "早安~ 吃早饭了吗？"]],
  noon: ["happy", ["中午好~ 记得吃午饭哦！", "午饭吃什么呢……我想吃磷虾！"]],
  afternoon: ["happy", ["下午好~ 要不要来杯奶茶？", "下午也要加油哦~"]],
  evening: ["happy", ["晚上好~ 今天辛苦啦！", "晚上好！今天过得怎么样？"]],
  lateNight: ["sleepy", ["已经很晚了哦……早点睡吧", "熬夜会变成熊猫的……", "我、我陪你，但你也要早点休息呀"]],

  // Activity
  code: ["watch", ["好认真呀~", "在写什么呢？", "加油~ 一定能跑通的！", "有 bug 的话叫我，我帮你盯着~", "敲键盘的声音好好听~"]],
  codeFile: ["curious", ["在写 {file} 吗？看起来好厉害~", "{file}……我看不懂，但是你好帅！", "{file} 写完了吗？加油~"]],
  codeLong: ["cheer", ["已经写了 {mins} 分钟了，喝口水休息一下吧~", "写了好久了，要不要站起来伸个懒腰？"]],
  terminal: ["curious", ["命令行！看起来好像黑客~", "在敲什么魔法咒语呢？", "rm -rf 的时候要小心哦……"]],
  doc: ["watch", ["在写文档呀，好认真~", "写得好棒，我都看不懂~", "写累了就看看我嘛~", "加油，马上就写完啦！"]],
  design: ["curious", ["在画画吗？好漂亮！", "能不能也把我画进去~"]],
  video: ["happy", ["在看什么视频呀？我也要看！", "嘿嘿，摸鱼时间~", "这个视频好看吗？"]],
  chat: ["curious", ["在和谁聊天呀？", "聊得好开心的样子~", "要帮我也打个招呼吗？"]],
  music: ["happy", ["♪~ 这首歌好听吗？", "跟着音乐摇摆~"]],
  mail: ["watch", ["在回邮件呀，辛苦啦~", "邮件好多……要加油哦"]],
  game: ["happy", ["在玩游戏！带我一个嘛~", "加油！赢了要告诉我哦！"]],
  browse: ["curious", ["在网上冲浪呀~", "在看什么好玩的？"]],

  // Topics on web pages, by stance
  topic_love: ["happy", ["这游戏我也超喜欢玩~", "是{label}！我最喜欢{label}了！", "{label}！带我一起玩嘛~"]],
  topic_like: ["happy", ["{label}诶，我也玩过，挺好玩的~", "在看{label}呀？我也挺喜欢的~"]],
  topic_meh: ["curious", ["{label}……我玩得不多，好玩吗？", "{label}呀，你喜欢这个吗？"]],
  topic_dislike: ["shy", ["{label}啊……我玩不太来，太难啦", "又是{label}……我还是更喜欢看你玩"]],
  topic_love_again: ["happy", ["又是{label}！我说过我最喜欢这个了吧~", "{label}{label}！今天也要玩吗？"]],
  topic_like_again: ["happy", ["又在看{label}呀~ 我也还是挺喜欢的", "{label}今天有什么新东西吗？"]],
  topic_meh_again: ["curious", ["你真的很喜欢{label}呢……", "{label}……我还是没太玩明白"]],
  topic_dislike_again: ["shy", ["又是{label}……我还是玩不来啦", "{label}就交给你了，我在旁边加油！"]],

  product: ["shocked", ["呜哇！{label}好贵！", "{label}……要攒好久的磷虾钱吧", "要买{label}吗？买了借我玩玩~"]],
  productPrice: ["shocked", ["呜哇！{label}要 {price}！好贵！", "{price}……够我吃一辈子磷虾了！"]],
  shop: ["curious", ["在逛街吗~ 有什么好东西？", "购物车又满了吗？", "买买买！……钱包还好吗？"]],

  ai_deepseek: ["happy", ["诶，这不是我老家嘛~", "DeepSeek！是自家人！", "在和我的本体聊天吗？"]],
  ai_other: ["shy", ["你在和别的 AI 聊天吗……哼", "我也可以陪你聊天的呀……", "它有我可爱吗？"]],

  site_github: ["cheer", ["GitHub！给我点个 star 嘛~", "在看代码呀，好厉害~"]],
  site_stackoverflow: ["cheer", ["遇到 bug 了吗？一定能解决的！", "答案就在下一个回答里！"]],
  site_wiki: ["curious", ["在学习新知识吗？", "这个我也想知道！"]],
  site_zhihu: ["curious", ["谢邀，人在桌面，刚游过来~", "知乎上又有什么新问题吗？"]],
  site_social: ["happy", ["在冲浪呀~ 有什么好玩的？", "看到好笑的记得分享给我！"]],
  site_news: ["curious", ["今天有什么新闻吗？"]],
  site_map: ["curious", ["要去哪里玩呀？带上我！"]],
  site_steam: ["happy", ["Steam！又要买游戏了吗？", "愿望单又变长了吧~"]],
  site_ocean: ["happy", ["是大海！我的老家~", "鲸鱼！是我的亲戚吗？"]],
  anime_anime: ["happy", ["在看番吗？我也要看！", "这部番好看吗？"]],

  // Idle chatter
  chatter: ["neutral", [
    "今天也要元气满满~",
    "我才不胖！这叫圆润！",
    "好想吃磷虾小饼干……",
    "你知道吗，抹香鲸睡觉的时候是竖着的哦",
    "要不要休息一下眼睛？",
    "我会一直在这里陪着你的~",
    "大肥鱼……这个名字到底是谁起的嘛！",
  ]],
  missYou: ["shy", ["你好久没理我了……", "在忙吗？我安静地陪着你~"]],
};

function fill(s: string, vars: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export class Voice {
  constructor(private memory: Memory) {}

  has(kind: string) {
    return kind in LINES;
  }

  /** Pick a line of `kind`, avoiding ones said recently. */
  line(kind: string, vars: Record<string, string | number> = {}): { text: string; emotion: Emotion } {
    const [emotion, pool] = LINES[kind] ?? LINES.chatter;
    const options = pool.map((s) => fill(s, vars));
    const fresh = options.filter((s) => !this.memory.saidRecently(s));
    const list = fresh.length ? fresh : options;
    return { text: list[Math.floor(Math.random() * list.length)], emotion };
  }

  topicLine(stance: Stance, again: boolean, vars: Record<string, string>) {
    return this.line(`topic_${stance}${again ? "_again" : ""}`, vars);
  }
}
