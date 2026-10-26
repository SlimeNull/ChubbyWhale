# 项目结构

> 大肥鱼 Chubby Whale 的结构说明：目录职责、运行时架构、前后端接口、数据格式和不可破坏的约定。
> **本文件必须与代码保持同步**，规则见 [AGENTS.md](../AGENTS.md)。

技术栈：Tauri 2（Rust）作为窗口外壳，前端是 Vite + TypeScript + PixiJS 8，不使用前端框架。目标平台为 Windows 和 macOS。

## 目录

```
.
├── AGENTS.md                 agent 工作规则（包括同步本文件的要求）
├── CLAUDE.md                 引入 AGENTS.md，供 Claude Code 读取
├── README.md                 面向用户的说明：功能、安装、隐私、许可
├── LICENSE                   代码许可 GPL-3.0
├── docs/STRUCTURE.md         本文件
├── index.html                宠物窗口页面（入口 src/main.ts）
├── settings.html             设置窗口页面（入口 src/settings/main.ts）
├── bubble.html               对话气泡窗口页面（入口 src/bubble/main.ts）
├── vite.config.ts            多页面构建：index + settings + bubble
├── package.json              pnpm；脚本 dev / build / tauri；devDependency @resvg/resvg-js（渲染托盘图标）
├── .gitattributes            Git LFS 追踪的二进制：*.png *.webp *.ico *.icns *.wav *.mp3 *.ogg *.m4a *.flac
├── .github/workflows/release.yml   推送 v* 标签后构建 macOS（arm64/x64）和 Windows 安装包，生成 Release 草稿（checkout 启用 lfs）
├── .claude/skills/sub2api-imagegen/  生图技能（Images API 脚本），美术流水线用
├── dist/                     vite 构建产物（已在 .gitignore 中）
│
├── src-tauri/                Rust 后端
│   ├── Cargo.toml            依赖：tauri（tray-icon、macos-private-api）、active-win-pos-rs、user-idle、reqwest；macOS 另有 objc2
│   ├── tauri.conf.json       窗口 main：基准尺寸 270×290（刚好包住宠物和头顶特效，按大小设置缩放）；窗口 bubble：240×150 对话气泡。都是透明、无边框、置顶、不进任务栏、不抢焦点；macOSPrivateApi=true
│   ├── capabilities/default.json   main、settings、bubble 窗口的权限：core:default、opener:default
│   ├── icons/                应用图标，由 art/icon-source.png 经 `pnpm tauri icon` 生成
│   │   └── tray/             托盘图标（由 art/tray/build-tray.mjs 生成）：tray-template.png（macOS 单色模板）、tray-color.png（Windows）
│   └── src/
│       ├── main.rs           入口，调用 lib::run
│       ├── lib.rs            Builder：注册命令、托盘（macOS 用模板图标）和右键菜单、设置窗口、macOS Accessory 模式和菜单栏限制解除、气泡窗口设为点击穿透、启动 motion 线程
│       ├── motion.rs         拖拽、抛掷物理、碰撞、平移、点击穿透（独立线程）；气泡窗口跟随；按大小缩放窗口
│       ├── macos.rs          macOS：给窗口类补一个 `constrainFrameRect:toScreen:` 并原样返回，让窗口能移到菜单栏上方
│       ├── activity.rs       前台应用名、窗口标题、键鼠空闲秒数；macOS 屏幕录制权限
│       ├── store.rs          应用数据目录中的 JSON 存储（settings / memory）；dev 专用的 debug_dump
│       └── llm.rs            OpenAI 兼容的 chat/completions 代理（reqwest + rustls）
│
├── src/                      前端
│   ├── main.ts               宠物窗口启动：加载设置和记忆 → 按大小缩放窗口 → 配置音频 → Rig → Fx → Bubble → Pet → Director；监听菜单和设置事件
│   ├── ipc.ts                所有 Rust 命令的类型化封装和事件 payload 类型（新增命令先改这里）
│   ├── debug.ts              仅 DEV：错误写入日志，演示模式（VITE_PET_DEMO=1 / throw / features）
│   ├── styles.css            宠物窗口样式（透明背景）
│   ├── vite-env.d.ts
│   ├── audio/                声音：全部用 WebAudio 实时合成，没有音频文件
│   │   ├── engine.ts         AudioContext、音效总线（带混响发送 sfxReverb）和声音总线、硬拐点限幅器、噪声缓冲；可接入 OfflineAudioContext 做离线渲染
│   │   ├── sfx.ts            萌系音效（五声音阶铃音、八音盒、滑哨、小鸡啾啾、少量混响）：pop、pickup、whoosh、boing、thud、softland、dizzy、puff、sparkle、step（脚步）
│   │   └── voice.ts          「角色声音」（16 种 VoiceKind）：优先播放 public/voice/ 中的录音片段；某种情绪没有片段时，退回共振峰合成的无词音节
│   ├── pet/                  「身体」：渲染和行为
│   │   ├── rig.ts            MeshPlane 网格变形渲染：呼吸、倾斜、挤压拉伸、跳跃、悬挂摆动（looseness）、飞行旋转或翻滚（spin）、逐帧循环（playCycle：走路和跑步，带步伐起伏和左右摇摆）；PoseName 定义；脚的位置随窗口尺寸变化
│   │   ├── pet.ts            行为状态机：待机动作、眨眼、口型、指针（戳 / 拖 / 丢）、反应变体（REACTIONS）、音效和声音触发、睡眠、点击区域同步
│   │   ├── fx.ts             Pixi 文字特效：Zzz、♪、✦、💧、?、!、♥、💢、「咚!」、晕眩星星
│   │   └── bubble.ts         对话气泡控制：计时、逐字推进（发 `bubble-text` 给气泡窗口），用 talking 标志驱动口型；用 `set_bubble` 上报头的位置
│   ├── brain/                「大脑」：决定说什么、什么时候说
│   │   ├── director.ts       每 2 秒轮询 activity：睡眠和唤醒、按停留时长和冷却决定评论什么、问候、闲聊
│   │   ├── topics.ts         按应用名和标题分类（Kind），识别话题（Topic：游戏 / 商品 / 网站 / AI），提取文件名和价格
│   │   ├── lines.ts          离线台词库（LINES）和 Voice（避免重复、模板填充）
│   │   ├── memory.ts         长期记忆：说过的话、态度（opinions）、自我设定（facts）、统计
│   │   ├── llm.ts            可选 LLM：人设和规则提示词、JSON 输出校验、态度一致性约束
│   │   └── settings.ts       Settings 类型、默认值、读写（兼容旧的数字 size）、大小对应的缩放 SIZE_SCALE、话痨程度对应的发言间隔
│   ├── bubble/               对话气泡窗口：main.ts（按 `bubble-place` 给出的方位和尾巴位置排版）、bubble.css
│   └── settings/             设置窗口
│       ├── main.ts           表单读写（大小、声音、陪伴、AI）、音效和声音试听、权限按钮、LLM 测试、记忆列表、清空记忆
│       └── settings.css
│
├── public/sprites/           运行时立绘（构建产物，由 art/build_sprites.py 生成，不要手改）
│   ├── manifest.json         { poses: {name: {w,h,ax}}, variants: {...} }，ax 是头部中心的横向比例
│   ├── <pose>.webp           28 个姿势：13 个基础姿势、10 个反应变体（giggle、pout、proud、dragged_*、fly_*、hurt_*）、5 帧移动循环（walk_a / walk_pass / walk_b、run_a / run_b，面朝左）
│   └── idle_blink.webp / idle_talk.webp   idle 的眨眼和说话差分
│
├── public/voice/             （可选）角色声音片段 <emotion>-<n>.mp3 和 manifest.json，由 art/voice/build_voice.py 生成；不存在时使用合成声音
│
└── art/                      美术源文件和流水线（许可 CC BY-NC-SA 4.0，见 art/LICENSE.md）
    ├── build_sprites.py      raw → public/sprites：alpha 清理、裁切、缩放（SCALE 和逐姿势 scale）、差分合成、算 ax、输出 webp
    ├── requirements.txt      Pillow、requests
    ├── prompts/              每个姿势和差分的生图提示词（00_master、各姿势、blink、talk）
    ├── raw/                  生图原图和 .png.json 生成报告；_v1_hoodie/ 是被否决的初版，已在 .gitignore 中
    ├── ref/                  master.png（清理后的母版）、mask_eyes/mask_mouth（差分蒙版）、walk_a/run_a 与 mask_*_legs（生成走跑中间帧用）、upstream/（社区设定图）
    ├── tray/                 whale.svg（线稿鲸鱼，托盘图标源）、build-tray.mjs（`node art/tray/build-tray.mjs` 生成托盘 PNG）
    ├── voice/                角色声音：raw/（原始录音 <emotion>-<n>.wav 等）、build_voice.py（裁剪静音、响度标准化、淡入淡出、可选保留共振峰的升调、编码 mp3）、generate.py（用 OpenAI 兼容的 TTS 接口生成语气音）
    └── icon-source.png       应用图标源图（母版头部裁切）
```

