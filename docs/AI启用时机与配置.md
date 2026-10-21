# AI 启用时机与配置（6.8.7 实况）

> 这份文档描述的是**代码里的真实行为**，逐条对得上 `functions/api/ai-brain.js` 与
> `src/domain/ai-brain.js`。如果你之前照着 `06_Deploy/README.md` 配过，那份文档
> 描述的是一套**代码里并不存在**的系统（详见文末「常见坑」）。

---

## 零、5 秒自查：AI 到底配上了没（6.8.4 新增）

**不要再靠猜。** 直接打开这个地址（把域名换成你自己的）：

```
https://你的站点/api/ai-brain?probe=1
```

它返回一份只读报告，**不会发起任何外部请求、不消耗任何额度、也不返回密钥本身**：

```jsonc
{
  "aiAvailable": false,          // ← 一句话结论：后台现在用不了云端 AI
  "configuredCount": 0,          // ← 配了几个 Key（0 = 一个都没配）
  "providers": [
    { "id": "groq", "envVar": "GROQ_API_KEY", "configured": false, "keyHint": null },
    { "id": "openrouter", "envVar": "OPENROUTER_API_KEY", "configured": false, "keyHint": null },
    { "id": "gemini", "envVar": "GEMINI_API_KEY", "configured": false, "keyHint": null }
  ],
  "diagnosis": "后台没有配置任何模型 Key……",
  "howToFix": ["Cloudflare 控制台 → ……", "……"]
}
```

配好之后，`configured` 会变成 `true`，并给出**掩码**（例如 `••••1234（长度 56）`）——
后四位足够你确认「这是我刚配的那把」，又不构成泄露。

**如果 `configured: true` 但页面还是显示本地引擎**，说明 Key 配上了但调用失败。
这时点一次「深度转译」，响应里的 `aiStatus.providers[].error` 会给出**真实的 HTTP 状态码**，
旁边的 `advice` 字段则直接告诉你**下一步怎么办**：

| error | 含义 | advice 会怎么说 |
| --- | --- | --- |
| `Groq HTTP 401` | Key 无效 / 未授权 | 到控制台重新生成并完整复制，更新 `GROQ_API_KEY` 后重新部署 |
| `Groq HTTP 403` | **Key 被拒绝**（无效 / 已撤销 / 账户受限 / 地区不支持） | 到控制台确认 Key 状态，或换一把新 Key |
| `Groq HTTP 404` | **模型名已退役** | 用环境变量 `GROQ_MODEL` 指定一个当前可用的模型名（不用改代码） |
| `Groq HTTP 429` | 额度用尽 / 触发限流 | 换一个 provider，或等额度重置 |
| `NOT_CONFIGURED` | 这个 provider 压根没配 | 见 `howToFix` |

**页面上也能看出来**：顶部「本次引擎」徽章现在**只在云端 AI 真正生效时才是绿色**；
回退本地时是**黄色**，并直接写出原因（例如「后台未配置任何模型 Key」）。
**如果你确实配了 Key 但调用失败，还会额外弹一条提示，写明具体是哪一步出了问题。**

> **真实案例（6.8.5 实测）**：某次线上自检显示 `configuredCount: 2`（Groq + Gemini 都配了），
> 但 `POST` 返回 `ALL_PROVIDERS_FAILED`：
> `groq → Groq HTTP 403`（Key 被 Groq 拒绝）、`gemini → Gemini HTTP 404`（模型名退役）。
> **两个 Key 都在，两个都失败了 —— 而在 6.8.4 之前，这个真相在界面上完全看不见。**
>
> **下一个案例（6.8.6/6.8.7 实测）**：模型名修好之后云端 AI 真的通了，
> 但 `gemini-3.8-flash` 两次采样都返回 **HTTP 503**（上游过载，从未成功）。
> 这仍然不是本项目能修的 —— 它只是让「换下一个候选」这个机制每天都在起作用。

---

## 零点五、模型名会腐烂：怎么换模型（6.8.5 新增）

**这是一个必须知道的永久性事实：模型名会下线。** 硬编码一个模型名 = 一次退役就永久失效。

