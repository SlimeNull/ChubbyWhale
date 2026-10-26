# AGENTS.md

写给在本仓库工作的 AI agent（以及人类贡献者）。

## 必须：实时同步 docs/STRUCTURE.md

[docs/STRUCTURE.md](docs/STRUCTURE.md) 记录项目的目录职责、运行时架构、前后端接口、数据格式和不可破坏的约定。**每次修改项目，都要在同一次改动里同步更新它**，不能留到以后再补，也不能只在回复里说明。

出现下面任何一种情况都要更新：

- 新增、删除、重命名或移动文件和目录，或者某个文件的职责变了
- 新增或修改 Rust 命令、前端 IPC 封装（`src/ipc.ts`）、事件名称或 payload
- `settings.json` / `memory.json` 的字段或格式变了
- 姿势、差分、特效类型、待机动作、话题类别等列表有增减
- 影响行为的常量或阈值改了（物理参数、停留时长、冷却时间、发言间隔等）
- 构建、打包、CI、美术流水线、调试方式有变化
- 新增或改变了「不可破坏的约定」（例如锁规则这类踩过的坑）

做法：

1. 改代码之前先读 `docs/STRUCTURE.md`，了解现有结构和约定。
2. 改完后对照上面的清单检查，更新相关章节。文档要描述代码**当前的样子**，不要写成变更日志。
3. 如果这次改动确实不影响文档里写的任何内容（例如只改了一句台词、修了一个局部 bug），可以不改，但要在交付说明里写一句「STRUCTURE.md 无需更新」并说明原因。
4. README.md 面向用户，只写功能、安装和使用方式。结构细节以 `docs/STRUCTURE.md` 为准，不要在两处各维护一份。

## 不可破坏的约定（详见 STRUCTURE.md）

- `src-tauri/src/motion.rs`：持有 `State` 锁时**绝不能**调用任何窗口 API，否则会和主线程死锁（实际发生过：丢出去时卡死）。motion 相关的命令必须是 `async`。
- 前端 `pointerup` 必须先等 `dragBegin` 完成，再调用 `dragEnd`。
- `public/sprites/` 是构建产物。美术改 `art/` 下的源文件，然后运行 `python art/build_sprites.py`。
- 美术素材许可为 CC BY-NC-SA 4.0（禁止商用），代码许可为 GPL-3.0-or-later。不要引入和这两个许可冲突的依赖或素材（例如闭源的 Live2D Cubism Core）。

## 改完之后的检查

- `pnpm build`（tsc 类型检查加 vite 构建）
- 在 `src-tauri/` 下运行 `cargo clippy`，不能有新警告
- 涉及拖拽、抛掷或窗口移动的改动：运行 `VITE_PET_DEMO=throw pnpm tauri dev`，确认 `debug/log.txt` 里 6 次都落地，并且没有 `STALL`
- 测试实例要用 1430 端口启动，结束时只结束自己启动的进程，不要动用户正在跑的实例（做法见 STRUCTURE.md「开发和调试」）
- 涉及渲染或姿势的改动：运行 `VITE_PET_DEMO=1 pnpm tauri dev`，查看 `debug/snap-*.png`
