/**
 * 6.7.3「画面语言」回归测试
 *
 * 这一轮的每一条缺陷都来自**把编译后的 prompt 打印出来读**——
 * 前几轮一直在读 `action` 正文，而真正送进视频模型的是编译后的 prompt，
 * 里面有场景、主体、动作、**机位、灯光、调色、音效**。
 * 于是攒下了本项目最严重的一批内容缺陷：
 *
 *   1. 39 个机位只用 1–3 个（`pool.slice(0,3)`，不判域、不判时段），
 *      「滩头低角度推进跟拍」跨 10 个题材被用了 48 次。
 *   2. 夏季硬光白昼的库尔斯克草原配「战火映照的夜空」。
 *   3. 5 个调色只用 1 个（216/216 全是「好莱坞大片」）；修好「只用 1 个」之后
 *      第二个缺陷才露出来 —— 得分全是 12/12/12，平局由哈希决定，
 *      于是「伊拉克城市清剿」配《兄弟连》、「轨道空间站」配地面专用的《黑鹰坠落》。
 *   4. 4 秒的镜头平均 64 字 / 3.6 个分句 —— 最短的镜头塞最多的内容。
 *   5. `audioCue` 与 `radioVoice` 180/180 都有内容，编译后的 prompt 里一个字都没有。
 *   6. 首帧生图 prompt 把整段中文叙事塞进 `Framing & Pose`。
 *
 * 因此这里的断言同样**基于成片与编译产物**，而不是内部字段。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { planFilm, contentSeconds, FIT_TOLERANCE } from '../src/domain/planner.js';
import { buildRoster } from '../src/domain/roster.js';
import { compileShot } from '../src/domain/compiler.js';
import { compileKeyframeImage } from '../src/domain/image-compiler.js';
import { timeOfDayOf, settingsOf } from '../src/domain/visual-language.js';
import { LINK_BY_PREV } from '../src/domain/story.js';

const registry = createRegistry(assets, profiles, { references: [] });
const PROFILE = [...registry.profileById.keys()][0];
const MAX_DURATION = 8; // 模型单镜上限（见 model-profiles.json）

const THEMES = [
  '库尔斯克坦克对决', '核潜艇深海猎杀', '中途岛航母对决', '诺曼底登陆抢滩', 'F-22 制空巡逻',
  '轨道空间站失压事故', '跳伞飞行员敌后营救', '现代特战小队城市废墟夜间突袭', 'B-2 轰炸敌方雷达站',
  '斯大林格勒巷战', '海湾战争夜战防空导弹阵地伏击', '太平洋热带岛屿滩头两栖登陆作战',
  '沙漠风暴装甲突击', '伊拉克战争城市清剿', '二战北非沙漠装甲追击', '航母战斗群远海编队作战',
  '阿登森林冬季反击战', '敌后渗透破坏桥梁', '护航编队反潜警戒', '近地轨道卫星争夺战',
  '无人机蜂群突防压制敌方雷达', '动力外骨骼小队突击城市废墟', '使馆撤侨掩护平民撤离',
  '高超音速滑翔弹打击敌方反导阵地', '电子战与网络战压制敌方指挥节点', '反无人机阵地防御'
];

const plan = (theme, n = 12, era = null) =>
  planFilm({ theme, requestedShots: n, profileId: PROFILE, era }, registry).plan;

const nameOf = id => registry.byId.get(id)?.nameZh || id;

/* ───────────────── A. 视觉语言资产必须可被检索 ───────────────── */

