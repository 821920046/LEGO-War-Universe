# 06_Deploy — AI 增强后端部署指南

前端（`index.html`）默认使用**本地智能匹配**：免费、离线、零配置，一键生成提示词。
本目录提供可选的 **AI 增强后端**，部署后由大模型理解主题并挑选资产，处理抽象 / 比喻 / 叙事型主题时明显更准。

> **重要变化（推荐做法）**：AI 后端现在已内置为 **Cloudflare Pages Function**（`functions/api/compose.js`）。
> 前端**不再需要填写任何 Worker 地址或密钥**——页面直接调用同源的 `/api/compose`。
> 所有配置都放在 **Pages 项目的环境变量**里。这样密钥不出现在前端，也不用单独再部署一个 Worker。

## 两者区别

| | 本地匹配（默认） | AI 增强（可选） |
| --- | --- | --- |
| 成本 | 免费 | 按模型 Token 计费 |
| 延迟 | 瞬时 | 1~3 秒 |
| “阿帕奇夜袭坦克纵队” | ✅ 准确 | ✅ 准确 |
| “一个老兵在废墟里回忆战友” | ⚠ 关键词少，匹配一般 | ✅ 理解情绪与叙事，选得好 |
| “像《黑鹰坠落》那种感觉” | ❌ 匹配不到 | ✅ 能迁移风格 |
| 断网 / 后端挂了 | — | 自动回退到本地匹配 |

**设计原则**：AI 只负责“选资产 + 写动作句”，最终提示词仍由前端用 Production Bible 模板组装。
这样风格块、混合写实规则、negative、角色一致性描述都不会被 AI 随意改写——**风格永远统一**。

---

## 一、推荐方案：Cloudflare Pages Function（前端零配置）

因为 `functions/api/compose.js` 和 `index.html` 在同一个 Pages 项目里，Cloudflare 会自动把它挂到
`/api/compose` 这个同源地址上。前端写死了调用这个相对路径，所以**页面上不需要填任何东西**。

### 1. 拿 API Key
- **Gemini（推荐，有免费额度）**：Google AI Studio → Get API key
- **OpenAI 或任意兼容中转**：拿到 `sk-...` 和对应 base url

### 2. 部署整个项目到 Pages
把本项目按之前说的方式部署到 Cloudflare Pages（Git 连接或直接上传，`index.html` 在仓库根目录）。
只要 `functions/` 目录跟着一起上传，Pages 就会自动识别并部署这个后端函数——**不需要单独 `wrangler deploy`**。

### 3. 在 Pages 项目里配置环境变量
进入 **Cloudflare 控制台 → 你的 Pages 项目 → Settings → Environment variables → Production**，添加：

| 变量名 | 类型 | 说明 |
| --- | --- | --- |
| `GEMINI_API_KEY` | **Secret** | 默认用 Gemini 时必填，就是你的模型密钥 |
| `PROVIDER` | Text | 可选，默认 `gemini`；要用 OpenAI 就填 `openai` |
| `MODEL` | Text | 可选，如 `gemini-2.0-flash` / `gpt-4o-mini` |
| `OPENAI_API_KEY` | Secret | 仅当 `PROVIDER=openai` 时填 |
| `OPENAI_BASE_URL` | Text | 仅用第三方中转时填，如 `https://your-relay.com/v1` |
| `ACCESS_TOKEN` | Secret | 可选。设了之后，调用必须带 `Authorization: Bearer <token>`，用来防止别人白嫖 |

> 密钥务必选 **Secret（加密）** 类型，不要选 Text。

### 4. 重新部署 + 自检
改完环境变量后，在 Pages 里点一次 **Retry deployment / 重新部署**让变量生效。
然后浏览器打开 `你的域名/api/compose`，应返回：

```json
{ "ok": true, "service": "LWU AI Compose (Pages Function)", "provider": "gemini" }
```

看到这个就说明后端已就绪。

### 5. 在页面里启用
打开网站 → 展开「⚙ AI 增强」→ 勾选**启用 AI 增强**即可。
**不需要填地址，也不需要填密钥。**之后点「🎬 一键生成提示词」就走 AI 路径，失败自动回退本地匹配。

> 关于 `ACCESS_TOKEN`：用 Pages Function（同源）时，一般靠 Cloudflare Access 或不公开域名来防滥用即可，
> 通常无需设置 `ACCESS_TOKEN`。若你确实设置了它，则需要另行改造前端携带该口令（默认前端不带）。

---

## 二、备选方案：独立 Cloudflare Worker

如果你更想把 AI 后端和网站分开部署，仓库里仍保留了 `worker.js` + `wrangler.toml`：

```bash
npm i -g wrangler
wrangler login
cd 06_Deploy
wrangler deploy
wrangler secret put GEMINI_API_KEY
wrangler secret put ACCESS_TOKEN   # 可选口令
```

部署后得到 `https://lwu-ai.你的子域.workers.dev`。
注意：**当前前端已改为固定调用同源 `/api/compose`**，若要用这个独立 Worker，需要自行把前端
`aiCompose()` 里的 `fetch("/api/compose", …)` 改成你的 Worker 地址。推荐直接用上面的 Pages Function 方案，省事。

---

## 三、接口约定

**请求** `POST /api/compose`

