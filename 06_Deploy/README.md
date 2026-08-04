# 06_Deploy — AI 增强后端部署指南

前端（`index.html`）默认使用**本地智能匹配**：免费、离线、零配置，一键生成提示词。
本目录提供可选的 **AI 增强后端**，部署后由大模型理解主题并挑选资产，处理抽象 / 比喻 / 叙事型主题时明显更准。

## 两者区别

| | 本地匹配（默认） | AI 增强（可选） |
| --- | --- | --- |
| 成本 | 免费 | 按模型 Token 计费 |
| 延迟 | 瞬时 | 1~3 秒 |
| “阿帕奇夜袭坦克纵队” | ✅ 准确 | ✅ 准确 |
| “一个老兵在废墟里回忆战友” | ⚠－ 关键词少，匹配一般 | ✅ 理解情绪与叙事，选得好 |
| “像《黑鹰坠落》那种感觉” | ❌ 匹配不到 | ✅ 能迁移风格 |
| 断网 / 后端挂了 | — | 自动回退到本地匹配 |

**设计原则**：AI 只负责“选资产 + 写动作句”，最终提示词仍由前端用 Production Bible 模板组装。
这样风格块、混合写实规则、negative、角色一致性描述都不会被 AI 随意改写——**风格永远统一**。

---

## 一、部署（约 3 分钟）

### 1. 拿 API Key
- **Gemini（推荐，有免费额度）**：Google AI Studio → Get API key
- **OpenAI 或任意兼容中转**：拿到 `sk-...` 和对应 base url

### 2. 部署 Worker

```bash
npm i -g wrangler
wrangler login

cd 06_Deploy
wrangler deploy

# 写入密钥（不会出现在代码里）
wrangler secret put GEMINI_API_KEY

# 可选：给接口加一道口令，防止别人白嫖你的额度
wrangler secret put ACCESS_TOKEN
```

部署完会得到地址，形如：`https://lwu-ai.你的子域.workers.dev`

验证是否活着：浏览器直接打开该地址，应返回 `{"ok":true,"service":"LWU AI Compose","provider":"gemini"}`

### 3. 在页面里启用

打开你部署好的 Composer 页面 → 展开「⚙ AI 增强」：
1. 勾选**启用 AI 增强**
2. **Endpoint** 填 Worker 地址
3. **API Key** 只在你设了 `ACCESS_TOKEN` 时才需要填（填同一个值）

配置存在浏览器 localStorage，下次打开自动恢复。之后点「一键生成提示词」就走 AI 路径，失败自动回退。

> ⚠️ **千万不要**把 Gemini / OpenAI 的原始 Key 填进页面的 API Key 框。那个框的值会随请求发出去，
> 只能填你自己设的 `ACCESS_TOKEN`。真正的模型密钥只存在 Worker Secret 里。

---

## 二、切换到 OpenAI 兼容接口

改 `wrangler.toml`：

```toml
[vars]
PROVIDER = "openai"
MODEL = "gpt-4o-mini"
# 用第三方中转就打开这行
# OPENAI_BASE_URL = "https://your-relay.com/v1"
```

然后：

```bash
wrangler secret put OPENAI_API_KEY
wrangler deploy
```

---

## 三、接口约定

**请求** `POST /`

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

Cloudflare Workers 免费版：每天 10 万次请求，远超实际需求。

---

## 五、不想用 AI？

什么都不用做。不勾选启用开关，页面就完全跑在本地匹配上，功能完整、不联网、不花钱。