## 运行时架构

### 进程和线程

| 位置 | 职责 |
|---|---|
| Rust 主线程（tao 事件循环） | 窗口、托盘、菜单；**同步**（非 async）命令也在这里执行 |
| `motion` 线程（motion.rs） | 空闲时每 33ms 一次，忙碌时每 8ms 一次：读光标和窗口位置 → 推进阶段 → 移动窗口 → 发 `pet-motion` / `pet-cursor` 事件 → 切换点击穿透 → 让气泡窗口跟随 |
| tokio 运行时 | async 命令：motion 相关命令、`llm_chat` |
| 宠物窗口 webview | Pixi 渲染、Pet 状态机、Director、音频 |
| 设置窗口 webview | 按需创建（label 为 `settings`） |
| 气泡窗口 webview | label 为 `bubble`，始终存在，始终点击穿透；没有台词时内容为空 |

### motion 阶段

`Idle → Pressed →（移动超过 4 逻辑像素）→ Dragging →（松手）→ Flying 或 Idle（若在屏外则先 Gliding 回屏内）`

- `Flying`：重力 2600 px/s²。撞左、右、上边缘时反弹（系数 0.55）；落地时反弹（0.32）后受摩擦减速。停稳或飞满 8 秒后发出 `landed` 事件，`impact` 取整个飞行过程中的最大撞击速度。工作区（屏幕可用区域）在起飞时查询一次，存入阶段数据。
- 松手时速度大于 700 逻辑 px/s 算作「丢出去」，否则原地放下。速度上限 6000。
- `Gliding`：用于走路 / 跑步（`linear`，匀速）和放下后回到屏内（smoothstep）。`glide_by` 按速度计算时长，时长基于被屏幕边缘截断后的实际距离，所以步频和移动速度始终一致。
- 点击穿透：只有当光标位于前端上报的 hit rects（身体框）内，或处于按下 / 拖拽状态时，宠物窗口才接收鼠标。
- **对话气泡窗口**：宠物窗口只包住她自己（加上头顶约 40px 的特效空间），台词显示在独立的 `bubble` 窗口里。前端用 `set_bubble([头 x, 头顶 y, 头半宽])` 上报位置（隐藏时传 null）；motion 线程每个 tick 把气泡窗口放到头顶上方，头顶上方放不下（靠近菜单栏或屏幕顶部）时放到头的右侧，右侧放不下则放左侧，然后发出 `bubble-place {side, tail}`。工作区每 500ms 刷新一次；气泡窗口的状态只归 motion 线程所有，不放进共享 State。
- **macOS 菜单栏**：AppKit 默认不允许窗口越过菜单栏，`macos.rs` 解除了这个限制，所以宠物窗口的透明头顶空间可以伸到菜单栏后面，她的身体能碰到屏幕可用区域的顶边。抛掷时的天花板仍然是工作区顶边（菜单栏下沿）。

