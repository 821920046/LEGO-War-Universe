/**
 * 启动冒烟：**真的把 src/ui/app.js 跑起来**。
 *
 * 为什么必须有这条（第一性原则，也是 6.8.0 → 6.8.2 漏网的真原因）：
 * 现有门禁的分工是 ——
 *   · `syntax.test.mjs`：只**解析**每个模块，证明语法合法；
 *   · 其余单测：只覆盖 `src/domain/**`，纯函数、不碰 DOM。
 * 于是「`app.js` 能解析」+「domain 全绿」+「五道门禁通过」三者叠加，
 * 依然完全不能推出「**页面能跑起来**」。
 *
 * 6.8.0 就是从这个缝里漏出去的：新增的三个函数被插在了 `bindGlobalEvents()`
 * 体内（缩进骗过了眼睛，语法完全合法），模块顶层的 `renderCurrentProject` 调用
 * 它们时抛 `ReferenceError: renderVariantPicker is not defined`。
 * 后果是页面一加载 `boot()` 就断在 `renderCurrentProject`（镜头列表整块空白），
 * 点「深度转译」也抛同一个错、被 catch 成「转译失败」。
 * 265 个函数声明、288 条单测、五道门禁全绿，没有一条发现它。
 *
 * 这条测试的做法：用最小 DOM 桩把模块 import 进来（`boot()` 是模块自启动的），
 * 然后断言「启动过程没有抛出任何异常」。它**不模拟浏览器行为**，
 * 只回答一个问题：**这个模块加载得起来吗？**
 *
 * 与 `syntax.test.mjs` 的作用域门禁互补：那条是静态证明（V8 的链接器判定
 * 每个顶格函数是不是真的模块顶层绑定），这条是动态证据（真的执行一遍）。
 * 两条都要有 —— 静态的那条能定位到名字，动态的这条能抓到静态看不出的运行期问题。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── 最小 DOM 桩 ────────────────────────────────────────────────────────────
// 未知属性一律返回可调用的空函数，这样 app.js 用到新的 DOM API 时不会误报，
// 只有「真的抛异常」才会让测试失败。
const NOOP = () => {};

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle: (c, f) => (f === undefined
      ? (set.has(c) ? set.delete(c) : set.add(c))
      : (f ? set.add(c) : set.delete(c))),
    contains: c => set.has(c),
    get length() { return set.size; }
  };
}

function makeEl(id = '', writes = null) {
  const target = { id, style: {}, dataset: {}, classList: makeClassList(), children: [] };
  const asArray = new Set(['querySelectorAll', 'childNodes', 'files', 'options', 'children']);
  return new Proxy(target, {
    get(t, k) {
      if (typeof k === 'symbol') return undefined;
      if (k in t) return t[k];
      if (asArray.has(k)) return [];
      if (['value', 'textContent', 'innerHTML', 'className', 'tagName', 'type', 'href', 'src'].includes(k)) return '';
      if (['hidden', 'disabled', 'checked'].includes(k)) return false;
      if (['parentNode', 'parentElement', 'firstChild'].includes(k)) return null;
      if (k === 'getBoundingClientRect') return () => ({ width: 0, height: 0, top: 0, left: 0 });
      if (k === 'click') return () => { if (typeof t.onclick === 'function') t.onclick({}); };
      return NOOP;
    },
    set(t, k, v) {
      t[k] = v;
      // 只记短文案：index.html 里内嵌的 JSON 数据块有几十 KB，记下来会淹掉输出
      if (writes && k === 'textContent' && typeof v === 'string' && v && v.length < 400) {
        writes.push({ id: t.id || '(匿名)', v });
      }
      return true;
    }
  });
}

/**
 * 把 src/ui/app.js 在一个受控环境里加载起来。
 * @returns {Promise<{errors: string[], writes: Array<{id:string,v:string}>, getEl: (id:string)=>object}>}
 */
