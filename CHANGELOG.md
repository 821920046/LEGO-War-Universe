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

## V3.0 — AI 导演 + 资产库大扩充

### 1. 任何主题都必出提示词（三级兜底，永不报错）
- 旧版本地关键词匹配不到主体时会直接报错「未能从主题识别出主体资产」并停止，即使已勾选「启用 AI 增强」也不会调用大模型。该硬失败分支已彻底移除。
- 新流程：
  1. 勾选「启用 AI 增强」→ 直接交给 **AI 导演**（`/api/compose`，`mode=film`），AI 读取整个资产库、自己挑资产、自己编排整片分镜；
  2. AI 不可用 / 超时 / 未配 Key → 自动回退**本地智能引擎**，并在结果区说明回退原因；
  3. 本地也匹配不到 → 使用 `defaultCast()` 通用现代战争阵容兜底（1 名角色 + 1 地面载具 + 1 空中载具），照常输出完整分镜。
- 单镜头微调页同样不再死路：匹配不到时自动填入通用阵容并提示可开启 AI。

### 2. 中文主题直接命中
- `assetKeywords()` 过去只索引资产的英文 `name`，中文主题必须靠 `ZH2EN` 词表转译，词表没有的词（营救、救援、医疗、雪山、丛林……）一律匹配失败。
- 现在索引 `name` + 新增的 `kw`（中英混合关键词）+ `nameZh` + `unit`，中文主题可直接命中资产。

### 3. AI 从「选资产」升级为「AI 导演」
- 后端 `functions/api/compose.js` 新增 `mode="film"`：一次调用产出整片计划 `{env, clr, weather, note, shots:[{phase, subjects, cam, lgt, fx, audio, motion, action, actionZh}]}`。
- 导演级约束：镜头数严格等于 N；全片锁定同一环境 + 同一色调；时代/阵营一致；establish → build → climax → resolve 四幕递进；每镜只做一个 8 秒内可完成的动作；固定 2–4 人主演贯穿全片；motion 必须逐字取自动作库。
- 服务端 `sanitizeFilm()` 校验：所有 ID 必须存在于资产库（非法 ID 丢弃）、phase 归一化、镜头数补齐/截断到 N。
- 前端 `buildFilmFromPlan()` 拿到 AI 计划后，仍用本地 `assemble()` 组装最终提示词，保证 LEGO 风格块、8 秒规范、负向提示词、画幅永不丢失。
- 资产上限 400 → 700；`maxOutputTokens` 提升至 8192；超时 120 秒。

### 4. 资产库 234 → 376（schemaVersion 3.3）
| 类别 | 原 | 现 | 新增重点 |
|---|---|---|---|
| 角色 | 24 | 48 | 伞降救援兵、战地医疗兵、战地外科医生、落难飞行员、绞车操作手、海上救生员、军犬组、破门手、机枪手、迫击炮手、工兵、极地/丛林/山地/陆战队/战斗潜水员、现代车长、车队驾驶员、战地记者、待撤离平民、游击火箭筒手、内河射手、女性特战队员、前线引导员 |
| 载具 | 51 | 78 | HH-60W 救援直升机、支奴干、鱼鹰、雌鹿、卡-52、防雷救护车、悍马、武装皮卡、装甲推土机、自行榴弹炮、两栖突击车、指挥车、油罐车、雪地履带车、C-130、AC-130、加油机、超级大黄蜂、苏-34、FPV 自杀无人机、补给无人机、排爆机器人、后送无人车、突击艇、医院船、潜艇、气垫登陆艇 |
| 环境 | 36 | 58 | 沙漠村落、坠机现场、雪山隘口、丛林河道、极地苔原、洪水城镇、燃烧油田、地下坑道、难民营、争夺桥梁、野战医院、远海风暴、礁岩海岸、夜间港区、沙暴公路、城市楼顶、前进机场、洞穴群、扫雷通道、边境检查站、废弃居民楼、黄昏航母甲板 |
| 特效 | 30 | 44 | 旋翼扬尘、红外干扰弹、曳光弹弧线、烟幕、救援水雾、雪崩雪雾、油火黑烟、塌方尘云、红外激光、镜头雨珠、热浪扭曲、落水浪花、夜间枪口焰、弹着火花 |
| 音效 | 26 | 40 | 无线电求救、绞车、旋翼、暴风雪、丛林环境、声纳、无人机蜂鸣、人群慌乱、军犬、监护仪、警报、海浪、履带摩擦、远方炮声 |
| 镜头 | 16 | 26 | 绞车吊索视角、热成像顶视、过肩跟随、武器摄像、摇臂揭示、低机位穿越废墟、甩镜、半潜水下、医疗特写、车头固定机位 |
| 灯光 | 13 | 22 | 阴天散射、暴雪白化、丛林斑驳、夜视绿、照明弹夜景、油火橙光、晨雾光、坑道工作灯、甲板泛光灯 |
| 武器 | 13 | 21 | 大口径狙击枪、便携防空导弹、迫击炮、RPG-7、40mm 榴弹发射器、激光指示器、卫星制导炸弹、鱼雷 |
| 道具 | 20 | 34 | 折叠担架、救援吊篮、急救包、保温毯、卫星终端、防爆围墙、铁丝网卷、空投托盘、油桶架、碎砖堆、着陆区标识板、野战手术台、装具挂架、弹药箱堆 |
- 新增 29 条动作短语（抬担架、救治伤员、破门突入、索降、扒废墟搜救、悬停吊救、放下绞车、载伤员升空、释放干扰弹、空投补给、空中受油、上浮出水、俯冲撞击……）并全部配中文标签。
- 所有新资产遵循 V2.3 混合真实感规则：实体（地形、建筑、载具、人物）为乐高积木；天气、水体、硝烟、火焰、爆炸为真实物理效果。

