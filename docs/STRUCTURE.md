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
├── vite.config.ts            多页面构建：index + settings
├── package.json              pnpm；脚本 dev / build / tauri
├── .github/workflows/release.yml   推送 v* 标签后构建 macOS（arm64/x64）和 Windows 安装包，生成 Release 草稿
├── .claude/skills/sub2api-imagegen/  生图技能（Images API 脚本），美术流水线用
├── dist/                     vite 构建产物（已在 .gitignore 中）
│
├── src-tauri/                Rust 后端
│   ├── Cargo.toml            依赖：tauri（tray-icon、macos-private-api）、active-win-pos-rs、user-idle、reqwest
│   ├── tauri.conf.json       窗口 main：300×420、透明、无边框、置顶、不进任务栏、不抢焦点；macOSPrivateApi=true
│   ├── capabilities/default.json   main 和 settings 窗口的权限：core:default、opener:default
│   ├── icons/                由 art/icon-source.png 经 `pnpm tauri icon` 生成
│   └── src/
│       ├── main.rs           入口，调用 lib::run
│       ├── lib.rs            Builder：注册命令、托盘和右键菜单、设置窗口、macOS Accessory 模式、启动 motion 线程
│       ├── motion.rs         拖拽、抛掷物理、碰撞、平移、点击穿透（独立线程）
│       ├── activity.rs       前台应用名、窗口标题、键鼠空闲秒数；macOS 屏幕录制权限
│       ├── store.rs          应用数据目录中的 JSON 存储（settings / memory）；dev 专用的 debug_dump
│       └── llm.rs            OpenAI 兼容的 chat/completions 代理（reqwest + rustls）
│
├── src/                      前端
│   ├── main.ts               宠物窗口启动：加载设置和记忆 → Rig → Fx → Bubble → Pet → Director；监听菜单和设置事件
│   ├── ipc.ts                所有 Rust 命令的类型化封装和事件 payload 类型（新增命令先改这里）
│   ├── debug.ts              仅 DEV：错误写入日志，演示模式（VITE_PET_DEMO=1 / throw）
│   ├── styles.css            宠物窗口样式（透明背景、对话气泡）
│   ├── vite-env.d.ts
│   ├── pet/                  「身体」：渲染和行为
│   │   ├── rig.ts            MeshPlane 网格变形渲染：呼吸、倾斜、挤压拉伸、跳跃、悬挂摆动、飞行旋转；PoseName 定义
│   │   ├── pet.ts            行为状态机：待机动作、眨眼、口型、指针（戳 / 拖 / 丢）、motion 事件反应、睡眠、点击区域同步
│   │   ├── fx.ts             Pixi 文字特效：Zzz、♪、✦、💧、?、!、♥、💢、「咚!」、晕眩星星
│   │   └── bubble.ts         DOM 对话气泡：逐字显示，talking 标志驱动口型
│   ├── brain/                「大脑」：决定说什么、什么时候说
│   │   ├── director.ts       每 2 秒轮询 activity：睡眠和唤醒、按停留时长和冷却决定评论什么、问候、闲聊
│   │   ├── topics.ts         按应用名和标题分类（Kind），识别话题（Topic：游戏 / 商品 / 网站 / AI），提取文件名和价格
│   │   ├── lines.ts          离线台词库（LINES）和 Voice（避免重复、模板填充）
│   │   ├── memory.ts         长期记忆：说过的话、态度（opinions）、自我设定（facts）、统计
│   │   ├── llm.ts            可选 LLM：人设和规则提示词、JSON 输出校验、态度一致性约束
│   │   └── settings.ts       Settings 类型、默认值、读写、话痨程度对应的发言间隔
│   └── settings/             设置窗口
│       ├── main.ts           表单读写、权限按钮、LLM 测试、记忆列表、清空记忆
│       └── settings.css
│
├── public/sprites/           运行时立绘（构建产物，由 art/build_sprites.py 生成，不要手改）
│   ├── manifest.json         { poses: {name: {w,h,ax}}, variants: {...} }，ax 是头部中心的横向比例
│   ├── <pose>.webp           13 个姿势
│   └── idle_blink.webp / idle_talk.webp   idle 的眨眼和说话差分
│
└── art/                      美术源文件和流水线（许可 CC BY-NC-SA 4.0，见 art/LICENSE.md）
    ├── build_sprites.py      raw → public/sprites：alpha 清理、裁切、缩放（SCALE 和逐姿势 scale）、差分合成、算 ax、输出 webp
    ├── requirements.txt      Pillow
    ├── prompts/              每个姿势和差分的生图提示词（00_master、各姿势、blink、talk）
    ├── raw/                  生图原图和 .png.json 生成报告；_v1_hoodie/ 是被否决的初版，已在 .gitignore 中
    ├── ref/                  master.png（清理后的母版）、mask_eyes/mask_mouth（差分蒙版）、upstream/（社区设定图）
    └── icon-source.png       应用图标源图（母版头部裁切）
