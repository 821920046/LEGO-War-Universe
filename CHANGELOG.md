# Changelog — LEGO War Universe Production System

## V2.0 (2026-08-04)

从“提示词文档”升级为“可长期使用的生产体系”。完成 13 项优化：

### 组装器（index.html）
1. **数据解耦**：改为 `fetch` 外部 `02_Assets/assets.json`，带内嵌回退副本（本地 file:// 也能跑）。改 JSON 即更新全站。
2. **分片管理**：镜头清单按影片（Gulf War / Normandy …）分组，支持工程 JSON 导入/导出。
3. **一键导出分镜包**：`Shot_List.md` + 纯 Prompt `.txt`。
4. **Prompt 反解析**：粘回一段 Prompt 可自动回填资产编号。

### 一致性控制
5. **参考图/角色种子策略**：`referenceImage` 字段 + Flow Ingredients 提示。
6. **资产损耗/状态变体**：`clean / weathered / damaged / destroyed`。
7. **镜头连续性校验**：相邻镜头环境/灯光/色彩突变、跳轴、接力缺失自动告警。

### 内容深度
8. **分系列扩展**：新增二战 / 太平洋 / 冷战系列资产（共 111 项）。
9. **阵营/兵种维度**：`faction` + `unit`，支持敌我筛选。
10. **节奏模板**：预告片 / 纯录片 / 史诗，自动分配时间轴节奏。

### 工程化
11. **JSON Schema 校验**：`assets.schema.json` + `validate.py`。
12. **版本管理**：`schemaVersion` + 每资产 `version` / `changelog`。
13. **中英双语**：组装器支持 English Prompt / 中文对照预览双标签。

## V1.0

初版：世界观 Bible + 基础资产库 + 单片组装器（海湾战争）。

## V2.1 — 主题一键生成

### Added
- 『0 · 主题一键生成』卡片：输入中/英文主题即可直接产出 Flow 8 秒 Prompt（`Ctrl/⌘ + Enter` 快捷键）。
- 本地智能匹配（线路 A）：中英词表扩写 + IDF 稀有词加权 + 年代/系列门控，完全离线。
- AI 增强开关（线路 B）：可接自建 Endpoint，支持 `selectedIds` 或 `prompt` 两种响应；配置存于 localStorage（`lwu_ai_cfg`）。
- 匹配报告：展示识别到的系列、主体、环境、镜头、灯光、特效，方便人工微调。

### Fixed
- 关键词污染：「坦克」不再默认扩写为 Abrams；改用最长匹配+消耗，「黑鹰」不再误触 F-15、「火箭炮」不再误触 fire。
- 跨年代混搭：「谢尔曼坦克」不再匹配到 M1A1 Abrams；「斯大林格勒」不再混入海湾战争角色。
- 人物/载具优先级：主题未提及人物时，载具优先于其乘员角色。

### Fallback
- AI 开关关闭或调用失败时，一律自动回退本地匹配，功能不中断。

## V2.2 — 现代战争系列

### Added
- **Modern 系列**：资产库 111 → 210。新增 12 名现代角色、24 件现代载具/飞机/舰艇、10 种现代武器、10 件道具、12 个现代环境、6 个镜头、5 种灯光、10 种特效、10 条音频。
- 新增载具类型 `drone`（无人机）与 `ugv`（无人车）及专属动作库；soldier 动作库补充 9 个现代战术动作。
- 新增角色变体预设 `night-ops`（夜视仪放下、IR 闪烁器）与 `urban-cqb`。
- 主题识别新增 Modern 系列，词表覆盖无人机/特种/巷战/电子战/夜视/热成像等现代术语。

### Changed
- **风格块强约束**：明确要求地形、建筑、水面、烟雾、碎片全部由积木搭建，可见颁点与模具合缝，统一 minifigure 比例。
- **负面词强化**：禁止非积木真实材质；禁止年代错乱的装备与制服。
- schemaVersion 3.0 → 3.1；schema 与 validate.py 同步放开新载具类型。