test('6.7.3 · 每个机位/灯光/调色都必须带 domain，灯光与调色还必须带 setting', () => {
  // 这三个字段是选取逻辑的输入。缺一个，该资产就永远选不中（或永远被选中）。
  // 这正是上一版的病根：资产齐全，但选取逻辑只取数组前三个，36/39 机位是死代码。
  for (const c of assets.cameras) {
    assert.ok(Array.isArray(c.domain) && c.domain.length > 0, `机位 ${c.id} 缺少 domain`);
  }
  for (const l of assets.lighting) {
    assert.ok(Array.isArray(l.domain) && l.domain.length > 0, `灯光 ${l.id} 缺少 domain`);
    assert.ok(Array.isArray(l.tod) && l.tod.length > 0, `灯光 ${l.id} 缺少 tod`);
    assert.ok(Array.isArray(l.setting) && l.setting.length > 0, `灯光 ${l.id} 缺少 setting`);
  }
  for (const g of assets.colorGrades) {
    assert.ok(Array.isArray(g.domain) && g.domain.length > 0, `调色 ${g.id} 缺少 domain`);
    // setting 是区分「同为 ground 的《黑鹰坠落》与《兄弟连》」的唯一依据。
    // 没有它，选取只能退回「最长公共子串」，在长英文正文上退化成噪声平局。
    assert.ok(Array.isArray(g.setting) && g.setting.length > 0, `调色 ${g.id} 缺少 setting`);
    assert.ok(String(g.kw || '').trim().length > 0, `调色 ${g.id} 缺少 kw`);
  }
});

/* ───────────────── B. 机位：按域、按时段、且不重复 ───────────────── */

test('6.7.3 · 一部片子的机位不得重复堆在同一个上（旧实现只用 1–3 个）', () => {
  for (const theme of THEMES) {
    const p = plan(theme);
    const ids = p.shots.map(s => s.camera);
    const distinct = new Set(ids).size;
    assert.ok(distinct >= 6,
      `${theme}: 12 镜只用了 ${distinct} 个机位（旧实现是 1–3 个）：${[...new Set(ids)].map(nameOf).join('/')}`);
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    const worst = Math.max(...counts.values());
    assert.ok(worst <= 3, `${theme}: 单个机位用了 ${worst} 次，机位库远未用起来`);
  }
});

test('6.7.3 · 白昼场景不得使用夜间器材（夜视 / 热成像夜视）', () => {
  // 机位也必须过时段这一关。此前机位只按战场域过滤，
  // 于是白昼的库尔斯克草原用上了「夜视主视角」——夜视仪出现在白天是穿帮。
  for (const theme of ['库尔斯克坦克对决', '中途岛航母对决', '斯大林格勒巷战', '阿登森林冬季反击战']) {
    const p = plan(theme);
    const env = registry.byId.get(p.shots[0].environment);
    const tod = timeOfDayOf({
      intent: p.intent,
      envText: `${env?.name || ''} ${env?.nameZh || ''} ${(env?.lines || []).join(' ')}`
    });
    if (tod !== 'day') continue;
    for (const s of p.shots) {
      const cam = registry.byId.get(s.camera);
      assert.ok(!(Array.isArray(cam.tod) && cam.tod.includes('night') && !cam.tod.includes('day')),
        `${theme}（${tod}）用到了夜间机位「${nameOf(s.camera)}」`);
    }
  }
});

/* ───────────────── C. 灯光：与时段、场景、战场域一致 ───────────────── */

test('6.7.3 · 灯光时段必须与影片时段一致（白昼不得配夜景灯）', () => {
  const NIGHT_ONLY = /夜|night|照明弹|flare/i;
  for (const theme of ['库尔斯克坦克对决', '中途岛航母对决', '斯大林格勒巷战', 'F-22 制空巡逻', '护航编队反潜警戒']) {
    const p = plan(theme);
    const env = registry.byId.get(p.shots[0].environment);
    const tod = timeOfDayOf({
      intent: p.intent,
      envText: `${env?.name || ''} ${env?.nameZh || ''} ${(env?.lines || []).join(' ')}`
    });
    if (tod !== 'day') continue;
    for (const s of p.shots) {
      const lgt = registry.byId.get(s.lighting);
      assert.ok(!NIGHT_ONLY.test(String(lgt.name)),
        `${theme}（${tod}）配了夜间灯光「${nameOf(s.lighting)}」`);
    }
  }
});

