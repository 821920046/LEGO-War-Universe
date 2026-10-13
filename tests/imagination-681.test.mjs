/**
 * 6.8.1 · 「换了输入，脚本却不变」的回归防线
 *
 * 用户实测反馈（截图）：
 *   「换了两次内容了，每次第一个脚本的内容都是『两架战术直升机在灰尘弥漫的城市街道低空
 *     悬停，四根粗索降绳掷下，特战队员呈战术姿态顺绳滑降，周围街道楼顶人影攒动。』
 *     这到底是什么意思，没有使用AI吗」
 *
 * 这句话不是 AI 生成的，它是《黑鹰坠落》第 1 镜的**手写**复刻文本
 * （`cinema-homage.js` 的 `CINEMA_DATABASE`）。成因是 `transpileMovieToLego` 结尾有一句
 * `else { match = CINEMA_DATABASE.find(m => m.id === 'black-hawk-down') }`——
 * **任何没命中库里 9 部影片的输入，都被静默替换成《黑鹰坠落》**，输入根本没参与选片。
 *
 * 本文件把这条链路钉死：
 *   1. 只有**真的点名了某部影片**才算命中策展库；
 *   2. 没命中时必须走生成引擎，且**输出随输入变化**；
 *   3. 任何未命中的输入都不得再拿到那台直升机的分镜；
 *   4. 度量骨架重合时人名必须归一，否则「重复率」这个数字本身就是假的。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchCuratedFilm, transpileMovieToLego, CINEMA_DATABASE } from '../src/domain/cinema-homage.js';
import { generateLocally, OFFLINE_ENGINES } from '../src/domain/local-engine.js';
import { skeletonOf, rosterNames, diversify, scoreCandidate } from '../src/domain/variant-score.js';
import { planFilm } from '../src/domain/planner.js';
import { createRegistry } from '../src/domain/registry.js';
import { onRequest } from '../functions/api/ai-brain.js';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };

const registry = createRegistry(assets, profiles, { references: [] });

/** 用户截图里那句 —— 它只该在「用户真的点了《黑鹰坠落》」时出现 */
const HELO_SENTENCE = '两架战术直升机在灰尘弥漫的城市街道低空悬停';

/** 未点名任何影片的自由题材 */
const FREE_THEMES = [
  '随便写一个没听过的名字',
  '现代城市巷战',
  '北极冰原潜艇猎杀',
  '蒙古骑兵草原突袭',
  '赛博朋克黑客攻防',
  '古代攻城战',
  '沙漠风暴坦克对决',
  '丛林游击战伏击',
  '南极科考站遇袭',
  '火车站台争夺战'
];

