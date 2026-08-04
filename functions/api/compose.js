/**
 * LEGO War Universe - AI backend (Cloudflare Pages Function)
 * Route: POST /api/compose
 *
 * Modes:
 *   mode omitted / "shot" : pick assets for ONE 8-second shot   -> { selectedIds, action, reason }
 *   mode: "film"          : act as FILM DIRECTOR for a whole film -> { env, clr, weather, shots:[...] }
 *
 * ---------------------------------------------------------------------------
 * V3.1  MULTI-MODEL FAILOVER + ROUND ROBIN
 * ---------------------------------------------------------------------------
 * You can configure MANY models. Every request walks the chain in order and
 * returns the first success; each failure (bad key, quota, 429, 5xx, timeout,
 * malformed JSON) transparently falls through to the NEXT model. The starting
 * position rotates per request, so traffic is spread across models instead of
 * always hammering the first one.
 *
 * Simplest setup: just add the API keys you own. The chain is built for you.
 *   GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, MOONSHOT_API_KEY,
 *   QWEN_API_KEY, ZHIPU_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY,
 *   SILICONFLOW_API_KEY, CUSTOM_API_KEY (+ CUSTOM_BASE_URL, CUSTOM_MODEL)
 *
 * Explicit setup: set MODELS to a comma separated chain. "provider" or
 * "provider:model". Order = failover order.
 *   MODELS = gemini:gemini-2.0-flash, gemini:gemini-1.5-flash, deepseek:deepseek-chat, openai:gpt-4o-mini
 *
 * Per provider overrides:  <PROVIDER>_MODEL , <PROVIDER>_BASE_URL
 *   e.g. DEEPSEEK_MODEL=deepseek-reasoner , OPENAI_BASE_URL=https://my-proxy/v1
 *
 * Other options:
 *   ROTATE       = off   -> always start at the first model (strict priority)
 *   TIMEOUT_MS   = 45000 -> per-model timeout in milliseconds
 *   ACCESS_TOKEN         -> if set, client must send Authorization: Bearer <token>
 *   PROVIDER / MODEL     -> legacy single-model config, still honoured (goes first)
 */

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(obj, status) {
	return new Response(JSON.stringify(obj), {
		status: status || 200,
		headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS),
	});
}

/* ---------------- provider registry ---------------- */