test('6.7.3 · 灯光场景类型必须与环境相容（开阔草原不得打丛林光）', () => {
  // 实测回归：「库尔斯克草原」曾配到「丛林斑驳光」，
  // 而「斯大林格勒废墟」曾因为名字里的「林」被判成丛林。
  const CASES = [
    ['库尔斯克坦克对决', /丛林|jungle|forest/i],
    ['阿登森林冬季反击战', /沙漠|desert|丛林斑驳与海滩/i],
    ['斯大林格勒巷战', /丛林|jungle/i]
  ];
  for (const [theme, bad] of CASES) {
    const p = plan(theme);
    for (const s of p.shots) {
      const lgt = registry.byId.get(s.lighting);
      assert.ok(!bad.test(String(lgt.name)),
        `${theme} 配了不相容的灯光「${nameOf(s.lighting)}」`);
    }
  }
});

test('6.7.3 · 调色必须随题材变化（旧实现 216/216 全是同一个）', () => {
  const used = new Map();
  for (const theme of THEMES) {
    const p = plan(theme);
    const id = p.shots[0].colorGrade;
    used.set(id, (used.get(id) || 0) + 1);
  }
  // 5 个调色全部可用 —— 旧实现只有 1 个（216/216 全是「好莱坞大片」）。
  assert.equal(used.size, registry.byKind.get('colorGrade').length,
    `26 个题材只用到 ${used.size} 个调色：${[...used.keys()].map(nameOf).join('/')}`);
  const top = Math.max(...used.values());
  assert.ok(top / THEMES.length < 0.7,
    `最常用的调色占了 ${(top / THEMES.length * 100).toFixed(0)}%，仍然接近「恒定」`);
});

test('6.7.3 · 调色要跟着题材点名走（诺曼底→拯救大兵瑞恩、城市巷战→黑鹰坠落）', () => {
  const CASES = [
    ['诺曼底登陆抢滩', /拯救大兵瑞恩/],
    ['现代特战小队城市废墟夜间突袭', /黑鹰坠落/],
    ['F-22 制空巡逻', /壮志凌云/],
    ['库尔斯克坦克对决', /兄弟连/],
    // 以下三条是「三档域 + 场景」修复后才成立的 ——
    // 只按最长公共子串时，它们的得分是 12/12/12，由哈希决定：
    //   伊拉克战争城市清剿 → 《兄弟连》（二战欧洲阴天步兵，题材是现代城市战）
    //   海湾战争沙漠夜战     → 《兄弟连》
    //   轨道空间站失压事故   → 《黑鹰坠落》（其 domain 是 ground，物理不符）
    ['伊拉克战争城市清剿', /黑鹰坠落/],
    ['海湾战争夜战防空导弹阵地伏击', /黑鹰坠落/],
    ['轨道空间站失压事故', /好莱坞大片/]
  ];
  for (const [theme, want] of CASES) {
    const p = plan(theme);
    assert.ok(want.test(nameOf(p.shots[0].colorGrade)),
      `${theme} 的调色是「${nameOf(p.shots[0].colorGrade)}」`);
  }
});

test('6.7.3 · 调色不得跨战场域乱用（地面专用调色不得落到轨道/空战题材上）', () => {
  // 二档打分时「any」与「地面专用」同分，于是轨道题材拿到了《黑鹰坠落》。
  // 三档（命中 2 / any 1 / 不符 0）之后，中性调色必须赢过错误的专用调色。
  for (const theme of THEMES) {
    const p = plan(theme);
    const cg = registry.byId.get(p.shots[0].colorGrade);
    const dom = p.story.domain;
    if (!Array.isArray(cg.domain) || cg.domain.includes('any')) continue;
    assert.ok(cg.domain.includes(dom),
      `${theme}（域 ${dom}）配了域不符的调色「${cg.nameZh}」（${cg.domain.join('/')}）`);
  }
});

/* ───────────────── D. 时长必须装得下内容 ───────────────── */