```

## 运行时架构

### 进程和线程

| 位置 | 职责 |
|---|---|
| Rust 主线程（tao 事件循环） | 窗口、托盘、菜单；**同步**（非 async）命令也在这里执行 |
| `motion` 线程（motion.rs） | 空闲时每 33ms 一次，忙碌时每 8ms 一次：读光标和窗口位置 → 推进阶段 → 移动窗口 → 发 `pet-motion` / `pet-cursor` 事件 → 切换点击穿透 |
| tokio 运行时 | async 命令：motion 相关命令、`llm_chat` |
| 宠物窗口 webview | Pixi 渲染、Pet 状态机、Director |
| 设置窗口 webview | 按需创建（label 为 `settings`） |

### motion 阶段

`Idle → Pressed →（移动超过 4 逻辑像素）→ Dragging →（松手）→ Flying 或 Idle（若在屏外则先 Gliding 回屏内）`

- `Flying`：重力 2600 px/s²。撞左、右、上边缘时反弹（系数 0.55）；落地时反弹（0.32）后受摩擦减速。停稳或飞满 8 秒后发出 `landed` 事件，`impact` 取整个飞行过程中的最大撞击速度。工作区（屏幕可用区域）在起飞时查询一次，存入阶段数据。
- 松手时速度大于 700 逻辑 px/s 算作「丢出去」，否则原地放下。速度上限 6000。
- `Gliding`：用于 `glide_by` 待机游动和放下后回到屏内，使用 smoothstep 插值。
- 点击穿透：只有当光标位于前端上报的 hit rects（身体框、气泡框）内，或处于按下 / 拖拽状态时，窗口才接收鼠标。

### 前端行为

- `Pet.mode`：`idle | action | drag | fly | sleep`。`act(pose, ms)` 使用递增的 token 实现可取消的定时姿势。
- 待机动作每 8～18 秒按权重抽一个：look、curious、yawn（深夜权重更高）、happy 哼歌、wander 游动、watch 坐下、bob 漂浮。
- 眨眼和说话只在 idle 姿势上生效，通过切换差分贴图实现。
- 落地 `impact > 1100` 时进入 hurt：坐地、晕眩星星、喊疼；`impact > 500` 时轻落地。
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
| `fall` / `glide_by` | motion.rs | async |
| `debug_throw` | motion.rs | 仅 DEV 生效：以给定速度抛出 |
| `store_load` / `store_save` | store.rs | 名称白名单：`settings`、`memory` |
| `data_dir` | store.rs | 应用数据目录 |
| `debug_dump` | store.rs | 仅 DEV 生效：写入 `debug/` 日志或 PNG |
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

## 数据

应用数据目录：macOS 为 `~/Library/Application Support/org.chubbywhale.pet/`，Windows 为 `%APPDATA%\org.chubbywhale.pet\`。

- `settings.json`：见 `Settings`（size、activityAware、commentOnPages、chattiness、llm{enabled,baseUrl,model,apiKey,shareTitles}）。API Key 明文保存。
- `memory.json`：`MemoryData v1`，包括 firstMet、opinions{id→{label,stance,firstSaid,since,mentions}}、facts（最多 80 条）、said（最多 400 条）、stats{pokes,throws,drags}。只由宠物窗口写入，写入有 400ms 防抖，先写临时文件再 rename 替换。
- `debug/`：仅开发版生成，包括 `log.txt` 和 `snap-*.png`。

## 美术流水线

1. 生图：使用 `.claude/skills/sub2api-imagegen` 技能。母版以 `ref/upstream` 中的设定图为参考生成；各姿势用 `edit` 接口，以 `ref/master.png` 和设定图为参考；眨眼和说话差分用 `ref/mask_*.png` 做局部编辑。
2. 网关返回的尺寸不一定等于请求的尺寸（例如 1216×1294），`build_sprites.py` 不依赖固定尺寸。差分图尺寸不一致时会按左上角对齐补齐画布。
3. 运行 `python art/build_sprites.py` 生成 `public/sprites/`。姿势的头部大小不一致时，调整 `POSES[name]["scale"]`（坐姿约 0.8）。
4. 新增姿势：添加提示词 → 生成 `raw/<name>.png` → 在 `POSES` 中登记 → 加入 `rig.ts` 的 `PoseName` → 按需加入 `pet.ts` 的 `EMOTION_POSE` 或待机动作。

## 不可破坏的约定

1. **motion.rs 的锁规则**：持有 `State` 锁时绝不能调用任何窗口 API（cursor_position、outer_position、monitor、set_position、emit、set_ignore_cursor_events……）。窗口 API 要和主线程往返，主线程可能正在等这把锁，同时持有就会死锁。这个问题实际发生过：丢出去时整个程序卡死。正确做法是快照 → 解锁做窗口操作 → 回写时检查 `epoch`。
2. 访问 motion 状态的命令必须是 `async`，不能在主线程执行。
3. 前端在 `pointerup` 里要先 `await` `dragBegin` 的 Promise，再调用 `dragEnd`。命令是异步的，乱序会导致宠物粘在鼠标上。
4. 所有姿势必须以同一显示比例渲染（`Rig.scale = height / idle.h`），头部大小靠 `build_sprites.py` 的逐姿势 scale 统一。
5. `public/sprites/` 是构建产物，修改美术要改 `art/` 下的源文件，再重新构建。

## 开发和调试

- `pnpm tauri dev`：开发运行。`pnpm build`：tsc 检查加 vite 构建。在 `src-tauri/` 下运行 `cargo clippy`。
- `VITE_PET_DEMO=1 pnpm tauri dev`：依次播放全部姿势，把截图存到 `debug/snap-*.png`。
- `VITE_PET_DEMO=throw pnpm tauri dev`：抛掷压力测试，结果写入 `debug/log.txt`（6 次 throw 的落地时间，以及后端往返耗时的最大值）。
- 显示器休眠或窗口不可见时，webview 会暂停 requestAnimationFrame，演示模式会手动驱动 ticker。
- 程序卡死时：用 `sample <pid> 2` 查看各线程调用栈。
- 用 node 26 可以直接运行 `src/brain/topics.ts` 来检查分类规则（它只有 type import）。