### 前端行为

- `Pet.mode`：`idle | action | drag | fly | sleep`。`act(pose, ms)` 使用递增的 token 实现可取消的定时姿势。
- 待机动作每 8～18 秒按权重抽一个：look、curious、yawn（深夜权重更高）、happy 哼歌（hum 声音）、giggle 偷笑、wander 移动、watch 坐下、bob 漂浮。
- **wander 移动**：70% 走路（walk_a → walk_pass → walk_b → walk_pass，4fps，每秒 2 步），30% 小跑（run_a ↔ run_b，4fps，每秒 4 步）。移动速度 = 步幅 × 步频 × 大小系数，步幅取立绘中两脚间距（中号时走路 72px、跑步 100px，即 `WALK_STRIDE` / `RUN_STRIDE`），这样着地的脚相对地面不动，不会滑步。改了移动立绘就要重新测量步幅。`playCycle` 的 `phase` 让身体在脚着地时（走路帧 A、B 的中间）最低，在收腿帧时最高；`onStep` 在每次着地时触发脚步声。移动图朝左，向右走时水平翻转。被屏幕边缘挡住时改为朝那个方向张望。被拎起、睡觉或其他动作打断时，`stopWalking()` 会停掉帧循环（脚步声也随之停止）。
- 眨眼和说话只在 idle 姿势上生效，通过切换差分贴图实现。
- **反应变体**（`pet.ts` 的 `REACTIONS`）：每种情况有多个反应，每个反应包含姿势、音效 / 声音、台词（带概率）、特效、跳跃或挤压，以及悬挂松紧或翻滚。挑选时不会和上一次相同，并跳过没有贴图的姿势。
  - `poke`：shy / giggle / shocked / happy / curious；4 秒内戳 4 次以上触发 `pokeSpam`：pout / shocked
  - `drag`：dragged（慌张）/ dragged_happy（荡秋千，松）/ dragged_grumpy（不服，紧）/ dragged_limp（瘫软，很松）
  - `fly`：fly / fly_happy / fly_ball（翻滚）
  - `hurt`（`impact > 1100`）：hurt（加晕眩星星）/ hurt_cry / hurt_dizzy；`land`（`impact > 500`）：proud / happy / cheer；更轻的落地只播放挤压动画和轻落地音效