async function bootApp() {
  const writes = [];
  const errors = [];

  const els = new Map();
  const getEl = id => {
    if (!els.has(id)) els.set(id, makeEl(id, writes));
    return els.get(id);
  };

  const html = readFileSync('index.html', 'utf8');
  // app.js 在模块顶层会 JSON.parse 这些内嵌数据块，喂空串会直接抛
  // 「Unexpected end of JSON input」——那是桩的问题，不是被测代码的问题。
  for (const m of html.matchAll(/<script id="([^"]+)" type="application\/json">([\s\S]*?)<\/script>/g)) {
    getEl(m[1]).textContent = m[2];
  }

  globalThis.document = {
    getElementById: getEl,
    querySelector: sel => makeEl(String(sel), writes),
    querySelectorAll: () => [],
    createElement: tag => makeEl('<' + tag + '>', writes),
    createTextNode: () => ({ nodeValue: '' }),
    addEventListener: NOOP,
    removeEventListener: NOOP,
    body: makeEl('body', writes),
    documentElement: makeEl('html', writes),
    head: makeEl('head', writes),
    cookie: ''
  };
  globalThis.window = globalThis;
  // Node 里 location / navigator 是只读 getter，必须用 defineProperty 覆盖
  const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, {
    value, writable: true, configurable: true, enumerable: true
  });
  defineGlobal('location', { href: 'https://example.invalid/', origin: 'https://example.invalid' });
  defineGlobal('navigator', { clipboard: { writeText: async () => {} }, userAgent: 'probe' });
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
  globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
  globalThis.FileReader = class { readAsDataURL() { this.onload?.({ target: { result: 'data:,' } }); } };
  globalThis.URL.createObjectURL = () => 'blob:probe';
  globalThis.URL.revokeObjectURL = NOOP;

  const store = new Map();
  defineGlobal('localStorage', {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  });

  // boot() 只读三个静态 JSON；其余接口一律返回 503 —— 即「没配云端 Key / 离线」，
  // 也就是用户截图里控制台看到的情形，强制走本地生成分支。
  const FILES = {
    './public/build-manifest.json': 'public/build-manifest.json',
    './02_Assets/assets.json': '02_Assets/assets.json',
    './02_Assets/model-profiles.json': '02_Assets/model-profiles.json'
  };
  globalThis.fetch = async url => {
    const key = String(url);
    if (FILES[key]) {
      const text = readFileSync(FILES[key], 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
    }
    return {
      ok: false,
      status: 503,
      json: async () => { throw new Error('503'); },
      text: async () => 'Service Unavailable'
    };
  };

  const origError = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  try {
    // 模块自启动 boot()；它内部 `.catch(err => console.error(err))`
    await import(new URL('../src/ui/app.js', import.meta.url).href);
  } catch (err) {
    errors.push('模块加载抛出：' + (err?.message || err));
  }
  console.error = origError;

  // 让 boot() 里的 await 链跑完（fetch 桩是同步读盘，几个 tick 足够）
  await new Promise(r => setTimeout(r, 300));

  return { errors, writes, getEl };
}

// ESM 有模块缓存：第二次 import 同一个模块是空操作，boot() 不会重跑。
// 所以整个文件**只启动一次**，两条测试共享同一个运行环境。
let envPromise = null;
const env = () => (envPromise ||= bootApp());

test('ui boot smoke: 模块加载与 boot() 全程不抛异常', async () => {
  const { errors, getEl } = await env();

  assert.deepEqual(
    errors, [],
    '加载 src/ui/app.js 时出现异常。最常见的原因是「某个函数看着在模块顶层、'
    + '实际被外层函数吞掉了」，于是模块顶层的调用方 ReferenceError。\n'
    + errors.join('\n')
  );

  // boot() 能跑到写 manifest 这一步，说明 renderTabs / bindGlobalEvents /
  // refreshEvolutionPanel / renderCurrentProject 整条启动链都走通了。
  const manifest = getEl('manifest').textContent || '';
  assert.match(manifest, /构建 \d+\.\d+\.\d+/, `启动链没走完，manifest 文案是：${JSON.stringify(manifest)}`);
  assert.match(manifest, /认证资产 \d+/, `资产没有加载：${JSON.stringify(manifest)}`);
});

test('ui boot smoke: 影院模式「深度转译」不再因作用域问题失败', async () => {
  const { errors, writes, getEl } = await env();

  const profiles = JSON.parse(readFileSync('02_Assets/model-profiles.json', 'utf8'));
  const profileId = profiles[0]?.id || profiles?.profiles?.[0]?.id;
  assert.ok(profileId, 'model-profiles.json 里读不到任何 profile id');

  // 复现用户那次操作：输入一个库里没有的题材名，点「深度转译」
  getEl('movie-input').value = '雪山坚机';
  getEl('shots').value = '8';
  getEl('profile').value = profileId;
  getEl('era').value = 'auto';
  getEl('aspect-ratio').value = '9:16';

  const mark = writes.length;
  getEl('transpile-movie-btn').onclick();

  // 轮询等待异步转译落定（offline 生成一次约 100~400ms）
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if ((getEl('intent').textContent || '').trim()) break;
    await new Promise(r => setTimeout(r, 50));
  }

  const produced = writes.slice(mark);
  const failure = produced.find(w => /转译失败|转译异常|is not defined/.test(w.v));
  assert.equal(
    failure, undefined,
    `转译过程报错：${failure ? JSON.stringify(failure) : ''}\n全部界面文案：${JSON.stringify(produced, null, 2)}`
  );

  const intent = getEl('intent').textContent || '';
  assert.match(intent, /8 镜/, `没有生成 8 个镜头，intent 文案是：${JSON.stringify(intent)}`);
  assert.deepEqual(errors, [], `转译期间出现未捕获异常：\n${errors.join('\n')}`);
});
