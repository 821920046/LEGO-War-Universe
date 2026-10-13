import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * 语法门禁：把每一个交付的源码模块**解析一遍**（只解析、不执行）。
 *
 * 为什么必须有这道门（第一性原则）：
 * 单元测试只覆盖 domain 层。`src/ui/app.js` 这类直接操作 DOM 的入口模块在 Node 里
 * 根本 import 不进来，于是「const hasReal 重复声明」这种语法错误让整个页面白屏，
 * 而全部单测绿灯、发布门禁也通过 —— 测试通过 ≠ 页面能跑。
 *
 * 首选 `vm.SourceTextModule`（需要 --experimental-vm-modules，npm test 已内置）；
 * 若运行环境没开这个 flag，则退化为 `node --check` 子进程。
 * 两条路都走不通时**必须显式失败**，绝不能静默跳过门禁。
 */

const ROOTS = ['src', 'functions', 'scripts', 'public'];
// public/ 目前只有 JSON，但把它纳入扫描面是为了将来有人往里放 JS 时门禁不会静默漏掉
const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy-ai', 'dist']);

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(?:js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const hasSourceTextModule = typeof vm.SourceTextModule === 'function';

function parseWithVm(file) {
  try {
    // eslint-disable-next-line no-new
    new vm.SourceTextModule(readFileSync(file, 'utf8'), { identifier: file });
    return null;
  } catch (err) {
    return String(err?.message || err);
  }
}

function parseWithCheck(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    const message = String(err.stderr || err.message || '');
    if (/EBUSY|EAGAIN|EMFILE|ENFILE|EACCES/.test(message) && !/SyntaxError/.test(message)) {
      return { ok: false, blocked: true, message };
    }
    return { ok: false, blocked: false, message };
  }
}

test('syntax gate: every shipped module parses', () => {
  const files = ROOTS.flatMap(r => collect(r));
  assert.ok(files.length > 10, `预期收集到多个源文件，实际 ${files.length}`);

  const failures = [];
  let blockedCount = 0;

  for (const file of files) {
    if (hasSourceTextModule) {
      const message = parseWithVm(file);
      if (message) failures.push(`${file}\n${message}`);
      continue;
    }
    const res = parseWithCheck(file);
    if (res.ok) continue;
    if (res.blocked) { blockedCount++; continue; }
    failures.push(`${file}\n${res.message.split('\n').slice(0, 4).join('\n')}`);
  }

  if (blockedCount === files.length) {
    assert.fail(
      '语法门禁无法执行：既没有 vm.SourceTextModule，也无法启动 node --check 子进程。'
      + '请通过 `npm test` 运行（其中已带 --experimental-vm-modules）。'
    );
  }

  assert.equal(failures.length, 0, `以下模块存在语法错误：\n${failures.join('\n\n')}`);
});

/**
 * 作用域门禁：**顶格的函数声明必须真的是模块顶层绑定**。
 *
 * 为什么语法门禁抓不到这个（6.8.1 实测漏网）：
 *   `function renderVariantPicker() {}` 写在模块顶层，还是写在 `bindGlobalEvents()`
 *   体内，**都是完全合法的语法** —— 上面那条 parse 门禁一律放行。
 *   但两者的语义天差地别：后者是外层函数的局部函数，模块顶层的调用方拿不到它，
 *   运行到那里就是 `ReferenceError: renderVariantPicker is not defined`。
 *
 * 这正是用户截图里的故障：6.8.0 把 `describeIntent` / `applyVariantCandidate` /
 * `renderVariantPicker` 插在了 `$('plan').onclick = …` 之后，而那行位于
 * `bindGlobalEvents()` 体内 —— 三个函数被无声地吞进了外层函数。
 * 顶格的 `renderCurrentProject` 调用它们必然抛错；页面一加载 `boot()` 就断在
 * `renderCurrentProject`，镜头列表整块空白；点「深度转译」也抛同一个错，
 * 被 catch 住后弹出「转译失败」。
 * 265 个函数声明、288 条单测、五道门禁全绿，没有一条发现它。
 *
 * 判据（用真解析器，不靠我自己数括号 —— 手写的括号扫描器连正则字面量都不认）：
 *   给每个「没有 export 的顶格函数声明」追加一句 `export { 名字 }` 再解析。
 *   只有真正的模块顶层绑定才能被导出；不是的话 V8 直接报
 *   `Export 'X' is not defined in module`。
 *
 * 前提假设：本仓库里嵌套函数一律缩进，**顶格**即意味着作者认为它在模块顶层。
 * 若将来确实需要在函数体内写顶格函数，请改为缩进 —— 那正是本门禁要区分的语义。
 */
function exportedNames(src) {
  const out = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const piece of m[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/)[0].trim();
      if (name) out.add(name);
    }
  }
  return out;
}

function nestedTopLevelFunctions(src, identifier) {
  const declared = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  // 已经导出的名字不能再追加一次，否则报的是「重复导出」而非「不在顶层」
  const already = exportedNames(src);
  const probe = [...new Set(declared)].filter(n => !already.has(n));
  if (!probe.length) return [];

  try {
    // eslint-disable-next-line no-new
    new vm.SourceTextModule(src + `\nexport { ${probe.join(', ')} };\n`, { identifier });
    return [];
  } catch { /* 有嫌疑，逐个定位 */ }

  const bad = [];
  for (const name of probe) {
    try {
      // eslint-disable-next-line no-new
      new vm.SourceTextModule(src + `\nexport { ${name} };\n`, { identifier });
    } catch {
      bad.push(name);
    }
  }
  return bad;
}

test('scope gate: every top-level function declaration is a real module binding', () => {
  if (!hasSourceTextModule) {
    assert.fail(
      '作用域门禁无法执行：需要 vm.SourceTextModule（请通过 `npm test` 运行，其中已带 '
      + '--experimental-vm-modules）。这条门禁宁可显式失败，也不静默跳过 —— '
      + '它拦的正是「语法合法但运行时 ReferenceError」这类白屏级故障。'
    );
  }

  const files = ROOTS.flatMap(r => collect(r));
  assert.ok(files.length > 10, `预期收集到多个源文件，实际 ${files.length}`);

  const failures = [];
  let declaredTotal = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    declaredTotal += [...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].length;
    const bad = nestedTopLevelFunctions(src, file);
    if (bad.length) {
      failures.push(`${file}\n  顶格声明却不在模块顶层（被外层函数/块吞掉了）：${bad.join(', ')}`);
    }
  }

  assert.ok(declaredTotal > 100, `预期扫描到上百个函数声明，实际 ${declaredTotal}（正则失效？）`);
  assert.equal(
    failures.length, 0,
    '以下模块存在「看着在顶层、实际是局部」的函数，模块顶层的调用方会 ReferenceError：\n'
    + failures.join('\n')
  );
});

test('syntax gate: index.html mounts exactly one module entry and the roster containers', async () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /<script type="module" src="\.\/src\/ui\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /innerHTML/);
  // 角色定妆板块必须挂载真实名册与原创立意的容器
  assert.match(html, /id="character-roster-grid"/);
  assert.match(html, /id="lineup-originality"/);
});
