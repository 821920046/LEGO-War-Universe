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

test('syntax gate: index.html mounts exactly one module entry and the roster containers', async () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /<script type="module" src="\.\/src\/ui\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /innerHTML/);
  // 角色定妆板块必须挂载真实名册与原创立意的容器
  assert.match(html, /id="character-roster-grid"/);
  assert.match(html, /id="lineup-originality"/);
});