// kind "gemini"  -> Google Generative Language API
// kind "openai"  -> any OpenAI /chat/completions compatible endpoint
const PROVIDERS = {
	gemini: { kind: "gemini", keyVar: "GEMINI_API_KEY", base: "", model: "gemini-2.0-flash" },
	openai: { kind: "openai", keyVar: "OPENAI_API_KEY", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
	deepseek: { kind: "openai", keyVar: "DEEPSEEK_API_KEY", base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
	moonshot: { kind: "openai", keyVar: "MOONSHOT_API_KEY", base: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
	qwen: { kind: "openai", keyVar: "QWEN_API_KEY", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
	zhipu: { kind: "openai", keyVar: "ZHIPU_API_KEY", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
	groq: { kind: "openai", keyVar: "GROQ_API_KEY", base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
	openrouter: { kind: "openai", keyVar: "OPENROUTER_API_KEY", base: "https://openrouter.ai/api/v1", model: "google/gemini-2.0-flash-001" },
	siliconflow: { kind: "openai", keyVar: "SILICONFLOW_API_KEY", base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-72B-Instruct" },
	custom: { kind: "openai", keyVar: "CUSTOM_API_KEY", base: "", model: "" },
};

// default auto-chain order when MODELS is not set
const AUTO_ORDER = [
	"gemini",
	"groq",
	"openrouter",
	"custom",
];

/* Free-tier only chain. Activated with MODELS=free (alias: free-only / 免费).
   Every entry below has a no-cost tier; entries whose key is absent are skipped
   automatically, so you may configure only the ones you have. */
const FREE_CHAIN = [
	// --- Google AI Studio free tier ---
	"gemini:gemini-2.0-flash",
	"gemini:gemini-2.0-flash-lite",
	"gemini:gemini-1.5-flash",
	// --- Groq free tier (fastest) ---
	"groq:llama-3.3-70b-versatile",
	"groq:llama-3.1-8b-instant",
	"groq:gemma2-9b-it",
	// --- OpenRouter :free models (one key, many models) ---
	"openrouter:deepseek/deepseek-chat-v3-0324:free",
	"openrouter:google/gemini-2.0-flash-exp:free",
	"openrouter:meta-llama/llama-3.3-70b-instruct:free",
	"openrouter:qwen/qwen-2.5-72b-instruct:free",
	"openrouter:mistralai/mistral-small-3.2-24b-instruct:free",
];

function upper(name) {
	return String(name).toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function makeEntry(env, providerName, modelOverride) {
	const name = String(providerName || "").trim().toLowerCase();
	const def = PROVIDERS[name];
	if (!def) return { skip: "unknown provider", provider: name, model: modelOverride || "" };
	const U = upper(name);
	const key = env[def.keyVar] || "";
	const base = env[U + "_BASE_URL"] || (name === "openai" ? env.OPENAI_BASE_URL || def.base : def.base);
	const model = String(modelOverride || env[U + "_MODEL"] || def.model || "").trim();
	if (!key) return { skip: "missing " + def.keyVar, provider: name, model: model };
	if (def.kind === "openai" && !base) return { skip: "missing " + U + "_BASE_URL", provider: name, model: model };
	if (!model) return { skip: "missing " + U + "_MODEL", provider: name, model: "" };
	return { provider: name, kind: def.kind, key: key, base: base, model: model };
}

function buildChain(env) {
	const chain = [];
	const skipped = [];
	const seen = new Set();

	const add = (entry) => {
		if (entry.skip) {
			skipped.push({ provider: entry.provider, model: entry.model, reason: entry.skip });
			return;
		}
		const sig = entry.provider + "|" + entry.model;
		if (seen.has(sig)) return;
		seen.add(sig);
		chain.push(entry);
	};

	// 1. legacy single-model config always gets first priority
	if (env.PROVIDER) add(makeEntry(env, env.PROVIDER, env.MODEL));

	// 2. explicit chain
	let spec = String(env.MODELS || "").trim();
	if (/^(free|free-only|freetier|free_tier|免费)$/i.test(spec)) spec = FREE_CHAIN.join(",");
	if (spec) {
		spec
			.split(/[,\n;]+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.forEach((item) => {
				const i = item.indexOf(":");
				const p = i < 0 ? item : item.slice(0, i);
				const m = i < 0 ? "" : item.slice(i + 1).trim();
				add(makeEntry(env, p, m));
			});
	}

	// 3. auto-discover every provider whose key is present
	if (!spec) AUTO_ORDER.forEach((p) => add(makeEntry(env, p, "")));

	// 4. no PROVIDER/MODELS at all and still nothing? fall back to gemini default
	if (!chain.length && !spec && !env.PROVIDER) add(makeEntry(env, "gemini", ""));

	return { chain: chain, skipped: skipped };
}

/* round-robin cursor, per worker isolate */
let RR = 0;

function rotate(chain, env) {
	if (chain.length < 2) return chain.slice();
	if (String(env.ROTATE || "").toLowerCase() === "off") return chain.slice();
	const start = RR++ % chain.length;
	if (RR > 1e6) RR = 0;
	return chain.slice(start).concat(chain.slice(0, start));
}

/* ---------------- system prompts ---------------- */

const SHOT_SYSTEM = [
	"You are a LEGO stop-motion-style war film shot designer working with a fixed asset library.",
	"You will be given a theme (often written in Chinese) and a JSON list of available assets.",
	"Rules:",
	"1. You MUST only use ids that exist in the provided asset list. Never invent an id.",
	"2. Pick 1-3 subjects (characters / vehicles / weapons / props), exactly one environment, one camera, one lighting, one colorGrade, up to 3 fx and up to 2 audio ids.",
	"3. Keep the era and faction consistent: do not mix WWII assets with Modern assets unless the theme explicitly asks for it.",
	"4. Match the theme's intent, not just its literal words. A rescue theme needs rescue-capable assets (helicopters, medics, casualties).",
	"5. 'action' is a short English sentence describing the single core action of one 8-second shot.",
	"6. Answer with STRICT JSON only, no markdown, no commentary:",
	'{"selectedIds":["CHR-001","VEH-001","ENV-001","CAM-001","LGT-001","CLR-001","FX-001","AUD-001"],"action":"...","reason":"..."}',
].join("\n");

const FILM_SYSTEM = [
	"You are the DIRECTOR of a LEGO-brick war film. You plan a complete storyboard from a theme, using ONLY a fixed asset library.",
	"The film is rendered in Google Flow, which can only make 8-second clips, so the film is a sequence of N shots of exactly 8 seconds each.",
	"Hard rules:",
	"1. Return EXACTLY the requested number of shots, in story order.",
	"2. Every id you output MUST exist in the provided asset list. Never invent, translate or reformat an id.",
	"3. Lock continuity: choose ONE environment id and ONE colorGrade id for the whole film and return them at the top level.",
	"4. Keep era/faction consistent across all shots (use the 'series' and 'faction' fields). Do not mix WWII with Modern unless the theme asks.",
	"5. Follow the 4-act structure of the requested rhythm: phase must be one of establish, build, climax, resolve, in that order, with climax near the end.",
	"6. Each shot describes ONE single core action that can physically happen in 8 seconds. No time jumps inside a shot.",
	"7. Reuse a small recurring cast (2-4 subjects) so the audience can follow characters; escalate their situation across shots.",
	"8. Interpret the theme by meaning, in any language. A rescue theme needs rescue assets (CSAR helicopter, pararescue, medic, downed pilot, stretcher); a desert theme needs desert environments; a naval theme needs ships.",
	"9. 'motion' must be copied verbatim from the provided motions list, or omitted.",
	"10. 'action' is a concise English sentence (max 20 words). 'actionZh' is the same line in Simplified Chinese.",
	"11. Answer with STRICT JSON only, no markdown fences, no commentary. Shape:",
	'{"env":"ENV-xxx","clr":"CLR-xxx","weather":["FX-xxx"],"note":"one short Chinese sentence about the approach","shots":[{"phase":"establish","subjects":["CHR-xxx","VEH-xxx"],"cam":"CAM-xxx","lgt":"LGT-xxx","fx":["FX-xxx"],"audio":["AUD-xxx"],"motion":"...","action":"...","actionZh":"..."}]}',
].join("\n");

function buildShotMsg(theme, assets) {
	return ["THEME: " + theme, "", "AVAILABLE ASSETS (JSON):", JSON.stringify(assets)].join("\n");
}

function buildFilmMsg(payload, assets) {
	return [
		"THEME: " + payload.theme,
		"TOTAL DURATION: " + payload.seconds + " seconds",
		"NUMBER OF SHOTS REQUIRED: " + payload.shots + " (each exactly 8 seconds)",
		"RHYTHM TEMPLATE: " + (payload.rhythm || "trailer"),
		"",
		"ALLOWED MOTION PHRASES (copy verbatim):",
		JSON.stringify(payload.motions || []),
		"",
		"AVAILABLE ASSETS (JSON, fields: id, kind, name, nameZh, series, faction, tag):",
		JSON.stringify(assets),
		"",
		"Return exactly " + payload.shots + " shots.",
	].join("\n");
}

/* ---------------- model calls ---------------- */

function extractJson(text) {
	let t = String(text || "").trim();
	if (t.startsWith("```")) t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "");
	const a = t.indexOf("{");
	const b = t.lastIndexOf("}");
	if (a >= 0 && b > a) t = t.slice(a, b + 1);
	return JSON.parse(t);
}

function timeoutSignal(ms) {
	try {
		if (AbortSignal && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
	} catch (e) {}
	const c = new AbortController();
	setTimeout(() => c.abort(), ms);
	return c.signal;
}

async function callGemini(entry, system, userMsg, maxTokens, ms) {
	const url =
		(entry.base || "https://generativelanguage.googleapis.com/v1beta") +
		"/models/" +
		entry.model +
		":generateContent?key=" +
		encodeURIComponent(entry.key);
	const r = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		signal: timeoutSignal(ms),
		body: JSON.stringify({
			systemInstruction: { parts: [{ text: system }] },
			contents: [{ role: "user", parts: [{ text: userMsg }] }],
			generationConfig: {
				temperature: 0.5,
				maxOutputTokens: maxTokens || 8192,
				responseMimeType: "application/json",
			},
		}),
	});
	if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
	const data = await r.json();
	const cand = (data.candidates || [])[0] || {};
	const text = cand.content ? (cand.content.parts || []).map((p) => p.text || "").join("") : "";
	if (!text) throw new Error("empty response");
	return extractJson(text);
}

async function callOpenAI(entry, system, userMsg, maxTokens, ms) {
	const r = await fetch(entry.base.replace(/\/+$/, "") + "/chat/completions", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: "Bearer " + entry.key },
		signal: timeoutSignal(ms),
		body: JSON.stringify({
			model: entry.model,
			temperature: 0.5,
			max_tokens: maxTokens || 8192,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: userMsg },
			],
		}),
	});
	if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
	const data = await r.json();
	const msg = ((data.choices || [])[0] || {}).message || {};
	const text = msg.content || "";
	if (!text) throw new Error("empty response");
	return extractJson(text);
}

function callOne(entry, system, userMsg, maxTokens, ms) {
	return entry.kind === "gemini"
		? callGemini(entry, system, userMsg, maxTokens, ms)
		: callOpenAI(entry, system, userMsg, maxTokens, ms);
}

/**
 * Walk the model chain. First success wins; every failure falls through to the
 * next model. `validate` may throw to reject a semantically bad answer, which
 * also triggers failover to the next model.
 */
async function runChain(env, system, userMsg, maxTokens, validate) {
	const built = buildChain(env);
	const order = rotate(built.chain, env);
	const attempts = [];

	if (!order.length) {
		const err = new Error(
			"No usable model is configured. Add at least one API key (e.g. GEMINI_API_KEY) in Pages > Settings > Environment variables, then redeploy."
		);
		err.attempts = built.skipped.map((s) => ({
			provider: s.provider,
			model: s.model,
			error: s.reason,
		}));
		throw err;
	}

	const ms = Math.max(5000, Math.min(120000, parseInt(env.TIMEOUT_MS, 10) || 45000));

	for (let i = 0; i < order.length; i++) {
		const entry = order[i];
		try {
			const raw = await callOne(entry, system, userMsg, maxTokens, ms);
			const out = validate ? validate(raw) : raw;
			return {
				result: out,
				provider: entry.provider,
				model: entry.model,
				attempts: attempts,
				chainSize: order.length,
			};
		} catch (e) {
			attempts.push({
				provider: entry.provider,
				model: entry.model,
				error: String((e && e.message) || e).slice(0, 200),
			});
		}
	}

	const last = attempts[attempts.length - 1] || {};
	const err = new Error(
		"All " + order.length + " model(s) failed. Last: " + (last.provider || "?") + "/" + (last.model || "?") + " - " + (last.error || "unknown")
	);
	err.attempts = attempts;
	throw err;
}

/* ---------------- validation ---------------- */

const PHASES = ["establish", "build", "climax", "resolve"];

function sanitizeFilm(out, known, wanted) {
	const ok = (id) => typeof id === "string" && known.has(id);
	const pickArr = (arr, limit) => (Array.isArray(arr) ? arr : []).filter(ok).slice(0, limit);

	let shots = Array.isArray(out.shots) ? out.shots : [];
	shots = shots
		.map((s) => s || {})
		.map((s) => ({
			phase:
				PHASES.indexOf(String(s.phase || "").toLowerCase()) >= 0
					? String(s.phase).toLowerCase()
					: "build",
			subjects: pickArr(s.subjects, 3),
			cam: ok(s.cam) ? s.cam : "",
			lgt: ok(s.lgt) ? s.lgt : "",
			fx: pickArr(s.fx, 3),
			audio: pickArr(s.audio, 2),
			motion: typeof s.motion === "string" ? s.motion : "",
			action: String(s.action || "").slice(0, 240),
			actionZh: String(s.actionZh || "").slice(0, 240),
			dialogue: String(s.dialogue || "").slice(0, 160),
		}));

	// a usable plan must name at least one real subject somewhere
	const hasSubject = shots.some((s) => s.subjects.length > 0);
	if (!shots.length || !hasSubject) throw new Error("no usable shots / no valid asset ids");

	// keep exactly `wanted` shots: truncate, or extend by repeating the tail
	if (shots.length > wanted) shots = shots.slice(0, wanted);
	while (shots.length < wanted) {
		shots.push(Object.assign({}, shots[shots.length - 1], { phase: "climax" }));
	}

	return {
		env: ok(out.env) ? out.env : "",
		clr: ok(out.clr) ? out.clr : "",
		weather: pickArr(out.weather, 2),
		note: String(out.note || "").slice(0, 200),
		shots: shots,
	};
}

function sanitizeShot(out, known) {
	const ids = (((out && (out.selectedIds || out.ids)) || []) || []).filter((id) => known.has(id));
	if (!ids.length) throw new Error("model selected no valid assets");
	return {
		selectedIds: ids,
		action: String((out && out.action) || "").slice(0, 240),
		reason: String((out && out.reason) || "").slice(0, 300),
	};
}

/* ---------------- request handler ---------------- */

export async function onRequest(context) {
	const { request, env } = context;

	if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

	if (request.method === "GET") {
		const built = buildChain(env);
		return json({
			ok: built.chain.length > 0,
			service: "LWU AI compose",
			version: "4.2",
			modes: ["shot", "film"],
			modelCount: built.chain.length,
			chain: built.chain.map((e) => e.provider + ":" + e.model),
			skipped: built.skipped,
			rotation: String(env.ROTATE || "").toLowerCase() === "off" ? "off" : "round-robin",
			timeoutMs: Math.max(5000, Math.min(120000, parseInt(env.TIMEOUT_MS, 10) || 45000)),
			tokenRequired: !!env.ACCESS_TOKEN,
			hint: built.chain.length
				? "Ready. Requests fail over down the chain in order."
				: "Add at least one API key (e.g. GEMINI_API_KEY) and redeploy.",
		});
	}

	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

	if (env.ACCESS_TOKEN) {
		const auth = request.headers.get("Authorization") || "";
		if (auth !== "Bearer " + env.ACCESS_TOKEN) return json({ error: "Unauthorized" }, 401);
	}

	let payload;
	try {
		payload = await request.json();
	} catch (e) {
		return json({ error: "Invalid JSON body" }, 400);
	}

	const theme = String((payload && payload.theme) || "").slice(0, 500);
	const assets = Array.isArray(payload && payload.assets) ? payload.assets.slice(0, 700) : [];
	if (!theme) return json({ error: "Missing theme" }, 400);
	if (!assets.length) return json({ error: "Missing assets" }, 400);

	const known = new Set(assets.map((a) => a && a.id).filter(Boolean));
	const mode = String((payload && payload.mode) || "shot").toLowerCase();

	try {
		if (mode === "film") {
			const wanted = Math.max(1, Math.min(150, parseInt(payload.shots, 10) || 1));
			const body = {
				theme: theme,
				seconds: Math.max(8, Math.min(1200, parseInt(payload.seconds, 10) || wanted * 8)),
				shots: wanted,
				rhythm: String(payload.rhythm || "").slice(0, 60),
				motions: Array.isArray(payload.motions) ? payload.motions.slice(0, 200) : [],
			};
			const run = await runChain(env, FILM_SYSTEM, buildFilmMsg(body, assets), 8192, (raw) =>
				sanitizeFilm(raw || {}, known, wanted)
			);
			return json(
				Object.assign({}, run.result, {
					provider: run.provider,
					model: run.model,
					failover: run.attempts,
					chainSize: run.chainSize,
				})
			);
		}

		const run = await runChain(env, SHOT_SYSTEM, buildShotMsg(theme, assets), 2048, (raw) =>
			sanitizeShot(raw, known)
		);
		return json(
			Object.assign({}, run.result, {
				provider: run.provider,
				model: run.model,
				failover: run.attempts,
				chainSize: run.chainSize,
			})
		);
	} catch (e) {
		return json({ error: String((e && e.message) || e), attempts: (e && e.attempts) || [] }, 502);
	}
}