### 5. 结果区新增来源说明
- 分镜结果顶部显示「编排来源：AI 导演（从 N 个资产中挑选）」或「编排来源：本地智能引擎 / 本地引擎（AI 回退）」，回退原因与兜底提示以橙色显示，问题可见可诊断。

## V3.1 — 多大模型故障转移 + 轮询

### 多模型链（掉一个自动换下一个）
- `functions/api/compose.js` 重写为**模型链**架构：一次请求按顺序走整条链，第一个成功就返回；任何失败（Key 无效、额度用完、429 限流、5xx、超时、返回非法 JSON、选不出合法资产 ID）都**自动落到下一个模型**，而不是直接报错。
- 语义校验也会触发转移：某个模型能返回 JSON 但没挑出任何真实存在的资产 ID，同样算失败，换下一个模型重试。

### 轮询负载
- 每次请求的**起点依次后移**（round-robin），不再永远只碾第一个模型，免费额度均匀消耗。
- 设 `ROTATE=off` 则回到严格优先级模式（总从第一个开始，仅失败时下移）。

### 内置 10 个厂商
| provider | Key 环境变量 | 默认模型 |
|---|---|---|
| `gemini` | `GEMINI_API_KEY` | gemini-2.0-flash |
| `deepseek` | `DEEPSEEK_API_KEY` | deepseek-chat |
| `openai` | `OPENAI_API_KEY` | gpt-4o-mini |
| `qwen`（百炼/DashScope） | `QWEN_API_KEY` | qwen-plus |
| `zhipu`（智谱） | `ZHIPU_API_KEY` | glm-4-flash |
| `moonshot`（Kimi） | `MOONSHOT_API_KEY` | moonshot-v1-8k |
| `groq` | `GROQ_API_KEY` | llama-3.3-70b-versatile |
| `siliconflow`（硅基流动） | `SILICONFLOW_API_KEY` | Qwen/Qwen2.5-72B-Instruct |
| `openrouter` | `OPENROUTER_API_KEY` | google/gemini-2.0-flash-001 |
| `custom`（任意 OpenAI 兼容网关） | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` + `CUSTOM_MODEL` | — |

### 两种配置方式
1. **零配置自动发现**：只要把你有的 Key 填进 Pages 环境变量，系统自动按 gemini → deepseek → openai → qwen → zhipu → moonshot → groq → siliconflow → openrouter → custom 组成链。填几个就有几重冗余。
2. **显式指定链**：`MODELS = gemini:gemini-2.0-flash, gemini:gemini-1.5-flash, deepseek:deepseek-chat, openai:gpt-4o-mini`。逗号/分号/换行分隔，顺序即故障转移顺序；**同一厂商的不同模型可以写多次**（例如先 flash 后降级到 1.5-flash）。

### 其他新环境变量
- `<PROVIDER>_MODEL` / `<PROVIDER>_BASE_URL`：单独覆盖某厂商的模型名或代理地址（如 `DEEPSEEK_MODEL=deepseek-reasoner`、`OPENAI_BASE_URL=https://你的代理/v1`）。
- `TIMEOUT_MS`：单个模型超时（默认 45000，超时即切下一个）。
- 旧的 `PROVIDER` + `MODEL` 完全兼容，会被放在链的**最前面**，无需修改已有部署。

### 可观测性
- 成功响应新增 `provider` / `model` / `failover` / `chainSize`；网页结果区直接显示「编排来源：AI 导演 deepseek-chat（从 376 个资产中挑选）；已自动跳过 2 个失败模型」。
- 全链失败时返回 `attempts` 数组（每个模型的具体错误），前端会把“哪个模型挂了 / 为什么挂”直接写在页面上，然后照旧回退本地引擎——**仍然不会报错停住**。
- 自检接口 `GET /api/compose` 现在返回整条链、被跳过的厂商及原因（如 `missing DEEPSEEK_API_KEY`）、轮询开关与超时值。
