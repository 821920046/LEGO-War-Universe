#  LEGO War Universe (LWU) — Google Flow Production Bible V2.0

> 一套面向 **Google Flow (Veo 3)** 的电影工业级长片制作体系。
> 目标不是写一次性 Prompt，而是建立可长期使用的 **资产管线 + 提示词组装系统**，让几十甚至几百个 8 秒镜头保持人物、装备、风格的一致性。

---

## 这是什么

本项目把电影公司（Pixar / ILM / Weta）的资产管理思路搬到 AI 视频生成上：

```
世界观 → 角色 → 道具 → 载具 → 环境 → 镜头 → 动作 → 灯光/色彩 → Prompt
```

**Prompt 永远是最后一步，由资产自动组装而成。**

包含三部分：

1. **Production Bible（制作圣经）** — 完整的世界观、角色、载具、环境、镜头、动作、灯光、音频规范（`00_Project/` 与 `01_Bible/`）。
2. **Asset Database（资产数据库）** — 机器可读的 `02_Assets/assets.json`，是所有资产的唯一真相来源（single source of truth）。
3. **Prompt Composer（提示词组装器）** — 根目录 `index.html`，一个纯静态网页应用，读取资产库并自动拼装可直接粘贴进 Flow 的英文 Prompt。可一键部署到 Cloudflare Pages。

---

## 目录结构

```
LEGO-War-Universe/
├── index.html                  # ⭐ Prompt Composer 网页应用（Cloudflare 部署入口）
├── README.md
├── 00_Project/
│   ├── Vision.md               # 项目愿景与系列规划
│   ├── Production_Pipeline.md   # 资产管线（Asset Pipeline）
│   ├── Flow_Best_Practices.md   # Flow / Veo 3 最佳实践
│   └── Style_Guide.md           # 统一视觉风格规范
├── 01_Bible/
│   ├── World_Bible.md
│   ├── Character_Bible.md
│   ├── Vehicle_Bible.md
│   ├── Weapon_Bible.md
│   ├── Environment_Bible.md
│   ├── Camera_Bible.md
│   ├── Lighting_Bible.md
│   ├── Animation_Bible.md
│   ├── Audio_Bible.md
│   └── Prompt_Rules.md
├── 02_Assets/
│   └── assets.json              # ⭐ 资产唯一真相来源（驱动 Composer）
├── 03_Flow/
│   ├── Prompt_Template.md
│   ├── Shot_Template.md
│   ├── Scene_Template.md
│   ├── Continue_Rules.md
│   ├── Consistency_Rules.md
│   └── Negative_Prompt.md
├── 04_Movies/
│   └── Gulf_War/
│       ├── Shot_List.md         # 海湾战争示范分镜（约 90 秒）
│       └── Timeline.md
└── 05_Tools/
    ├── Prompt_Composer.md       # 组装器说明书
    ├── Naming_Rules.md          # 命名规范
    ├── Timeline_System.md
    ├── Shot_Manager.md
    └── QA_Checklist.md
```

---

## 快速开始

### 1. 本地使用组装器
直接用浏览器打开根目录的 `index.html` 即可。填写镜头主题、勾选资产，点「生成 Flow 提示词」，复制结果粘贴进 Google Flow（模型选 **Veo 3**，时长选 **8s**）。

### 2. 部署到 Cloudflare Pages（推荐）

**方式 A — 拖拽上传（最简单）**
1. 登录 Cloudflare Dashboard → **Workers & Pages**
2. **Create application → Pages → Upload assets**
3. 把整个 `LEGO-War-Universe` 文件夹拖上去 → **Deploy site**
4. 得到 `xxx.pages.dev` 网址，打开即用（组装器为站点首页）。

**方式 B — 命令行 Wrangler**
```bash
npm install -g wrangler
cd LEGO-War-Universe
npx wrangler pages deploy . --project-name lego-war-universe
```

**方式 C — 连接 Git 自动部署**
把本项目推到 GitHub，在 Cloudflare Pages 里连接仓库，Build command 留空，Output directory 填 `/`（纯静态，无需构建）。

---

## 工作流一句话总结

> 想拍一个新镜头？→ 打开组装器 → 选资产 → 生成 Prompt → 粘进 Flow → 加入镜头清单 → 下一个 S 编号。
> 想扩展新战役（诺曼底 / 中途岛…）？→ 只在 `assets.json` 增加资产，规范与模板不变。

版本：V2.0 ｜ 适用：Google Flow (Veo 3) ｜ 许可：内部制作使用


---

## V2.0 新增（一步到位）