### Fixed
- **短 token 子串误匹配**：`CH-47` 的 `ch` 曾命中 `breach`、`Su-57` 的 `su` 曾命中 `suppressed`。现改为词边界匹配（3 字符以下必须整词命中）。
- **连字符型号失配**：`T-90`、`F-35`、`MQ-9` 等写法现在会同时比对去连字符的紧凑形式。
- HIMARS 现在能正确触发火箭炮动作库（之前只匹配 MLRS 字样）。


## V2.3 — Hybrid Realism（混合写实）

### Changed
- `styleBlock` 重写：固体一律积木化，天气/水体/爆破特效一律写实（photoreal），并声明两者的物理交互。
- `negative` 更新：删除“禁止真实水/沙/布料”，改为禁止“塑料感/积木化的水、雨、雪、雾、烟、火”与“方块化爆炸/卡通烟团”。
- 全部 36 个环境统一插入混合写实声明行。
- 13 项旧特效（爆炸/尘土/曳光/烟幕/旋翼扬尘等）改写为写实版，碎片仍为积木。

### Added
- FX-501~512：暴雨、风雪、浓雾、雷暴闪电、沙尘暴、蘑菇云、战场硝烟、火花四溅、水花尾流、深海水下、泥泞、燃烧残骸。
- ENV-501~508：风暴海面、深海水下、渡河点、黎明湖泊、雨夜城市、浓雾松林、洪泛沼泽、暴风雪山口。
- AUD-501~504：大雨、雷鸣、风雪、海浪与河水。
- 主题匹配新增 40+ 天气/水域中文关键词（暴雨、大雾、深海、渡河、蘑菇云、硝烟、火花……）。
- schemaVersion → 3.2，资产总数 229。


## V2.4 — AI 增强后端落地

### Added
- `06_Deploy/worker.js`：Cloudflare Worker 后端，支持 Gemini（默认）与 OpenAI 兼容接口。
- `06_Deploy/wrangler.toml`：部署配置，密钥走 Cloudflare Secret。
- `06_Deploy/README.md`：三分钟部署指南、接口约定、成本说明、本地匹配与 AI 增强对比表。
- 后端内置安全网：模型返回的资产 ID 与请求资产表校对，幻觉 ID 直接丢弃；全部非法则返回 502 让前端回退。
- 后端系统提示词内置年代门控、阵营一致性、“硬件积木 / 天气写实”铁律、天气特效强制匹配规则。
- 可选 `ACCESS_TOKEN` 口令保护，防止接口被白嫖。

### Changed
- 页面「AI 增强」面板文案更新：从“需自建后端”改为“后端代码已附带”，并明确警告不要在前端填写模型原始密钥。
- 页面标题版本号统一为 V2.3。


## V2.5 — 界面全面中文化 + 新手引导

### Changed
- 顶部新增「👋 新手必读 · 3 步搞定」引导卡片：写主题 → 一键生成 → 复制到 Flow，明确告诉新手从哪开始。
- 三个核心区改用 ①②③ 编号：① 输入主题、② 手动微调（标注「进阶可选，新手可跳过」）、③ 生成结果。
- 去除界面上所有多余英文术语：Shot ID / Series / Faction / Environment / Camera / Lighting / Aspect / Dialogue / English Prompt / Continuity / Timeline / Asset Reference 等标签全部改为纯中文。
- 表单示例、台词占位符改为中文示例。
- 结果区两个标签页改为「英文提示词（粘进 Flow）」「中文对照（看懂用）」，并把「复制提示词」按钮改为主色高亮，更醒目。
- 资产参考表分类名与表头全部中文化（角色/载具/武器/特效/场景/镜头/灯光/色彩/音频；编号/名称/年代·阵营/旧编号）。

### Note
- 仅改动界面文案与引导结构，资产库、匹配逻辑、提示词模板均未改动，行为与 V2.3 一致。


## V2.6 — AI 增强改为 Pages 环境变量驱动（前端零配置）

### Changed
- AI 增强后端新增 Cloudflare Pages Function：<code>functions/api/compose.js</code>，同源路由 <code>/api/compose</code>。
- 前端移除「后端 Endpoint」和「访问口令」两个输入框（及其 localStorage 存储），<code>aiCompose()</code> 改为固定请求同源 <code>/api/compose</code>。
- AI 增强面板改为只保留一个「启用 AI 增强」开关，并说明密钥 / 提供商 / 模型统一在 Pages 项目的 Environment variables 里配置。