- **声音**：撞墙播放 boing（按 impact 调整强度，间隔至少 90ms）；拖起播放 pickup，丢出播放 whoosh，落地播放 thud / softland，戳播放 pop，放下播放 puff，走路播放 step。`say()` 按 emotion 播放对应的声音（`EMOTION_VOICE`），同一时间只播一段。AudioContext 在第一次 pointerdown 时解锁。
- **大小**：`small / medium / large` 对应缩放 0.75 / 1 / 1.3。`set_pet_scale` 缩放窗口，保持脚底中点不动；窗口 resize 后前端重新上报身体框。
- Director：用户空闲超过 300 秒后入睡，有输入后醒来；网页停留超过 25 秒后对识别到的话题发表评论（同一话题冷却 40 分钟）；各类活动的停留阈值和冷却见 `KIND_RULES`；全局发言间隔见 `REMARK_GAP`（quiet 600s / normal 200s / chatty 75s）。
- 话题匹配只在 browser / video / game / other 类活动下进行。代码、终端、文档窗口的标题是文件名和项目名，不参与匹配。

### 人设一致性

- `memory.decide(topic)`：话题第一次出现时确定态度（有预设就用预设，否则 `pickStance` 随机），之后永久固定。
- LLM 回复带有 topic 和 stance 时，用 `memory.adopt` 校验；和已有态度冲突就丢弃这条回复，改用离线台词。
- `Voice.line` 避免最近 40 句内出现过的原话；LLM 回复和最近 80 句重复时丢弃。

## 接口

### Rust 命令（全部在 src/ipc.ts 中封装）