```json
{
  "theme": "特种部队在暴雨夜突入公寓",
  "assets": [{ "id": "CHR-401", "name": "Special Forces Operator", "series": "Modern", "faction": "US" }]
}
```

**响应**

```json
{
  "selectedIds": ["CHR-401", "ENV-410", "CAM-403", "LGT-401", "FX-501", "AUD-501"],
  "action": "a four-man team stacks on the door and breaches into the apartment",
  "reason": "modern urban CQB in heavy rain"
}
```

也允许直接返回成品提示词（不推荐，会绕过 Bible 模板）：`{"prompt":"...","promptZh":"..."}`

**后端内置的安全网**
- 模型返回的 ID 会与请求中的资产表校对，**幻觉出来的 ID 直接丢弃**
- 一个合法 ID 都没有 → 返回 502 → 前端回退本地匹配
- 前端 20 秒超时中断，不会卡死
- 系统提示词内置年代门控与“硬件积木 / 天气写实”铁律

---

## 四、成本与额度

一次调用约 3~5k input token（234 条资产索引）+ 200 output token。
用 `gemini-2.0-flash` 基本在免费额度内；正式付费也是千次调用量级的几毛钱。
Cloudflare Pages Functions 免费版每天有充足的调用额度，个人使用远远够用。

---

## 五、不想用 AI？

什么都不用做。不勾选启用开关，页面就完全跑在本地匹配上，功能完整、不联网、不花钱。

---

# 多大模型配置（V3.1）

> 推荐部署方式仍为 **Cloudflare Pages + `functions/api/compose.js`**（无需单独建 Worker，无需在网页里填地址）。
> 本目录下的 `worker.js` 是早期独立 Worker 方案，保留作备选，**不含多模型轮询**。

## 一、最简单的做法：有几个 Key 就填几个

在 **Pages 项目 → Settings → Environment variables** 里，把你手上有的 Key 都添上（类型选 **Secret**），然后 **Redeploy**：

```
GEMINI_API_KEY      = AIza...
DEEPSEEK_API_KEY    = sk-...
QWEN_API_KEY        = sk-...
```

系统会自动组成模型链，按下面的默认优先级排序；哪个挂了就自动用下一个，而且每次请求轮流从不同起点开始（轮询）。

| 优先级 | provider | Key 环境变量 | 默认模型 |
|---|---|---|---|
| 1 | `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` |
| 2 | `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| 3 | `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| 4 | `qwen` | `QWEN_API_KEY` | `qwen-plus` |
| 5 | `zhipu` | `ZHIPU_API_KEY` | `glm-4-flash` |
| 6 | `moonshot` | `MOONSHOT_API_KEY` | `moonshot-v1-8k` |
| 7 | `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| 8 | `siliconflow` | `SILICONFLOW_API_KEY` | `Qwen/Qwen2.5-72B-Instruct` |
| 9 | `openrouter` | `OPENROUTER_API_KEY` | `google/gemini-2.0-flash-001` |
| 10 | `custom` | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` + `CUSTOM_MODEL` | — |

## 二、想自己定顺序：用 `MODELS`

```
MODELS = gemini:gemini-2.0-flash, deepseek:deepseek-chat, gemini:gemini-1.5-flash, openai:gpt-4o-mini
```

- 逗号、分号、换行都可以当分隔符。
- 写法是 `provider` 或 `provider:模型名`；不写模型名就用上表默认值。
- **同一厂商可以出现多次**，用来做“贵模型挂了就降级到便宜模型”。
- 设了 `MODELS` 就不再自动发现，完全听你的。链里缺 Key 的项会被自动跳过并在自检接口里告诉你原因。

## 三、微调项

| 变量 | 作用 |
|---|---|
| `<PROVIDER>_MODEL` | 覆盖某厂商模型名，如 `DEEPSEEK_MODEL=deepseek-reasoner` |
| `<PROVIDER>_BASE_URL` | 覆盖接口地址（走代理/中转），如 `OPENAI_BASE_URL=https://你的代理/v1` |
| `TIMEOUT_MS` | 单个模型超时毫秒，默认 `45000`，超时即切下一个 |
| `ROTATE` | 设为 `off` 则关闭轮询，永远从第一个开始（严格优先级） |
| `ACCESS_TOKEN` | 设了之后调用必须带 `Authorization: Bearer <token>` |
| `PROVIDER` / `MODEL` | 旧版单模型配置，仍支持，会被放在链最前面 |

## 四、自检

浏览器访问 `https://你的域名/api/compose`（GET），应该返回：

```json
{
  "ok": true,
  "version": "3.1",
  "modelCount": 3,
  "chain": ["gemini:gemini-2.0-flash", "deepseek:deepseek-chat", "qwen:qwen-plus"],
  "skipped": [{ "provider": "openai", "reason": "missing OPENAI_API_KEY" }],
  "rotation": "round-robin",
  "timeoutMs": 45000
}
```

- `ok:false` / `modelCount:0` → 一个 Key 都没生效，检查变量名拼写并**重新 Redeploy**（添加环境变量后必须重部署才生效）。
- `skipped` 里会直接写明每个被跳过的厂商缺什么。
- 正常生成时，网页结果区会显示本次实际用的模型名，以及跳过了几个失败模型。
