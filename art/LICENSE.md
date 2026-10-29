# 美术素材许可

`art/` 和 `skins/*/sprites/` 下的所有立绘、差分和图标（下称"美术素材"）采用
[知识共享 署名-非商业性使用-相同方式共享 4.0 国际许可协议（CC BY-NC-SA 4.0）](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)。

- **署名**：Chubby Whale 贡献者。角色设计参考了
  [鲸鱼娘开源资产库](https://treapgogo.github.io/deepseek-whale-girl/) 中社区整理的"Q 版大肥鱼"设定图
  （`ref/upstream/dafeiyu-chibi-character-sheet.png`）。男版皮肤「深海蓝调」的角色设计参考了
  「深海蓝调 AI 角色设定集」（`skins/deep-blue/ref/upstream/character-sheet.png`）。
- **非商业性使用**：不得将美术素材（及包含美术素材的本软件）用于商业目的。
- **相同方式共享**：基于美术素材的二次创作须以相同协议发布。

美术素材由图像生成模型根据 `prompts/` 中的提示词和上述参考图生成，再经
`build_sprites.py` 处理（清理半透明光晕、裁切、缩放、合成眨眼/说话差分）。

"大肥鱼 / 鲸鱼娘"是社区形成的去中心化同人形象，本项目与深度求索（DeepSeek）公司无关，
不代表其官方立场。