| 命令 | 文件 | 说明 |
|---|---|---|
| `activity` | activity.rs | `{appName,title,processPath,isSelf,idleSecs}` |
| `title_permission` / `request_title_permission` | activity.rs | macOS 屏幕录制权限；其他平台返回 true |
| `drag_begin` / `drag_end` | motion.rs | async。`drag_end` 返回 `click / drop / throw / none` |
| `set_body` / `set_hit_rects` | motion.rs | async。窗口内逻辑像素 `[l,t,r,b]` |
| `set_bubble` | motion.rs | async。`[头 x, 头顶 y, 头半宽]`（窗口内逻辑像素）或 null |
| `fall` | motion.rs | async |
| `glide_by` | motion.rs | async。`(dx, speed px/s, linear)`，返回被屏幕边缘截断后的实际 dx |
| `set_pet_scale` | motion.rs | async。窗口缩放到基准尺寸 × factor，保持脚底中点不动 |
| `debug_throw` | motion.rs | 仅 DEV 生效：以给定速度抛出 |
| `debug_probe_top` / `debug_windows` | motion.rs | 仅 DEV 生效：检查窗口能否越过菜单栏；移动宠物窗口并返回宠物窗口、气泡窗口和工作区的坐标 |
| `store_load` / `store_save` | store.rs | 名称白名单：`settings`、`memory` |
| `data_dir` | store.rs | 应用数据目录 |
| `debug_dump` | store.rs | 仅 DEV 生效：`data:<mime>;base64,` 数据按二进制写入（PNG、WAV），其他内容追加到日志；文件名只允许字母、数字和 `-_.` |
| `llm_chat` | llm.rs | async。`{baseUrl,apiKey,model,messages,jsonMode,temperature}` |
| `show_menu` / `open_settings_window` | lib.rs | 右键菜单和设置窗口 |

### 事件

| 事件 | 方向 | payload |
|---|---|---|
| `pet-motion` | Rust → main | `{kind: drag-start/dragging/flying/bump/landed/glide-end, vx, vy, impact, side}`，单位为逻辑 px/s |
| `pet-cursor` | Rust → main | `[x, y]`，光标相对窗口的逻辑坐标，约 10Hz |
| `pet-menu` | Rust → main | `"talk"` |
| `settings-changed` | settings → 全局 | 无 |
| `memory-cleared` | settings → 全局 | 无（由宠物窗口执行清空，避免两个窗口同时写文件） |
| `bubble-text` | main → bubble | `{text, show}`：当前已经显示出来的文字 |
| `bubble-place` | Rust → bubble | `{side: above/right/left, tail}`：气泡在头的哪一侧，以及尾巴在气泡窗口里的位置（逻辑像素） |

## 数据

