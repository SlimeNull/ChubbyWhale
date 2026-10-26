# 大肥鱼 Chubby Whale

一只住在你桌面上的 Q 版鲸鱼娘桌宠。支持 Windows 和 macOS，开源免费。

<p align="center"><img src="public/sprites/idle.webp" height="260" alt="大肥鱼"></p>

> 角色形象参考社区的「Q 版大肥鱼」设定（[鲸鱼娘开源资产库](https://treapgogo.github.io/deepseek-whale-girl/)）。
> 本项目是同人作品，与深度求索（DeepSeek）公司无关。

## 她会做什么

- **待机动画**：呼吸、眨眼、东张西望、思考、打哈欠、哼歌、在屏幕底部游来游去、坐下来陪你。身体会微微朝鼠标方向倾斜。你离开电脑 5 分钟后她会睡着，你回来时她会醒过来。
- **拖拽**：按住她就能拎起来。她被揪着后领晃来晃去，甩得越快晃得越厉害。
- **丢出去**：拖动时快速一甩再松手，她会沿抛物线飞出去，撞到屏幕边缘会反弹。重重落地后会坐在地上眼冒金星，说一句「哎哟，好痛……」。
- **戳一戳**：单击会害羞，连续乱戳她会生气。
- **陪你干活**：发现你在写代码、写文档、开终端时会给你加油（「好认真呀~」「在写 motion.rs 吗？」），连续写太久会提醒你休息。
- **评价网页**：在一个网页上停留一会儿后，她会对页面内容发表评价。例如看到 Minecraft 会说「这游戏我也超喜欢玩~」，在京东看 MacBook 会说「呜哇！MacBook 要 ¥12999！好贵！」，打开 DeepSeek 会说「这不是我老家嘛」，打开别的 AI 会小小地吃醋。
- **记性很好**：说过的话和表过态的喜好都保存在本地。比如她第一次评价某个游戏时决定了喜不喜欢，以后会一直保持这个态度，不会前后矛盾。
- **可选 AI 对话**：在设置里填入 DeepSeek（或任何兼容 OpenAI 接口的服务）的 API Key 后，台词由大模型生成，但仍然受记忆约束。如果模型的回复和已记住的态度矛盾，这句回复会被丢弃，改用内置台词。

右键点击大肥鱼，或点击菜单栏/托盘图标，可以打开菜单（说说话、藏起来、回到角落、设置、退出）。

## 安装

到 [Releases](../../releases) 下载对应系统的安装包。

### macOS

应用没有经过 Apple 公证，第一次打开时会被系统拦截：

1. 双击打开，看到"无法验证开发者"的提示后点「完成」。
2. 打开「系统设置 → 隐私与安全性」，在页面下方找到大肥鱼，点「仍要打开」。

如果想让她能看到浏览器里的网页标题，需要在「系统设置 → 隐私与安全性 → 屏幕录制」里允许大肥鱼。她只读取窗口标题文字，不会截图或录屏。授权后重启她即可。不授权时她只知道你在用哪个应用。

### Windows

运行安装包。如果 SmartScreen 弹出提示，点「更多信息 → 仍要运行」。

## 隐私

- 默认完全离线：只在本地读取前台应用名、窗口标题和键鼠空闲时长，用来挑选台词。
- 开启 AI 对话后，默认只把「在写代码」「在看 Minecraft」这类概括发给你配置的接口。只有勾选「允许把窗口标题发送给 AI」后，才会发送完整标题。
- 设置和记忆都保存在本机数据目录（设置页底部会显示具体路径）。API Key 以明文保存在 `settings.json` 中。

## 开发

需要 Node.js、pnpm 和 Rust 工具链（另需各平台的 Tauri 依赖，见 [Tauri 文档](https://tauri.app/start/prerequisites/)）。

```sh
pnpm install
pnpm tauri dev          # 开发运行
pnpm tauri build        # 打包
```

开发模式下，前端的错误会写入数据目录下的 `debug/log.txt`。用 `VITE_PET_DEMO=1 pnpm tauri dev` 启动时，会依次播放所有姿势，并把每个姿势的画面保存成 `debug/snap-*.png`。

推送 `v*` 标签会触发 GitHub Actions，构建 macOS（Apple Silicon / Intel）和 Windows 安装包，并生成一个 Release 草稿。

### 项目结构

目录职责、运行时架构、前后端接口和开发约定见 [docs/STRUCTURE.md](docs/STRUCTURE.md)。参与开发前请先读 [AGENTS.md](AGENTS.md)。

### 立绘

立绘不是 Live2D 模型。每个姿势是一张完整立绘，渲染时套在细分网格上做形变来实现呼吸、倾斜、挤压拉伸和摆动；眨眼和说话通过切换局部差分实现。所以项目不依赖闭源的 Live2D Cubism Core，可以完整开源。

素材流程：`art/prompts/` 中的提示词加上 `art/ref/` 中的参考图，经图像模型生成 `art/raw/`；然后运行 `python art/build_sprites.py` 生成 `public/sprites/`。新增姿势的步骤：加一个提示词，生成原图，在 `build_sprites.py` 和 `src/pet/rig.ts` 的 `PoseName` 里登记。

## 许可

- 代码：[GPL-3.0-or-later](LICENSE)
- 美术素材（`art/`、`public/sprites/`、应用图标）：[CC BY-NC-SA 4.0](art/LICENSE.md)，**禁止商业使用**