真实例子：代码里曾硬编码 `gemini-1.5-flash`。按 Google 官方退役表，
1.5 系列早已退役（表里连条目都没有），连 2.0 系列也已在 **2026-06-01 关停**。
于是 Gemini 这条路**长期静默 404** —— 而失败只写进 `console.warn`，
徽章又无条件显示绿色，**没有任何人知道它坏了**。

**第二个例子（6.9.5，更隐蔽）**：Groq 的 `llama-3.3-70b-versatile`
公告 2026-06-17、**2026-08-16 关停**（免费/开发者档；企业合同客户除外，
所以 Groq 模型文档页至今还挂着它、标 Enterprise）。我们代码里的候选
从那天起就是死的，请求返回 `404 model_not_found`。但它**藏了两个月**：
因为这条路的 Key 长期是坏的（403），「Key 被拒」叠在「模型已死」前面，
整条路从没成功过一次，于是没人往下看。直到用户换了一把有效 Key，
才在 Groq 控制台日志里看到 404。**教训：「从没成功过的链路」会把下一层
故障藏得严严实实 —— 第一层修好之前，你永远不知道第二层已经坏了。**
现已换成 Groq 官方首选替代 `openai/gpt-oss-120b`（备选 `openai/gpt-oss-20b`，
均 Production 档、支持 JSON Object Mode、免费档 30 RPM / 1K RPD）。

**现在的做法：候选列表 + 环境变量覆盖。**

| 环境变量 | 作用 | 默认候选 |
| --- | --- | --- |
| `GROQ_MODEL` | 覆盖 Groq 模型名 | `openai/gpt-oss-120b` → `openai/gpt-oss-20b`（6.9.5 起，原 `llama-3.3-70b-versatile` 已退役） |
| `OPENROUTER_MODEL` | 覆盖 OpenRouter 模型名 | 4 个免费档候选（6.9.3 基准裁出，见「一」节表格） |
| `GEMINI_MODEL` | 覆盖 Gemini 模型名 | `gemini-2.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.8-flash` |

- 不配这些变量时，会用**内置候选列表**逐个尝试 —— 第一个 404 就自动换下一个，
  **单个模型退役不会让整条路哑掉**。
- 要指定模型，用**逗号 / 分号 / 空格**分隔可以写多个，按顺序尝试：

  ```
  GEMINI_MODEL=gemini-2.5-flash,gemini-3.5-flash-lite
  ```

- **换模型不需要改代码**，改环境变量 + 重新部署即可。
- ⚠️ 环境变量覆盖**只给模型名**。`response_format`（JSON 模式）是否发送由内置条目决定，
  覆盖时沿用该 provider 的默认 —— 不允许「换个模型名」这个动作静默改变请求语义。
- **6.9.6 起多一层保险**：OpenRouter 候选在每次真正调用前，会先拉一次公开目录
  核对活性，目录里没有的模型直接跳过不调（详见「一」节「运行前的活性检查」）；
  想人工看看现在有哪些免费模型，跑 `node scripts/bench-openrouter.mjs --discover`。

---

## 零点六、为什么慢、要等多久（6.8.6 新增）

**先说结论：云端 AI 很慢，单镜实测 30–59 秒。** 这不是卡死，是真的在生成。

线上实测（2026-10-13，`POST /api/ai-brain`）：

| 请求 | 结果 |
| --- | --- |
| `requestedShots=1` | HTTP 200，**30.69s** |
| `requestedShots=1`（再来一次） | HTTP 200，**58.99s** |
| `requestedShots=4` | 60s / 90s 都没等到（但仍在正常生成） |

**6.8.6 之前这里有个大坑**：代码对 `fetch` **一行超时都没有**，
所以「慢」与「挂死」在行为上**完全一样** —— 请求一直挂着，前端既不报错也不回退，
点完之后页面几十秒不动，看起来就是死机。**现在两层上限 + 可见的等待**：

