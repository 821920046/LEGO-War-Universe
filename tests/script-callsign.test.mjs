import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { planFilm } from '../src/domain/planner.js';
import { compileShot } from '../src/domain/compiler.js';
import { compileKeyframeImage } from '../src/domain/image-compiler.js';
import { transpileMovieToLego } from '../src/domain/cinema-homage.js';
import { buildRoster, rosterFromJSON, rosterToJSON } from '../src/domain/roster.js';
import { validateShotSpec } from '../src/domain/shot-spec.js';
import { exportToCapCutCSV } from '../src/ui/timeline.js';

const registry = createRegistry(assets, profiles, { references: [] });
const profile = registry.profileById.get('veo-3.1-lite');

/** 从文本里抽出所有 【代号】 */
const callsignsIn = (text) => [...String(text || '').matchAll(/【([A-Z][A-Z0-9-]{1,15})】/g)].map(m => m[1]);

test('callsign propagation: planner returns a frozen roster whose callsigns all appear in the script', () => {
  const { plan } = planFilm({ theme: '特战小队在城市废墟中执行夜间突袭', requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);

  assert.ok(Array.isArray(plan.roster));
  assert.ok(plan.roster.length > 0, '计划必须带上名册');
  const roster = rosterFromJSON(plan.roster);
  const known = new Set(roster.all.map(e => e.callsign));

  // 台词里出现的每一个代号，都必须是名册里真实存在的代号（不允许漂移）
  for (const shot of plan.shots) {
    for (const cs of callsignsIn(shot.action)) {
      assert.ok(known.has(cs), `台词里的代号 ${cs} 不在名册中 —— 出现了名册漂移`);
    }
  }
  // 且名册里的角色确实被写进了脚本，而不是只挂在面板上
  const mentioned = new Set(plan.shots.flatMap(s => callsignsIn(s.action)));
  assert.ok(mentioned.size > 0, '角色名字必须真的出现在脚本里');
  for (const cs of mentioned) assert.ok(known.has(cs));
});

test('callsign propagation: every shot carries a unique, non-repetitive action', () => {
  const { plan } = planFilm({ theme: '航母战斗群在远海风暴中放飞舰载机', requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
  const actions = plan.shots.map(s => s.action);
  assert.equal(actions.length, 8);
  assert.equal(new Set(actions).size, 8, '8 个镜头的动作描述必须两两不同');
});

test('callsign propagation: compileShot writes callsigns into the Flow/Veo prompt', () => {
  const { plan } = planFilm({ theme: '特战小队夜间突袭', requestedShots: 4, profileId: 'veo-3.1-lite' }, registry);
  const roster = rosterFromJSON(plan.roster);

  const withRoster = compileShot(plan.shots[0], registry, profile, roster).prompt;
  assert.match(withRoster, /Subject\(s\):/);
  assert.match(withRoster, /【[A-Z][A-Z0-9-]*】/, '视频脚本里必须出现角色代号');
  assert.match(withRoster, /Cast \(must keep identical appearance across all shots\):/);

  // 向后兼容：不传名册时仍必须能编译，只是 Subject(s) 行不带代号
  const without = compileShot(plan.shots[0], registry, profile).prompt;
  const subjectLine = without.split('\n').find(l => l.startsWith('Subject(s):')) || '';
  assert.ok(subjectLine.length > 0);
  assert.doesNotMatch(subjectLine, /【/, '无名义册时 Subject(s) 行不应出现代号');
  assert.doesNotMatch(without, /Cast \(must keep identical appearance/);
});

test('callsign propagation: compileKeyframeImage writes callsigns into the keyframe prompt', () => {
  const { plan } = planFilm({ theme: '特战小队夜间突袭', requestedShots: 4, profileId: 'veo-3.1-lite' }, registry);
  const roster = rosterFromJSON(plan.roster);

  const kf = compileKeyframeImage(plan.shots[0], registry, roster);
  const seg = kf.prompt.match(/Subjects: (.*?)\. Framing/) || [];
  assert.ok(seg[1], 'keyframe prompt 必须包含 Subjects 段');
  assert.match(seg[1], /【[A-Z][A-Z0-9-]*】/, '首帧 Prompt 必须带角色代号');

  const noRoster = compileKeyframeImage(plan.shots[0], registry);
  const seg2 = noRoster.prompt.match(/Subjects: (.*?)\. Framing/) || [];
  assert.ok(seg2[1]);
  assert.doesNotMatch(seg2[1], /【/, '无名义册时 Subjects 段不应出现代号');
});

test('callsign propagation: cinema transpiler casts from the real library with unique actions', () => {
  const result = transpileMovieToLego('黑鹰坠落', 8, registry);

  assert.equal(result.shots.length, 8);
  const actions = result.shots.map(s => s.action);
  assert.equal(new Set(actions).size, 8, '转译 8 镜不得出现重复动作');

  assert.ok(Array.isArray(result.roster) && result.roster.length > 0);
  const roster = rosterFromJSON(result.roster);
  for (const e of roster.all) {
    assert.ok(registry.byId.has(e.id), '名册里的角色必须来自真实资产库');
  }

  const known = new Set(roster.all.map(e => e.callsign));
  const mentioned = new Set(result.shots.flatMap(s => callsignsIn(s.action)));
  assert.ok(mentioned.size > 0, '转译脚本里必须出现角色代号');
  for (const cs of mentioned) assert.ok(known.has(cs), `代号 ${cs} 未出现在名册中`);
  assert.ok(result.originality?.logline && result.originality?.twist);
});

test('callsign propagation: 12-shot transpile still yields fully unique actions', () => {
  const result = transpileMovieToLego('壮志凌云', 12, registry);
  const actions = result.shots.map(s => s.action);
  assert.equal(actions.length, 12);
  assert.equal(new Set(actions).size, 12);
});

test('callsign propagation: roster stays stable when the project is re-aggregated', () => {
  const { plan } = planFilm({ theme: '特战小队夜间突袭', requestedShots: 6, profileId: 'veo-3.1-lite' }, registry);
  const prior = rosterFromJSON(plan.roster);

  // 模拟自我进化：往镜头里补新资产后再重新聚合名册
  const mutated = plan.shots.map((s, i) => (i === 0 ? { ...s, subjects: [...s.subjects, 'CHR-619'] } : s));
  const rebuilt = buildRoster(mutated, registry, { prior });

  for (const e of prior.all) {
    assert.equal(rebuilt.byId.get(e.id).callsign, e.callsign, `${e.id} 的代号被新资产挤走了`);
  }
  const all = rebuilt.all.map(e => e.callsign);
  assert.equal(new Set(all).size, all.length);
  // 序列化后的名册必须能被 JSON 往返（localStorage 持久化前提）
  assert.deepEqual(rosterToJSON(rebuilt), JSON.parse(JSON.stringify(rosterToJSON(rebuilt))));
});

test('callsign propagation: CapCut CSV export carries callsigns in the 主体装备 column', async () => {
  const { plan } = planFilm({ theme: '特战小队夜间突袭', requestedShots: 4, profileId: 'veo-3.1-lite' }, registry);
  const roster = rosterFromJSON(plan.roster);
  plan.shots.forEach(s => { s.aspectRatio = '9:16'; });

  const originalDoc = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalSetTimeout = globalThis.setTimeout;
  let captured = null;

  globalThis.document = {
    createElement: () => ({ click() {}, style: {}, setAttribute() {} })
  };
  URL.createObjectURL = (blob) => { captured = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  // 导出函数会延后 10 秒回收 blob（防止下载被中断）；测试里立即执行，避免挂住事件循环
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  try {
    exportToCapCutCSV(plan.shots, registry, '测试片', roster);
  } finally {
    globalThis.document = originalDoc;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.ok(captured, '导出必须产生一个 Blob');
  // Blob.text() 会按 UTF-8 规范吞掉 BOM，因此必须直接查字节
  const bytes = new Uint8Array(await captured.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'CSV 必须带 UTF-8 BOM 防中文乱码');

  const csv = await captured.text();
  assert.match(csv, /镜头号.*主体装备/);
  const expected = roster.all[0];
  assert.ok(
    csv.includes(`【${expected.callsign}】`),
    `CSV 主体装备列必须包含代号 ${expected.callsign}`
  );
  assert.ok(csv.includes(expected.id), 'CSV 必须保留真实资产 ID 以便追溯');
});

// ---------------------------------------------------------------------------
// 对抗审查补测：以下三条来自「对抗审查」阶段真实撞出来的缺陷，属永久回归护栏。
// ---------------------------------------------------------------------------

test('pipeline integrity: planner 输出在任何主题与镜头数下都能编译（回归：n=12 曾整片抛错）', () => {
  // 背景：clash/enemy 节拍会让正反双方同框，若 action 缺少交战语义，
  // validateShotSpec 判 FACTION_CONFLICT_INVALID，compileShot 直接抛错。
  // 此前 n>=12 会选中两条这样的节拍，导致「生成脚本」整块崩掉。
  const themes = [
    '二战诺曼底登陆抢滩', '太平洋岛屿登陆战', '冷战柏林边境对峙',
    '海湾战争沙漠风暴装甲突击', '伊拉克战争城市巷战', '现代特战夜间突袭',
    '现代高科技无人机蜂群作战', '近地轨道空间站争夺战'
  ];
  const eras = new Set();
  for (const theme of themes) {
    for (const n of [4, 8, 12, 16, 24]) {
      const { plan, intent } = planFilm({ theme, requestedShots: n, profileId: 'veo-3.1-lite' }, registry);
      eras.add(intent.era);
      assert.equal(plan.shots.length, n, `${theme} n=${n} 镜头数不符`);

      const actions = plan.shots.map(s => s.action);
      assert.equal(new Set(actions).size, n, `${theme} n=${n} 出现重复动作`);

      // 每一镜都必须能编译成 Flow/Veo Prompt —— 这是「脚本能拿去生成视频」的底线
      for (const shot of plan.shots) {
        assert.doesNotThrow(
          () => compileShot(shot, registry, profile, rosterFromJSON(plan.roster)),
          `${theme} n=${n} 镜头 ${shot.shotId} 无法编译`
        );
        const check = validateShotSpec(shot, registry, { era: intent.era });
        // 只断言「无阻断级错误」。环境时代不一致属于提示级（资产库各时代环境覆盖极不均衡，
        // 详见 shot-spec 的 ERA_SEVERITY_BY_KIND），不应把整份分镜判为非法。
        const fatal = check.violations.filter(v => v.severity !== 'warning');
        assert.equal(fatal.length, 0, `${theme} n=${n} 镜头 ${shot.shotId} 校验失败: ${JSON.stringify(fatal)}`);
      }

      // 名册只允许收录真正上镜的资产，且每个上镜主体都必须在名册里
      const onScreen = new Set(plan.shots.flatMap(s => s.subjects || []));
      for (const e of plan.roster) assert.ok(onScreen.has(e.id), `名册含未出场角色 ${e.id}`);
      for (const id of onScreen) assert.ok(plan.roster.some(e => e.id === id), `上镜主体 ${id} 不在名册中`);
    }
  }
  assert.ok(eras.size >= 3, `主题覆盖的时代过少（${[...eras].join(',')}），测试本身可能失效`);
});

test('pipeline integrity: cinema transpiler 在所有镜头数下产出的镜头全部合法且动作唯一', () => {
  for (const n of [4, 8, 12, 16, 24, 32]) {
    const result = transpileMovieToLego('黑鹰坠落 摩加迪沙巷战', n, registry);
    assert.equal(result.shots.length, n);
    const actions = result.shots.map(s => s.action);
    assert.equal(new Set(actions).size, n, `n=${n} 出现重复动作`);

    for (const shot of result.shots) {
      const check = validateShotSpec(shot, registry, { era: result.era });
      const fatal = check.violations.filter(v => v.severity !== 'warning');
      assert.equal(fatal.length, 0, `n=${n} 镜头 ${shot.shotId} 非法: ${JSON.stringify(fatal)}`);
      assert.doesNotThrow(() => compileShot(shot, registry, profile, rosterFromJSON(result.roster)));
    }
  }
});

test('pipeline integrity: CSV 导出必须中和公式注入（Excel 会把带引号的 =cmd 当公式执行）', async () => {
  const shots = [{
    shotId: 'S1', phase: 'build', subjects: [], environment: 'ENV-401', camera: 'CAM-401',
    lighting: 'LGT-001', colorGrade: 'CLR-001', aspectRatio: '9:16',
    action: '=HYPERLINK("http://evil.example","点我")',   // 模型可能吐出的恶意文本
    prompt: '+1+1'                                        // 以 + 开头同样会被求值
  }];

  const originalDoc = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalSetTimeout = globalThis.setTimeout;
  let captured = null;

  globalThis.document = { createElement: () => ({ click() {}, style: {}, setAttribute() {} }) };
  URL.createObjectURL = (blob) => { captured = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  try {
    exportToCapCutCSV(shots, registry, '注入测试', null);
  } finally {
    globalThis.document = originalDoc;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    globalThis.setTimeout = originalSetTimeout;
  }

  const csv = await captured.text();
  // 危险单元格必须以单引号开头（Excel 按文本处理），绝不能原样以 = / + 开头
  assert.ok(csv.includes(`"'=HYPERLINK`), '以 = 开头的单元格未被中和');
  assert.ok(csv.includes(`"'+1+1"`), '以 + 开头的单元格未被中和');
  assert.doesNotMatch(csv, /"[=+]/, 'CSV 中不得存在以 = 或 + 开头的裸单元格');
});