本版将项目从“提示词文档”升级为“生产体系”，完整变更见 `CHANGELOG.md`。亮点：

- **根目录 `index.html` = Prompt Composer V2.0**（部署到 Cloudflare Pages 后即为站点首页）：
  - 资产库改为 `fetch` 外部 `02_Assets/assets.json` 加载（带内嵌回退），改 JSON 即更新全站；
  - 按影片分组的镜头清单、工程 JSON 导入/导出、`Shot_List.md` + Prompt `.txt` 导出；
  - Prompt 反解析、连续性校验、节奏模板时间轴、中英双语预览；
  - 系列/阵营筛选、每个主体的损耗变体（clean/weathered/damaged/destroyed）、Ingredients 参考图提示。
- **`02_Assets/`**：新增 `assets.schema.json` + `validate.py`；`assets.json` 升级到 schema 3.0，新增 `faction`/`unit`/`variants`/`referenceImage`/`version` 字段，并扩展二战/太平洋/冷战系列（共 111 项资产）。详见 `02_Assets/README.md`。

### 部署提示
部署时请上传**整个文件夹**（而非仅 `index.html`），以保证组装器能 `fetch` 到 `02_Assets/assets.json`。


---

## V2.1 新增：主题一键生成（Theme → Prompt）

以前的合成器需要你手动逐项选资产。V2.1 在页面最上方增加了『0 · 主题一键生成』卡片：
**输入中文（或英文）主题 → 点『一键生成提示词』→ 直接得到可粘贴到 Flow 的 8 秒 Prompt。**

### 线路 A：本地智能匹配（默认，離線、免费、无需后端）

三层匹配算法：

1. **最长匹配 + 消耗式中英扩写**：中文词先长后短匹配并从待扫描串中移除。因此「黑鹰」不会再触发「鹰→F-15」，「火箭炮」不会再触发「火→fire」。
2. **IDF 稀有词加权**：专名（abrams、apache、sherman）权重高于泛词（tank、soldier），避免「谢尔曼坦克」被 M1A1 Abrams 抢占。
3. **年代 / 系列门控**：从主题推断 WWII / Pacific / Cold War / Gulf War，同系列资产 +2、跨系列 -3。「斯大林格勒」不会再混进海湾战争士兵。

匹配后会自动填入右侧表单（主体/环境/镜头/灯光/调色/特效/音频/动作）并立即生成 Prompt，同时列出匹配报告，你可以微调后重新生成。快捷键：`Ctrl / ⌘ + Enter`。

### 线路 B：AI 增强（可选开关，需自建后端）

展开『⚙ AI 增强』勾选并填入你自己的 Endpoint（例如一个 Cloudflare Worker）与可选 API Key（保存在浏览器 localStorage，不会上传到别处）。

请求（POST JSON）：

```json
{ "theme": "阿帕奇夜袭沙漠坦克纵队",
  "assets": [{ "id": "AIR-004", "name": "AH-64 Apache", "series": "Gulf War", "faction": "Coalition" }] }
```

响应二选一：

```json
{ "selectedIds": ["AIR-004", "ENV-001", "CAM-003"], "action": "Apache strafes a tank column" }
{ "prompt": "...完整英文 Prompt...", "promptZh": "...可选中文对照..." }
```

返回 `selectedIds` 时，页面会用你现有的风格块/负面词模板拼装，风格一致性仍然受控。
**任何失败（超时 20 秒 / 非 200 / 网络错误）都会自动回退到线路 A，不会让你拿不到结果。**


---

## V2.2 新增：现代战争系列 + 全积木搭建强约束

本项目的核心是**物理乐高积木搭建的战争片**，且不局限于二战题材。V2.2 围绕这两点做了根本性扩充。

### 1. “一切皆为积木”写进风格块

风格块（STYLE-LWU）新增强制约束，每条 Prompt 都会带上：

- 画面内**每一个元素**都由积木搭建：地形、建筑、水面、烟雾、碎片均包含在内
- 积木搭建的环境，可见颁点、内管与模具合缝
- 全场景统一 minifigure 比例
- 非真实世界材质——这是一个实体乐高场景模型

负面词同步新增：禁止真实沙地/水体/布料等非积木材质、禁止将二战装备混入现代场景、禁止年代错乱的制服与武器。
所有新增环境的描述都以 *entirely brick-built from LEGO elements* 开头。

### 2. Modern（现代战争）系列

资产库从 111 扩充到 **210**，新增的全部属于 Modern 系列：