| 环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `AI_PROVIDER_TIMEOUT_MS` | **单次模型调用**上限（超时即 `abort` 真实断开） | `60000`（60s） |
| `AI_REQUEST_BUDGET_MS` | **整次请求**总预算（超了就不再尝试剩余候选） | `120000`（120s） |

前端另有一个 **100 秒**的等待上限（比后端总预算略长：后端预算耗尽时会返回一份
**带完整诊断的响应**，那才是你最需要的信息；前端上限只是「连接本身死了」的兜底）。
等待期间进度条每 5 秒刷新一次：

```
⏳ 云端 AI 正在生成，已等待 30 秒（最多 100 秒，超时将自动回退本地引擎）…
```

**看到这个倒计时就说明没死机，只是慢。** 超时后会如实回退本地引擎，
徽章写「前端等待超时」，并弹一条提示告诉你下一步怎么办。

### 「哪个模型慢、哪个模型挂了」现在可以直接读

响应里的 `aiStatus.providers[].calls` 是**逐次调用记录**：

```jsonc
"calls": [
  { "model": "gemini-3.8-flash",      "ok": false, "ms": 1835,  "error": "Gemini HTTP 503", "timedOut": false, "skipped": false },
  { "model": "gemini-3.5-flash-lite", "ok": true,  "ms": 41350, "error": null,              "timedOut": false, "skipped": false }
]
```

以上是 6.8.6 上线后的一次**真实采样**（2026-10-14）。它当场回答了两个此前答不了的问题：

- **`gemini-3.8-flash` 是 HTTP 503**（上游过载），不是 429 也不是 404 —— 而且失败得很快（1.8s）；
- 另一次采样里 `gemini-3.5-flash-lite` 返回的也是 503，**却耗了 40.5 秒**。
  所以「几十秒没反应」不只是「成功得慢」，也包括「连『我不可用」都要想 40 秒才说出口」。

- `ms` = 这一次真实花了多久；`timedOut` = 是不是超时（与 404/403 区分开）；
- `skipped` = 因为总预算耗尽**没有尝试**（而不是试了没成）；
- `aiStatus.timedOut` / `aiStatus.timedOutCalls` / `aiStatus.budgetExhausted` 是汇总。

**为什么要这个**：6.8.5 的 `attemptedModels` 只记名字，三个模型试完只留最后一条 `error`，
于是「为什么失败、花了多久」根本读不出来，只能拿总耗时去反推 —— 而反推是会出错的
（6.8.4 就是拿 `latencyMs: 193` 反推出「后台一个 Key 都没配」，被自检当场证伪）。

---

## 一、什么时候会走云端 AI（真实路由）

| 入口 | 走哪条路 |
| --- | --- |
| 影院模式「🎬 深度转译」 | 先 `POST /api/ai-brain`；成功 → 云端 AI；失败或未配 Key → 本地引擎 |
| 自由模式「⚡ 自由战术分镜策划」 | **从不调 AI**，纯本地 `planVariants`（确定性、毫秒级） |
| 角色定妆表 / 编译 Prompt / 导出 CSV | 纯本地 |

**关键：前端没有「启用 AI」开关。** 用不用 AI，完全由「后台有没有配 Key」决定 ——
配了就走 AI，没配就走本地，用户无从选择，也没有开关可点。

### 后台的 provider 顺序（`functions/api/ai-brain.js`）

按顺序尝试，**只要一个成功就停**：

| 顺序 | 环境变量 | 模型（候选列表，逐个尝试） |
| --- | --- | --- |
| 1 | `GROQ_API_KEY` | `openai/gpt-oss-120b` → `openai/gpt-oss-20b`（6.9.5 起） |
| 2 | `OPENROUTER_API_KEY` | 4 个免费档候选（见下，6.9.3 基准裁出） |
| 3 | `GEMINI_API_KEY` | `gemini-2.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.8-flash` |

> **Gemini 的顺序是 6.8.7 按实测重排的**：两次真实采样里 `gemini-3.8-flash`
> 两次都返回 **HTTP 503（从未成功）**，因此从首位挪到末位 —— 它失败虽快（约 1.8s），
> 但没必要每次请求都拿它开头赌。样本只有两次，判断方向明确但证据量不足。