test('6.7.4 · 镜头时长必须装得下内容，但允许模型误差量级的压缩', () => {
  // 旧实现：4 秒镜平均 64 字 / 3.6 个分句，6 秒镜 55 字，8 秒镜 55 字
  // —— 最短的镜头塞了最多的内容。
  //
  // 6.7.4 把判定从「内容 ≤ 时长」放宽到「内容 ≤ 时长 ×(1+容差)」，这是**有意的设计变更**，
  // 原因必须写在这里，否则下一个人会以为这是测试被放松了：
  //
  //   严格规则让 `fitDuration` 对 1.2% 的内容超出做出 4s→6s（+50%）的跳跃响应。
  //   两边的代价不对称：
  //     档位比内容**长** → 模型在末尾没有指令可执行，只能自己编画面（成片跑偏，最严重）
  //     档位比内容**短** → 模型把动作压缩着演完（快切镜本来就该紧）
  //   所以宁可留在原档压缩，也不要为了 0.05 秒升一档。
  //   容差只吸收模型误差量级的偏差：内容超出 50%（4s 镜要 6s 才装得下）时仍然升档。
  const cap = (d) => d * (1 + FIT_TOLERANCE) + 0.001;
  for (const theme of THEMES) {
    const p = plan(theme);
    for (const s of p.shots) {
      const need = contentSeconds(s.action).total;
      assert.ok(need <= cap(s.duration),
        `${theme} / ${s.fn}: 内容需要 ${need.toFixed(2)}s，时长 ${s.duration}s 的容差上限是 ${cap(s.duration).toFixed(2)}s —— ${s.action}`);
      assert.ok([4, 6, 8].includes(s.duration), `${theme}: 非法时长 ${s.duration}`);
    }
  }
});

test('6.7.4 · 内容量必须在任何题材下都不越过模型单镜上限（含容差）', () => {
  // 8 秒是模型支持的**最长**档位，fitDuration 到这里就封顶了 ——
  // 所以内容一旦超过 8s×(1+容差)，就会真的被截断，这是硬约束。
  const ceiling = MAX_DURATION * (1 + FIT_TOLERANCE) + 0.001;
  for (const theme of THEMES) {
    for (const s of plan(theme).shots) {
      const need = contentSeconds(s.action).total;
      assert.ok(need <= ceiling,
        `${theme} / ${s.fn}: 内容需要 ${need.toFixed(2)}s，超过单镜硬上限 ${ceiling.toFixed(2)}s —— ${s.action}`);
    }
  }
});

test('6.7.3 · 镜头时长必须真的分化，不能等权重的幻灯片', () => {
  const tiers = new Set();
  for (const theme of THEMES) {
    for (const s of plan(theme).shots) tiers.add(s.duration);
  }
  assert.ok(tiers.size >= 2, `26 个题材只用到 ${tiers.size} 个时长档位：${[...tiers].join('/')}`);
});

/* ───────────────── E. 因果连接词必须拍得到 ───────────────── */

test('6.7.3 · 因果连接词必须是摄影机拍得到的东西，不得是抽象旁白', () => {
  // 旧版是「计划定下了，」「压力还在加码，」「决定已经做出，」——
  // 喂给视频模型的第一个分句是「压力还在加码」，模型既画不出「压力」也听不出「加码」。
  const ABSTRACT = /目标已经明确|局势铺开|观察结束|计划定下|决定已经做出|形势刚刚反转|情报已经被推翻|代价刚刚发生|压力还在加码/;
  for (const [fn, link] of Object.entries(LINK_BY_PREV)) {
    assert.ok(!ABSTRACT.test(link), `连接词「${link}」(${fn}) 是抽象旁白，拍不到`);
    assert.ok(link.length <= 8, `连接词「${link}」(${fn}) 太长，会挤掉画面时间`);
  }
  // 承接类节拍必须仍然有连接词（不能因为改短就整条丢掉）
  for (const fn of ['plan', 'contact', 'escalate', 'reveal', 'decision', 'reversal', 'clash', 'cost']) {
    assert.ok(LINK_BY_PREV[fn].length > 0, `${fn} 缺少因果连接词`);
  }
});