| 类别 | 数量 | 代表资产 |
|---|---|---|
| 角色 | 12 | 特种部队操作手、无人机操作员、JTAC、军医、狙击手、女性侦察兵、PMC、拆弹兵、班长、防化兵、电子战专家、便携防空手 |
| 载具 | 10 | M1A2 SEPv3、Stryker、JLTV、MRAP、HIMARS、豹2A7、T-90M、M2A4、无人战车 UGV |
| 空中 | — | F-35A、F-22、MQ-9 死神、TB2、V-22 鱼鹰、CH-47F、AH-64E、UH-60M、FPV 自杀无人机、Su-57、侦察四轴 |
| 海上 | — | 朱姆沃尔特级驱逐舰、弗吉尼亚级潜艇、滨海战斗舰 |
| 武器 | 10 | M4A1、HK416+消音器、标枪、NLAW、毒刺、RPG-7、巡飞弹、JDAM、M240、迫击炮 |
| 道具 | 10 | 无人机地面站、卫星终端、HESCO 防爆墙、隔离墅、IED、夜视仪、ATAK 平板、伪装网、检查站、弹药托盘 |
| 环境 | 12 | 现代巷战街区、废墟城区、前进基地、无人机作战中心、现代机场、地铁站、集装箱港口、山地哨所、沙漠公路、公寓内部 CQB、边境检查站、东欧雪地 |
| 镜头 | 6 | FPV 穿越机追逐、热成像光学、夜视 POV、头盔镜头、卫星顶视、无人机环绕 |
| 灯光 | 5 | 夜视绿、热成像白热、城市钠灯夜景、照明弹、阴天灰 |
| 音频 | 10 | 无人机蜂鸣、海马斯齐射、消音枪声、战术电台、喷气掎过、重型旋翼、导弹发射、巷战环境声、导弹告警、装具声 |
| 特效 | 10 | 热成像 POV、曳光弹、海马斯尾焰、无人机集群、激光指示、消音枪口焰、旋翼扬尘、二次诱爆、烟幕、电子干扰 |

新增载具类型 `drone` 与 `ugv`，并配套专属动作库（悬停/环绕目标/俯冲/终端俯冲/失去信号翻滚、展开传感桂等）。
士兵动作库补充现代战术动作：堆栈破门、交替跃进、无线呼叫空支、夜视搜索、肩扣反坦克、放飞手抛无人机、上止血带等。

### 3. 年代识别同步升级

主题一键生成现在可识别 **Modern / Gulf War / Cold War / WWII / Pacific** 五个系列。输入“特种部队夜视仪突入现代公寓巷战”
会自动锁定 Modern 系列的操作手 + 公寓 CQB 环境 + 夜视 POV 镜头 + 夜视绿灯光，而不会混入二战资产。
同名装备跨年代时会自动选对版本：“现代阿帕奇”→ AH-64E Guardian，“海湾战争阿帕奇”→ AH-64A。


---

## V2.3 混合写实（Hybrid Realism）

从 V2.3 开始，LWU 采用**“硬件是积木，环境和特效是真实”**的混合写实风格：

| 元素 | 表现方式 |
| --- | --- |
| 地形、建筑、载具、人物、武器、道具、碎片 | **乐高积木**，可见颗粒、管柱、合模线，minifigure 统一比例 |
| 雨、雪、雾、云、闪电、沙尘暴 | **真实天气**，真实雨线、雪花、体积雾 |
| 海水、深海、河流、湖泊、水花、泥泞 | **真实流体**，真流体模拟、波纹、泡沫、焦散光 |
| 硝烟、火焰、火花、冲击波、蘑菇云 | **真实爆破特效**，体积光、热浪、余烬 |
| 两者交互 | 湿满反光的塑料表面、积雪落在颗粒上、烟雾缠绕模型 |

新增资产：天气/自然/战场特效 12 项（FX-501~512）、水域与恶劣天气环境 8 项（ENV-501~508）、环境音效 4 项（AUD-501~504）。资产总数 **229**（schema v3.2）。


### AI 增强后端（可选）

`06_Deploy/` 里附带了即插即用的 Cloudflare Worker（`worker.js` + `wrangler.toml`），支持 Gemini 与任意 OpenAI 兼容接口。

```bash
cd 06_Deploy
wrangler deploy
wrangler secret put GEMINI_API_KEY
```

把得到的地址填进页面的「⚙ AI 增强」即可。AI 只负责选资产和写动作句，提示词仍由 Bible 模板组装，风格不会跑偏；失败自动回退本地匹配。详见 `06_Deploy/README.md`。