const call = (body, env = {}) => onRequest({
  request: new Request('https://lwu.example/api/ai-brain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }),
  env
});

/* ── 1. 匹配口径 ─────────────────────────────────────────────────── */

test('6.8.1 · 只有点名影片才命中策展库，题材词一律不命中', () => {
  // 正例：片名 / 别名 / 片名的一部分
  for (const q of ['黑鹰坠落', '壮志凌云：独行侠', '地心引力', '明日边缘', '流浪地球',
    '边境杀手', '拯救大兵瑞恩', '敦刻尔克', '二战诺曼底登陆', '黑鹰']) {
    assert.equal(matchCuratedFilm(q).kind, 'exact', `「${q}」应命中策展库`);
  }

  // 反例：这些**全是题材词**，旧实现会把它们硬拽进某条固定分镜
  for (const q of FREE_THEMES) {
    assert.equal(matchCuratedFilm(q).film, null, `题材「${q}」不该命中策展库`);
  }
});

test('6.8.1 · 别名里不得再出现「题材词」（回归：城市巷战 / 索降 / 战斗机 / 空间站）', () => {
  // 这些词描述的是**题材**而不是**某部片**。留在别名里等于「用户描述一个题材，
  // 系统给一部固定电影」——正是本次投诉的成因。
  const FORBIDDEN = ['城市巷战', '索降', '战斗机', '空间站', '太空站', '失重', '宇航员',
    '外骨骼', '动力机甲', '夜视仪', '防波堤', '无人机', '蜂群', '现代战争', '网络战'];
  for (const film of CINEMA_DATABASE) {
    for (const alias of film.aliases) {
      assert.ok(!FORBIDDEN.includes(alias),
        `《${film.title}》的别名「${alias}」是题材词，会把自由主题误判成这部片`);
    }
  }
});

/* ── 2. 未命中不得再退回《黑鹰坠落》 ───────────────────────────────── */

test('6.8.1 · 未命中时 transpileMovieToLego 必须如实报错，不得静默兜底', () => {
  for (const q of FREE_THEMES) {
    const r = transpileMovieToLego(q, 4, registry);
    assert.equal(r.error, 'NO_CURATED_MATCH', `「${q}」不该拿到任何策展分镜`);
    assert.equal(r.shots.length, 0);
    assert.ok(!String(r.shots?.[0]?.action || '').includes(HELO_SENTENCE));
  }
});

test('6.8.1 · 任何未命中的输入都不得再拿到《黑鹰坠落》的直升机开场', () => {
  for (const q of FREE_THEMES) {
    const g = generateLocally({ theme: q, requestedShots: 4, registry });
    assert.ok(g, `「${q}」必须能由生成引擎出片`);
    assert.equal(g.matchedMovie, null, `「${q}」不得声称解构了某部影片`);
    const body = g.shots.map(s => s.action).join('\n');
    assert.ok(!body.includes(HELO_SENTENCE), `「${q}」拿到了《黑鹰坠落》的手写分镜`);
  }
});

/* ── 3. 输入必须真的决定输出 ──────────────────────────────────────── */

test('6.8.1 · 不同题材必须产出不同的开场（这是投诉的核心）', () => {
  const firsts = new Map();
  for (const q of FREE_THEMES) {
    const g = generateLocally({ theme: q, requestedShots: 8, registry });
    const key = skeletonOf(g.shots[0].action, rosterNames(g.roster));
    firsts.set(key, [...(firsts.get(key) || []), q]);
  }
  const distinct = firsts.size;
  assert.ok(distinct >= FREE_THEMES.length * 0.7,
    `${FREE_THEMES.length} 个题材只有 ${distinct} 种开场骨架，重复太严重`);

  const worst = Math.max(...[...firsts.values()].map(v => v.length));
  assert.ok(worst <= Math.ceil(FREE_THEMES.length * 0.3),
    `最高频开场占了 ${worst}/${FREE_THEMES.length}，用户会再次看到「换个主题还是同一句」`);
});

test('6.8.1 · 生成引擎对输入敏感且确定性（同输入同结果，异输入异结果）', () => {
  const a1 = generateLocally({ theme: '北极冰原潜艇猎杀', requestedShots: 8, registry });
  const a2 = generateLocally({ theme: '北极冰原潜艇猎杀', requestedShots: 8, registry });
  assert.deepEqual(a1.shots.map(s => s.action), a2.shots.map(s => s.action), '同一题材两次结果必须一致');

  const b = generateLocally({ theme: '蒙古骑兵草原突袭', requestedShots: 8, registry });
  assert.notDeepEqual(a1.shots.map(s => s.action), b.shots.map(s => s.action), '不同题材结果必须不同');
});

test('6.8.1 · 注册表缺失时生成引擎返回 null，而不是伪装成成功', () => {
  assert.equal(generateLocally({ theme: '任意题材', registry: null }), null);
});

test('6.8.1 · 生成结果的标签必须诚实：非云端 AI、非复刻', () => {
  const g = generateLocally({ theme: '古代攻城战', requestedShots: 4, registry });
  assert.equal(g.contentKind, 'generated');
  assert.equal(g.isAiGenerated, false);
  assert.equal(g.engine, OFFLINE_ENGINES.generated);
  assert.ok(g.engine.includes('非云端'), '必须如实说明不是云端 AI 产出');
  // 生成片没有「被解构的导演」——这些字段留空，UI 不该显示拉片面版
  assert.equal(g.director, null);
  assert.equal(g.year, null);
});

/* ── 4. 骨架度量本身必须可信 ─────────────────────────────────────── */

test('6.8.1 · skeletonOf 不得靠正则猜人名长度（回归：同一节拍算出 3 个骨架）', () => {
  // 旧实现 `【[^】]*】[\u4e00-\u9fa5]{2,4}` 的贪心量词按「后面还有多少汉字」吃 2–4 字，
  // 于是同一条节拍换个人名就变一个骨架，重复率被系统性低估 —— 度量不准比没有度量更危险。
  const names = ['米勒', '邓肯', '施密特', '哈里森', '伊万诺夫', '奥尔特加'];
  const beats = [
    (n) => `【TANGO】${n}从胸袋里摸出一张被汗浸皱的照片，看了两秒，又塞了回去。`,
    (n) => `【VECTOR】${n}把头盔摘下来搁在膝盖上，用袖口把面罩上的灰擦掉。`
  ];
  for (const beat of beats) {
    const skels = new Set(names.map(n => skeletonOf(beat(n), names)));
    assert.equal(skels.size, 1, `同一节拍换人名后骨架必须相同，实际 ${skels.size} 种：${[...skels].join(' | ')}`);
  }
  // 不同节拍仍必须可区分（归一不能把所有句子压成一句）
  assert.notEqual(skeletonOf(beats[0]('米勒'), names), skeletonOf(beats[1]('米勒'), names));
});

test('6.8.1 · rosterNames 能从 plan.roster 里取到正文用名', () => {
  const { plan } = planFilm({ theme: '现代特战小队夜间渗透敌方地下指挥掩体', requestedShots: 4, profileId: 'veo-3.1-lite' }, registry);
  const names = rosterNames(plan.roster);
  assert.ok(names.length > 0, '名册里必须有人名');
  assert.ok(names.every(n => typeof n === 'string' && n.length >= 2));
});

/* ── 5. 去重惩罚不得叠加、且必须重排 ─────────────────────────────── */

test('6.8.1 · diversify 重复调用不得叠加惩罚（同一候选集必须给同一答案）', () => {
  const theme = '现代特战小队在暴风雨之夜渗透敌方地下指挥掩体';
  const mk = () => {
    const twin = planFilm({ theme, requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
    return [
      { index: 0, spec: { label: 'A' }, film: twin, score: 95, detail: {} },
      { index: 1, spec: { label: 'B' }, film: JSON.parse(JSON.stringify(twin)), score: 95, detail: {} }
    ];
  };
  const once = diversify(mk());
  const twice = diversify(mk());
  assert.deepEqual(once.map(c => c.score), twice.map(c => c.score), '两次独立调用结果必须一致');

  const same = mk();
  const first = diversify(same).map(c => c.score);
  const second = diversify(same).map(c => c.score);
  assert.deepEqual(first, second, '对同一批对象重复调用不得继续扣分');
});

test('6.8.1 · diversify 扣分后必须重排，最优不得是换皮方案', () => {
  const theme = '现代特战小队在暴风雨之夜渗透敌方地下指挥掩体';
  const twin = planFilm({ theme, requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
  const other = planFilm({ theme: '海军陆战队登陆敌方滩头阵地夺取雷达站', requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
  const out = diversify([
    { index: 0, spec: { label: 'A(换皮源)' }, film: twin, score: 96, detail: {} },
    { index: 1, spec: { label: 'B(换皮)' }, film: JSON.parse(JSON.stringify(twin)), score: 95, detail: {} },
    { index: 2, spec: { label: 'C(不同)' }, film: other, score: 90, detail: {} }
  ]);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].score >= out[i].score, '返回顺序必须按最终分降序');
  }
  assert.ok(out[0].score >= 90, `排在首位的不该是被扣分的换皮方案，实际 ${out[0].spec.label}`);
});

/* ── 6. 后端离线兜底必须同样分流 ─────────────────────────────────── */

test('6.8.1 · 后端无 Key 时：题材走生成、片名走复刻，且标签诚实', async () => {
  for (const q of FREE_THEMES.slice(0, 4)) {
    const res = await call({ query: q, requestedShots: 4 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.contentKind, 'generated', `「${q}」后端应走生成引擎`);
    assert.equal(data.matchedMovie, null);
    assert.equal(data.isAiGenerated, false);
    assert.ok(data.engine.includes('非云端'), `「${q}」引擎标签必须诚实：${data.engine}`);
    assert.ok(!JSON.stringify(data.shots).includes(HELO_SENTENCE), `「${q}」后端又退回了黑鹰坠落`);
  }

  const res = await call({ query: '壮志凌云', requestedShots: 4 });
  const data = await res.json();
  assert.equal(data.contentKind, 'curated');
  assert.ok(data.matchedMovie.includes('壮志凌云'));
  assert.ok(data.engine.includes('策展致敬库'), `复刻必须如实标注：${data.engine}`);
});

/* ── 7. 前端契约：两种产出分开呈现 ───────────────────────────────── */

test('6.8.1 · 前端必须按 contentKind 分流，不得把原创片渲染成「解构《xxx》」', async () => {
  const app = await readFile('src/ui/app.js', 'utf8');
  assert.match(app, /contentKind === 'generated'/, '必须识别原创生成');
  assert.match(app, /renderGeneratedPanel\(/, '原创片必须有独立看板');
  assert.match(app, /const isGenerated = /, '必须有分流判定');
  // 原创片不得被套上「已成功解构并转译《…》」这句（那是复刻路径的话术）
  const genBranch = app.slice(app.indexOf('if (isGenerated)'), app.indexOf('} else {', app.indexOf('if (isGenerated)')));
  assert.ok(!genBranch.includes('已成功解构并转译'), '原创片不得使用复刻话术');
  assert.ok(genBranch.includes('原创生成'), '原创片必须有诚实措辞');
});