### Env vars (在 Cloudflare Pages 项目设置)
- <code>GEMINI_API_KEY</code>（Secret，必填）、<code>PROVIDER</code>（默认 gemini）、<code>MODEL</code>（可选）。
- <code>OPENAI_API_KEY</code> / <code>OPENAI_BASE_URL</code>（仅 PROVIDER=openai）、<code>ACCESS_TOKEN</code>（可选）。

### Note
- 独立 Worker（<code>06_Deploy/worker.js</code> + <code>wrangler.toml</code>）作为备选方案保留；默认推荐用 Pages Function，无需单独 <code>wrangler deploy</code>。
- 自检：部署后访问 <code>你的域名/api/compose</code> 应返回 <code>{"ok":true,…}</code>。


## V2.7 — 界面全中文（资产/动作/特效/变体等显示名）

### Changed
- 为全部 234 个资产新增 <code>nameZh</code> 中文显示名（角色 / 载具 / 武器 / 道具 / 特效 / 场景 / 镜头 / 灯光 / 音频 / 色彩）。
- 主体芯片、已选列表、场景/镜头/灯光/色彩下拉框、动作芯片、特效/音频芯片、变体下拉框、资产参考表、系列/阵营筛选器均改为显示中文。
- 新增 <code>motionLabelsZh</code>（动作）、<code>seriesLabelsZh</code>（系列）、<code>factionLabelsZh</code>（阵营）三个中文映射表。

### 关键说明
- <b>只改显示，不改提示词</b>：最终生成、复制到 Flow 的提示词仍为英文（Flow 对英文词效果最佳），仅网页 UI 显示为中文。


## V2.8 — AI 增强面板只留开关（删除 Endpoint / ACCESS_TOKEN 输入框）

### Changed
- 前端 AI 增强面板现在只保留一个「启用 AI 增强」复选框；删除了「后端 Endpoint（POST JSON）」和「访问口令 ACCESS_TOKEN」两个输入框及其本地存储。
- 启用后固定请求同源 <code>/api/compose</code>（随站点部署的 Pages Function <code>functions/api/compose.js</code>）；密钥 / 提供商 / 模型 / 访问口令统一在 Cloudflare Pages 的环境变量里配置。
- <code>loadAiCfg/saveAiCfg</code> 现在只持久化 <code>{enable}</code>。


## V2.9 — 整片生成（自定义时长）+ 界面重构

### Added
- 【整片分镜引擎】输入主题 + 总时长（秒，可自定义，8～1200 秒），自动按 8 秒切分为 N 个镜头并逐个生成提示词。快捷时长：32 秒 / 1 / 2 / 3 / 5 / 10 分钟。
- 【叙事结构】按 rhythmTemplates（预告片 / 纪录片 / 史诗）将镜头分配到四个阶段：开场铺垫 → 推进升级 → 高潮交火 → 收尾余韵；每阶段自动匹配运镜、灯光、动作、特效强度。
- 【跨镜头一致性】全片锁定同一场景、同一色彩风格、同一主角阵容；天气特效（雨/雪/难/沙尘）贯穿所有镜头；同阶段内自动开启动作接力；收尾阶段自动切为战损形态。
- 【输出】每个镜头带时间码（00:00–00:08 …）、阶段标签、中文动作描述、单镜复制按钮；支持一键复制全部、导出 .txt / .md；生成后自动存入分镜清单、时间轴与连续性检查。

### Changed
- 【布局重构】改为四个标签页：🎬 整片生成（默认）/ ✂️ 单镜头微调 / 📋 分镜清单 / 📚 资产库，不再把所有内容堆在一页。
- 【UI 刷新】新增品牌头部与吸顶导航、卡片阴影与圆角统一、阶段色条、等宽提示词框、移动端响应式单列布局。
- 画幅比例提升为全片全局设置。

### Removed
- 删除「新手必读 · 3 步搞定」整块引导卡片。