应用数据目录：macOS 为 `~/Library/Application Support/org.chubbywhale.pet/`，Windows 为 `%APPDATA%\org.chubbywhale.pet\`。

- `settings.json`：见 `Settings`（size: small/medium/large、activityAware、commentOnPages、chattiness、sound{volume,effects,voice}、llm{enabled,baseUrl,model,apiKey,shareTitles}）。API Key 明文保存。旧版本中数字形式的 size 会自动迁移。
- `memory.json`：`MemoryData v1`，包括 firstMet、opinions{id→{label,stance,firstSaid,since,mentions}}、facts（最多 80 条）、said（最多 400 条）、stats{pokes,throws,drags}。只由宠物窗口写入，写入有 400ms 防抖，先写临时文件再 rename 替换。
- `debug/`：仅开发版生成，包括 `log.txt`、`snap-*.png`、`audio-*.wav`。

## 美术流水线

1. 生图：使用 `.claude/skills/sub2api-imagegen` 技能。母版以 `ref/upstream` 中的设定图为参考生成；各姿势用 `edit` 接口，以 `ref/master.png` 和设定图为参考；眨眼和说话差分用 `ref/mask_*.png` 做局部编辑。
2. 网关返回的尺寸不一定等于请求的尺寸（例如 1216×1294），`build_sprites.py` 不依赖固定尺寸。差分图尺寸不一致时会按左上角对齐补齐画布。
3. 运行 `python art/build_sprites.py` 生成 `public/sprites/`。姿势的头部大小不一致时，调整 `POSES[name]["scale"]`（坐姿约 0.8）。
4. 新增姿势：添加提示词 → 生成 `raw/<name>.png` → 在 `POSES` 中登记 → 加入 `rig.ts` 的 `PoseName` → 按需加入 `pet.ts` 的 `EMOTION_POSE`、`REACTIONS` 或待机动作。
5. 托盘图标：修改 `art/tray/whale.svg` 后运行 `node art/tray/build-tray.mjs`。macOS 用的是模板图（纯黑加透明，由系统着色）。
6. 移动循环帧：先生成关键帧（walk_a、run_a），再用 `ref/mask_*_legs.png`（只开放裙摆下半部分和腿）做局部编辑，生成其余帧。这样头和上身完全一致，切帧不会闪；同一组循环帧要用相同的 scale。
7. 角色声音：把录音放到 `art/voice/raw/<emotion>-<n>.wav`，运行 `python art/voice/build_voice.py [--pitch 1.1]`（需要带 rubberband 的 ffmpeg）。也可以用 `art/voice/generate.py` 调用 TTS 生成（需要能提供音频模型的 OpenAI 兼容接口，设置 VOICE_API_BASE_URL / VOICE_API_KEY；Codex 网关不支持）。用了 AI 语音时，要在 README 中向用户说明。

## 不可破坏的约定

1. **motion.rs 的锁规则**：持有 `State` 锁时绝不能调用任何窗口 API（cursor_position、outer_position、monitor、set_position、emit、set_ignore_cursor_events……）。窗口 API 要和主线程往返，主线程可能正在等这把锁，同时持有就会死锁。这个问题实际发生过：丢出去时整个程序卡死。正确做法是快照 → 解锁做窗口操作 → 回写时检查 `epoch`。
2. 访问 motion 状态的命令必须是 `async`，不能在主线程执行。
3. 前端在 `pointerup` 里要先 `await` `dragBegin` 的 Promise，再调用 `dragEnd`。命令是异步的，乱序会导致宠物粘在鼠标上。
4. 所有姿势必须以同一显示比例渲染（`Rig.scale = height / idle.h`），头部大小靠 `build_sprites.py` 的逐姿势 scale 统一。
5. `public/sprites/` 和 `src-tauri/icons/tray/` 是构建产物，修改美术要改 `art/` 下的源文件，再重新构建。
6. 音频只在 `engine.get()` 返回的上下文里创建节点，所有输出接到 `engine.sfxBus` / `engine.voiceBus`，不要直接接 `destination`（音量设置和限幅器会失效）。
7. 宠物窗口只放宠物本身。气泡、提示之类的 UI 放在独立窗口里，不要再给宠物窗口加大块透明区域，否则她又会到不了屏幕边缘。

## 开发和调试

- 克隆后需要 `git lfs install && git lfs pull`，否则图片、图标、音频都只是指针文件（托盘图标会被 `include_bytes!` 编进程序，指针会导致运行时出错）。新增二进制格式时要加到 `.gitattributes`。
- `pnpm tauri dev`：开发运行。`pnpm build`：tsc 检查加 vite 构建。在 `src-tauri/` 下运行 `cargo clippy`。
- `VITE_PET_DEMO=1 pnpm tauri dev`：依次播放全部姿势，把截图存到 `debug/snap-*.png`。
- `VITE_PET_DEMO=throw pnpm tauri dev`：抛掷压力测试，结果写入 `debug/log.txt`（6 次 throw 的落地时间，以及后端往返耗时的最大值）。
- `VITE_PET_DEMO=bubble`：在屏幕底部和菜单栏附近各说一句长台词，记录气泡的方位和坐标。`VITE_PET_DEMO=probe`：检查窗口能否越过菜单栏。
- `VITE_PET_DEMO=features pnpm tauri dev`：依次切换三种大小并记录窗口尺寸；把所有音效和声音离线渲染成 `debug/audio-*.wav`；给 10 个反应变体姿势截图。音频可以用 numpy 统计峰值、RMS、有效时长，或画频谱图检查（agent 听不到声音，只能这样客观检查，最终听感要请用户确认）。
- 显示器休眠或窗口不可见时，webview 会暂停 requestAnimationFrame，演示模式会手动驱动 ticker。
- agent 跑测试时，用户可能正开着自己的 `pnpm tauri dev`（占用 1420 端口）。测试实例要换端口：`pnpm tauri dev --config '{"build":{"devUrl":"http://localhost:1430","beforeDevCommand":"pnpm dev --port 1430 --strictPort"}}'`。结束时只杀自己启动的进程树，不要 `pkill -f "tauri dev"`，也不要按 chubby-whale 进程名去 kill。
- 程序卡死时：用 `sample <pid> 2` 查看各线程调用栈。
- 用 node 26 可以直接运行 `src/brain/topics.ts` 来检查分类规则（它只有 type import）。