每个 provider 内部还会**按候选模型列表逐个尝试**（6.8.5 起），
单个模型退役 / 限流只会让它换下一个，不会让整条路哑掉。

三个都没有 / 三个都失败 → 自动回退本地引擎，**不报错**，
但响应体里的 `aiStatus` 会如实说明原因（6.8.4 起），徽章也会用**黄色**而非绿色显示。

### OpenRouter 免费档候选（6.8.7 建 · 6.9.3 实测裁剪）

来源：实拉 OpenRouter 公开模型接口 `GET /api/v1/models`（**不需要 Key**）。
2026-10-14 共 **462 个模型**，其中 `:free` 后缀 **14 个**、纯文本输出 **14 个**。

按用途排除掉 4 类不适合做「分镜剧本生成」的：
coding agent（`poolside/laguna-*`、cohere/north-mini-code`）、
内容安全分类器（`nvidia/nemotron-3.5-content-safety` —— 它是判别器不是生成器）、
多模态感知（`nvidia/nemotron-3-nano-omni`）。剩下的先按参数量排了个**先验顺序**占位，
然后 6.9.3 用端到端基准裁军。

**6.9.3 基准实测（2026-10-19，8 候选 × 4 题材，走生产同一条 `onRequest` 链路，
每个候选前重置熔断防测量污染）：**

| 候选模型 | 可用率 | 平均耗时 | 润色过守卫 | 结论 |
| --- | --- | --- | --- | --- |
| `liquid/lfm-2.5-2.6b:free` | **4/4** | 12.3s | 16/16 镜 | ✅ 保留 · 队首（最快最稳） |
| `nvidia/nemotron-3-super-120b-a12b:free` | **4/4** | 41.5s | 16/16 镜 | ✅ 保留 |
| `dots-studio/dots-3-note-preview:free` | **4/4** | 44.7s | 16/16 镜 | ✅ 保留 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 2/4 | 21.0s | 8/8 镜 | ✅ 保留 · 队尾兜底（两次 90s 超时未测到，快但抖） |
| `google/gemma-4-31b-it:free` | 0/3 | — | — | ❌ 出局 · 三次 HTTP 429（免费配额） |
| `thinkingmachines/inkling:free` | 0/3 | — | — | ❌ 出局 · 三次 HTTP 403 |
| `google/gemma-4-26b-a4b-it:free` | 0/3 | — | — | ❌ 出局 · 三次 HTTP 429（免费配额） |
| `nvidia/nemotron-3.5-lightning:free` | 0/3 | — | — | ❌ 出局 · 三次 90s 超时未读完响应体（本就超生产 60s 单次上限） |

**「JSON 模式」这一列是逐个模型从接口的 `supported_parameters` 读出来的实测事实，不是猜的。**
它很重要：`response_format: {type:'json_object'}` 能大幅提高模型吐出合法 JSON 的概率，
但**对不支持的模型发这个参数，上游直接 4xx** —— 而 OpenRouter 免费档里支持与不支持的模型
混在同一家，所以 6.8.7 起它从「provider 级」下沉为「模型级」，未显式声明的才沿用 provider 默认。
（队尾的 ultra-550b 是保留名单里唯一声明 `false` 的。）

> ⚠️ **这是「本次实测」，不是定论** —— 模型会腐烂，429 疑为账号级免费配额而非模型本身，
> 出局可逆：重跑基准即可重新入列。当前顺序 = 「可用率 → 过守卫镜数 → 速度」。

想自己跑基准测试（**需要你自己的 OpenRouter Key，脚本不会把它写到任何文件里**）：

```bash
cd 项目根目录
OR_KEY=sk-or-v1-你的Key node scripts/bench-openrouter.mjs
```

它直接驱动生产代码路径（`onRequest` 端到端），候选名单从 `PROVIDERS` 直读
（名单改了基准自动跟上），可用 `--themes/--shots/--timeout` 调节。
评分口径用的是**本项目自己的判定标准**，而不是通用跑分：

| 指标 | 含义 |
| --- | --- |
| 可用率（isAiGenerated） | 云端润色这一跳到底进没进（本地基底兜底不算） |
| `aiStatus.reason` | OK / ALL_PROVIDERS_FAILED / POLISH_REJECTED / CIRCUIT_OPEN… |
| 润色过守卫镜数 | HTTP 200 但整段被 mergePolish 拒绝 = 对本项目不可用，与网络通不通无关 |
| 时长档位散度 | 模型若让 fitDuration 把档位全拱成 8s，节奏同样死了（6.9.2 同型回归） |
| 单次耗时 | 这个模型到底有多慢（对生产 60s 单次上限负不负责任） |

**一个好模型的标志是让本地基底少被拒绝、让节奏档位活下来。**

#### 运行前的活性检查（6.9.6）：不再调「已经死了的模型」

6.9.5 的教训：`llama-3.3-70b-versatile` 死了两个月没人知道——**调用方只在真正
发请求时才发现模型没了**（404 `model_not_found`），而失败要等跑完一轮才看得见。
OpenRouter 的目录接口 `GET /api/v1/models` 是**公开、免 Key、不耗额度**的，
于是每次请求在真正调用前，会先花一次目录请求核对候选名单：

| 情况 | 行为 |
| --- | --- |
| 目录里还有这个模型 | 正常调用 |
| 目录里没有（已下线/改名） | **跳过不调**，记进 `aiStatus.providers[].liveCheck.dropped` |
| 目录请求失败（网络抖动） | 不折腾，按静态名单照常调（活性检查是优化，不是新的单点） |
| 全部候选都不在目录里 | 整体退回静态名单试一次（防目录瞬时抖动把本次请求变成「无 AI」） |

目录结果带 TTL 缓存（默认 5 分钟，`AI_MODEL_LIST_TTL_MS` 可调），
一次请求只查一次；`AI_MODEL_LIST_CHECK=off` 可整个关停（熔断判定之后才查——
注定被跳过的 provider 不浪费目录请求）。**本地基底永远在手**，活性检查再慢
也只是润色这一跳的事。

**人工评估入口**——想看现在 OpenRouter 上有哪些免费模型、哪些在名单外：

```bash
node scripts/bench-openrouter.mjs --discover    # 不需要 Key，拉公开目录
```

它列出全部 `:free` 模型（上下文长度 + 简介），并标注「名单内 / 名单外」。
名单外的好苗子加进 `functions/api/ai-brain.js` 的 `PROVIDERS.openrouter.models`，
再跑一次基准（不带 `--discover`）即可入列。

### 怎么判断「这一次到底用的是不是 AI」

看返回里的 `engine` 字段 —— 页面顶部那个「本次引擎」小标签就是它
（**6.8.4 起还会用颜色区分**：绿色 = 云端 AI 真的生效，黄色 = 走的本地引擎）：

| `engine` 文案 | 含义 |
| --- | --- |
| `Cloud Free AI (Groq (openai/gpt-oss-120b))` | ✅ 云端 AI 生效 |
| `本地自主想象引擎 · 离线生成（非云端 AI）` | 本地按题材原创（未配 Key 或接口不可达） |
| `策展致敬库 · 离线复刻（手写分镜，非 AI 生成）` | 命中 9 部策展影片，交付手写复刻 |
| `策展致敬库 · 离线复刻… · 生成引擎不可用，已退回通用军事分镜` | 极端兜底 |

---

## 二、什么时候**该**用 AI（设计判断，不是配置）

AI 值得用的，是**本地规则引擎天生做不好**的那三类：

| 场景 | 例子 | 为什么本地不行 |
| --- | --- | --- |
| 抽象 / 叙事型主题 | 「一个老兵在废墟里回忆战友」 | 关键词太少，匹配不到东西 |
| 风格迁移 | 「像《黑鹰坠落》那种感觉」 | 本地没有「风格」这个维度 |
| 需要原创立意 | logline / twist / hook | 本地是模板 + 节拍池，不产出立意 |

反过来，**这几种情况用 AI 是浪费**：

- **明确的历史战役 / 装备题材**（「二战诺曼底登陆抢滩」「海湾战争防空阵地」）——
  本地有 810 项真实资产 + 时代门控，选型确定、毫秒级、还免费。
- **已经点名了 9 部策展影片**——手写复刻本来就比模型稳，AI 反而可能跑偏。
- **需要可复现**——本地是确定性的（同一输入必得同一输出）；AI 带 `temperature: 0.7`，
  同一输入两次结果不同。

### 一条容易被忽略的边界

**AI 只负责「选资产 + 写动作句 + 声明戏剧功能」。**
最终交付的 Prompt 仍然由本地编译器按 Production Bible 模板组装 ——
风格块、混合写实规则、negative、角色一致性描述**不会被 AI 改写**。
所以「用 AI」不会让风格漂移，这是刻意的设计。

### 成本

一次调用约 3–5k input token + 200–800 output token。三个 provider 都有免费层，
个人使用基本在额度内。

---

## 三、怎么配置

### 生产环境（Cloudflare Pages，推荐）

1. Cloudflare 控制台 → 你的 Pages 项目 → **Settings → Environment variables → Production**
2. 添加上表里的 Key，**类型必须选 `Secret`（加密）**，不要选 Text
3. 可选变量：

   | 变量 | 说明 |
   | --- | --- |
   | `ALLOWED_ORIGIN` | 跨域白名单，必须精确匹配；留空则只允许同源 |
   | `ENVIRONMENT` | 设 `production` 激活安全检查 |
   | `AUTH_MODE` | 设 `access` 强制要求 Cloudflare Access 身份标头 |

4. **点一次 Redeploy / 重新部署** —— 环境变量的改动**必须重新部署才生效**，
   这是最容易踩的坑
5. 验证：页面上输入任意题材 → 点「深度转译」→ 看顶部「本次引擎」标签
   是否变成 `Cloud Free AI (…)`

#### OpenRouter 配了却看不到？三要素逐个核对（真实踩坑记录）

线上 probe 显示 `openrouter.configured=false`，而 Key 直连官方接口明明是有效的
——问题从来不在 Key，在 Cloudflare 侧的**三个细节**（按踩坑频率排序）：

1. **变量名精确为 `OPENROUTER_API_KEY`** —— 大小写、下划线、首尾无空格，
   差一个字符运行时就读不到（代码就是读这个精确名字）
2. **保存环境选 `Production`** —— 填到 Preview 环境的话生产部署看不到
3. **保存后再点一次 Redeploy** —— 不重新部署，运行时环境里就是没有这个变量

自检方法（不需要登录任何后台）：

```bash
curl -s "https://你的域名/api/ai-brain?probe=1"
```

返回里每个 provider 都有 `configured` 字段——**这里显示 false，就是变量没进
运行时**，回去按上面三条核对；显示 true 才会在请求时真正被调用。

### 本地开发（想用 AI 必须这样起）

README 里写的 `python -m http.server 8080` 或 `npx serve .` **只提供静态文件，
没有 Functions** —— 所以本地这么起**永远走本地引擎**，配了 Key 也不会用上。

要在本地用 AI：

```bash
npx wrangler pages dev . --port 8080
```

然后在**仓库根目录**建 `.dev.vars`（Cloudflare 的本地环境变量约定）：

```
GROQ_API_KEY=gsk_...
```

> **为什么不是 `.env`**：代码里**没有任何 dotenv 加载**（`grep dotenv` 为空），
> `.env` 根本不会被读取。`.env.example` 早先写的「本地开发时配置到 .env 中」
> 是错的，6.8.3 已更正。

---

## 四、常见坑（都是真实踩过的）

1. **`06_Deploy/README.md` 描述的是一套不存在的系统。** 它说 AI 端点是
   `/api/compose`、有 10 个 provider、支持 `MODELS` / `ROTATE` / `TIMEOUT_MS`、
   网页里有「启用 AI 增强」勾选框 —— 这些在代码里**全都没有**。
   真实的 AI 端点是 `/api/ai-brain`，只有 3 个 provider，前端也没有开关。
   （`functions/api/compose.js` 是**纯本地**端点，一个 Key 都不读。）
2. **改了环境变量不 Redeploy → 不生效。** 这是最高频的「配了但没用」。
3. **`.dev.vars` 必须进 `.gitignore`。** 6.8.3 之前它**没有被忽略** ——
   按标准流程建 `.dev.vars` 填真 Key，会被 git 提交上去，密钥直接泄露。已修。
4. **`/api/ai-brain` 只接受 POST**（`GET` 会返回 `405 METHOD_NOT_ALLOWED`）——
   这不是故障。**唯一例外是只读自检 `GET /api/ai-brain?probe=1`**（6.8.4 起），
   其余任何不带 `probe` 的 GET 仍然 405。
5. **限流是 60 秒滑动窗口内 30 次 / IP**，超出返回 `429 RATE_LIMITED`。
6. **没配 Key 不是故障。** 系统会如实标注「离线生成（非云端 AI）」，
   功能完整、不联网、不花钱。
7. **云端 AI 很慢（单镜 30–59 秒），这是正常的。** 看到进度条上的
   「已等待 N 秒」倒计时就说明没死机。超时（默认前端 100s / 后端单次 60s）
   会自动回退本地引擎，并用黄色徽章说明原因。
   **6.9.4 实测分解（生产，1 镜，两次采样）**：curl 总耗时 31–34s 里，
   后端自报 17.9s（其中模型调用 17.87s，groq 快速失败 13ms），
   **本项目代码路径（本地基底生成 + 治理 + 组装 prompt）只花约 15ms**；
   其余约 13.5s 在 Cloudflare 边缘与网络侧（同期 GET probe 的 TTFB
   在 1.1–3.6s 抖动，另出现一次 60s 完全连不上 —— 属测量环境网络波动，
   按纪律记为「检验过程失败」，不计入站点行为）。**结论：瓶颈在上游
   模型排队与网络边缘，不在 prompt 体积**（整份 prompt ≈3000 token，
   精简假设经实测不成立，不要再朝这个方向优化）。
8. **模型名会腐烂。** 硬编码的模型名迟早 404，**换模型请用环境变量**
   （`GROQ_MODEL` / `OPENROUTER_MODEL` / `GEMINI_MODEL`），不要改代码。
   两个真实案例：① `gemini-1.5-flash` 退役后 Gemini 这条路长期静默 404，
   而失败只写进 `console.warn`、徽章又无条件显示绿色 —— **没有任何人知道它坏了**；
   ② 6.9.5 实测 Groq 的 `llama-3.3-70b-versatile`（2026-08-16 关停，免费/开发者档）
   已死了两个月——因为这条路的 Key 长期 403，**403 叠在 404 前面**，
   「从没成功过的链路」会把下一层故障藏得严严实实。6.9.6 起 OpenRouter
   候选在每次调用前先过一遍公开目录（见「一、OpenRouter 免费档候选」），
   死模型不再被调。
9. **Groq 403 ≠ Key 无效。** 按 Groq 官方错误码文档，403 是**权限限制**
   （账户受限 / 地区不支持 / 该账户没有这个模型的访问权限），
   **401 才是凭据无效**。徽章上的 advice 会按这个语义给出排查方向。

---

## 五、一句话总结

- **想用 AI**：配 Key（`GROQ_API_KEY` 优先）+ **Redeploy**。
- **不想用 AI**：什么都不用做。
- **想知道有没有在用**：看页面顶部的「本次引擎」标签（**绿=云端，黄=本地**），
  徽章上还会带上真实耗时（例如 `· 59.0s`）。
- **想知道为什么没在用**：打开 `/api/ai-brain?probe=1`（看「配了没」），
  再点一次「深度转译」看响应里的 `aiStatus.providers[].calls`（看「哪一步失败、花了多久」）。
- **嫌慢**：调 `AI_PROVIDER_TIMEOUT_MS` / `AI_REQUEST_BUDGET_MS`，或用 `GEMINI_MODEL`
  指定一个更快的模型 —— 都不需要改代码。