/* ───────────────── F. 编译产物：音频必须真的进去 ───────────────── */

test('6.7.3 · 编译后的视频 prompt 必须包含音效与无线电对白', () => {
  // 这是本轮最「便宜」的一处损失：180/180 个镜头的 audioCue / radioVoice 都有内容，
  // 而编译后的 prompt 里一个字都没有 —— Veo 3 是带音频生成的模型。
  const p = plan('库尔斯克坦克对决');
  const roster = buildRoster(p.shots, registry, { leadId: p.story?.protagonist?.id });
  let checked = 0;
  for (const s of p.shots) {
    const out = compileShot(s, registry, registry.profileById.get(p.profileId), roster);
    assert.ok(out.prompt.includes('Sound design'), `${s.fn}: prompt 缺少声音设计段`);
    if (s.audioCue) {
      assert.ok(out.prompt.includes(s.audioCue), `${s.fn}: 音效没进 prompt：${s.audioCue}`);
      checked++;
    }
    if (s.radioVoice) {
      assert.ok(out.prompt.includes(s.radioVoice), `${s.fn}: 无线电对白没进 prompt`);
    }
  }
  assert.ok(checked >= 10, `只有 ${checked} 镜带音效，样本不足`);
});

test('6.7.3 · 关键帧 prompt 必须是静止构图，不得把整段叙事塞进去', () => {
  const p = plan('库尔斯克坦克对决');
  const roster = buildRoster(p.shots, registry, { leadId: p.story?.protagonist?.id });
  for (const s of p.shots) {
    const kf = compileKeyframeImage(s, registry, roster);
    assert.ok(kf.prompt.includes('Framing & Pose:'), `${s.fn}: 缺少构图段`);
    assert.ok(kf.prompt.includes('frozen single instant'), `${s.fn}: 未声明是静止瞬间`);
    assert.ok(!/\.\s*\./.test(kf.prompt), `${s.fn}: 出现连续句点`);
    // 正文只允许出现第一个视觉分句，不允许整段
    const firstSeg = String(s.action).replace(/「[^」]*」/g, '').split(/[。；！？]/)[0].trim();
    if (firstSeg.length > 6 && String(s.action).length > firstSeg.length + 4) {
      assert.ok(!kf.prompt.includes(String(s.action)),
        `${s.fn}: 整段叙事被塞进了首帧 prompt`);
    }
  }
});

/* ───────────────── G. 确定性 ───────────────── */

test('6.7.3 · 视觉语言选取必须确定性（同一题材两次规划结果一致）', () => {
  for (const theme of ['库尔斯克坦克对决', '无人机蜂群突防压制敌方雷达']) {
    const a = plan(theme);
    const b = plan(theme);
    assert.deepEqual(a.shots.map(s => [s.camera, s.lighting, s.colorGrade, s.duration]),
      b.shots.map(s => [s.camera, s.lighting, s.colorGrade, s.duration]),
      `${theme}: 两次规划结果不一致`);
  }
});

test('6.7.3 · 时段与场景推导本身要有可检验的边界', () => {
  assert.equal(timeOfDayOf({ intent: { lightingCondition: 'night' }, envText: '' }), 'night');
  assert.equal(timeOfDayOf({ intent: { lightingCondition: 'dawn' }, envText: '' }), 'dawn');
  assert.equal(timeOfDayOf({ intent: {}, envText: 'open Russian steppe under a hard summer sky' }), 'day');
  // 「斯大林格勒」里的「林」不得把城市判成丛林
  assert.ok(!settingsOf('Stalingrad Ruins 斯大林格勒废墟').includes('forest'));
  assert.ok(settingsOf('斯大林格勒废墟').includes('urban'));
  assert.ok(settingsOf('阿登森林雪原').includes('snow'));
  assert.ok(settingsOf('阿登森林雪原').includes('forest'));
  assert.ok(settingsOf('诺曼底海滩').includes('water'));
  assert.ok(settingsOf('库尔斯克草原').includes('open'));
});
