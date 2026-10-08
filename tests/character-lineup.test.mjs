import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { buildRoster, displayNameOf } from '../src/domain/roster.js';
import { extractCharacterLineup, generateLineupPrompt } from '../src/domain/character-lineup.js';

const registry = createRegistry(assets, profiles, { references: [] });

/* ───────── 6.7.1：定妆表与剧本正文合并为同一套角色口径 ─────────
 *
 * 旧实现（v4.x）自带 FACTION_TEMPLATES：四套手写的「幽灵队长 / 猎鹰狙击手」阵容，
 * 角色编号是 CHR-C01 / CHR-O01 这类只存在于模板里的虚构 ID。于是同一部片子里并存
 * 两套口径 —— 剧本走真实资产 + persona 人名，定妆表走虚构角色 + 单位类型当人名。
 *
 * 下面这组测试锁定的正是「合并之后」的契约：
 *   1. 定妆表的每个角色都必须是资产库里真实存在的资产（ID 可被注册表解析）；
 *   2. 同一个人在本片名册与定妆表里必须拿到同一个代号、同一个人物姓名；
 *   3. 全家福生图 Prompt 里的「人名」必须是人物姓名，不能是单位类型。
 */

test('Character Lineup: 名册只含资产库里真实存在的资产，不再有虚构模板 ID', () => {
  const factions = extractCharacterLineup([], registry, 'Modern', '现代特战小队城市废墟夜间突袭');

  const all = [...factions.coalition, ...factions.opposing];
  assert.ok(all.length > 0, '应当预选出一支队伍');

  for (const c of all) {
    assert.ok(registry.byId.has(c.id), `${c.id} 必须是注册表里真实存在的资产`);
    assert.ok(c.callsign && typeof c.callsign === 'string');
    assert.ok(displayNameOf(c), '每个角色都必须有非空显示名');
    assert.ok(c.outfit && typeof c.outfit === 'string');
    assert.ok(c.faction !== undefined || c.side !== undefined, '必须带阵营标识');
  }

  // 旧模板的编号形如 CHR-C01 / CHR-O01，绝不能再次出现
  for (const c of all) {
    assert.ok(!/^CHR-[CO]\d+$/.test(c.id), `${c.id} 是虚构模板 ID，不该再出现`);
  }
});

test('Character Lineup: 同一个人在名册与定妆表里代号与姓名完全一致', () => {
  // 这条是「两套口径合并」的核心断言：走分镜聚合路径与走预选路径，
  // 只要资产相同，代号与 persona 就必须相同（否则台词里写着 GHOST、定妆表里变成 FALCON）。
  const shots = [
    { subjects: ['CHR-401', 'CHR-412'] },
    { subjects: ['CHR-401', 'VEH-401'] }
  ];
  const lineup = extractCharacterLineup(shots, registry, 'Modern', '');
  const roster = buildRoster(shots, registry);

  assert.equal(lineup.isPreview, false, '有分镜时应走真实名册路径');
  assert.equal(lineup.all.length, roster.all.length);

  for (const entry of roster.all) {
    const shown = lineup.byId.get(entry.id);
    assert.ok(shown, `${entry.id} 应出现在定妆表里`);
    assert.equal(shown.callsign, entry.callsign, `${entry.id} 的代号必须一致`);
    assert.equal(displayNameOf(shown), displayNameOf(entry), `${entry.id} 的显示名必须一致`);
  }

  // 角色确实来自资产库，且带上了人物姓名（不再是「动力外骨骼特战队员」这类单位类型）
  const lead = lineup.byId.get('CHR-401');
  assert.ok(lead.persona, '真实角色必须有人物姓名');
  assert.notEqual(displayNameOf(lead), lead.role, '显示名不该等于单位类型');
});

test('Character Lineup: 时代适配由资产的 series 决定，而不是硬编码 ID 前缀', () => {
  const wwii = extractCharacterLineup([], registry, 'WWII', '二战诺曼底登陆抢滩');
  const wwiiSeries = new Set(['WWII', 'Pacific']);
  for (const c of [...wwii.coalition, ...wwii.opposing]) {
    const a = registry.byId.get(c.id);
    assert.ok(wwiiSeries.has(a.series), `${c.id}(${a.series}) 不该出现在二战定妆表里`);
  }

  const orbital = extractCharacterLineup([], registry, 'Orbital', '近地轨道空间站危机');
  for (const c of [...orbital.coalition, ...orbital.opposing]) {
    const a = registry.byId.get(c.id);
    assert.ok(['Orbital', 'Modern High-Tech', 'Modern'].includes(a.series),
      `${c.id}(${a.series}) 不该出现在轨道定妆表里`);
  }
});

test('Character Lineup: 从分镜反推时代（不再靠 CHR-1xx / CHR-7xx 这类失效前缀）', () => {
  // 旧实现在 era 缺省时按 ID 前缀猜时代，前缀在 6.5/6.6 扩容后已大面积失配。
  // 现在读资产的 series 取众数 —— 用二战资产组片，推断结果必须是 WWII。
  const shots = [{ subjects: ['CHR-101', 'CHR-102'] }, { subjects: ['CHR-101'] }];
  const factions = extractCharacterLineup(shots, registry, '', '诺曼底登陆');
  for (const c of [...factions.coalition, ...factions.opposing]) {
    const a = registry.byId.get(c.id);
    assert.equal(a.series, 'WWII', `${c.id} 应来自 WWII 系列`);
  }
});

test('Character Lineup: 全家福 Prompt 用人名而不是单位类型', () => {
  const factions = extractCharacterLineup([{ subjects: ['CHR-401', 'CHR-412'] }], registry, 'Modern', '');
  const res = generateLineupPrompt(factions, '现代特战', 'Modern', '16:9');

  assert.equal(res.characterCount, factions.coalition.length + factions.opposing.length);
  assert.ok(res.promptEn.includes('two clear rows'), 'Prompt 必须指明分两排站位');
  assert.ok(res.promptEn.includes('FRONT ROW'), 'Prompt 必须指明前排正方');
  assert.ok(res.promptEn.includes('BACK ROW'), 'Prompt 必须指明后排反方');
  assert.ok(res.promptEn.includes('nameplate label'), 'Prompt 必须包含角色脚下的名牌标签');

  // 核心断言：被引号括起来的人名必须是 persona，而不是 role（单位类型）
  for (const c of [...factions.coalition, ...factions.opposing]) {
    assert.ok(res.promptEn.includes(`"${c.persona}"`), `Prompt 应包含人名「${c.persona}」`);
    assert.ok(!res.promptEn.includes(`"${c.role}"`), `Prompt 不该把单位类型「${c.role}」当人名`);
  }

  assert.ok(res.promptEn.includes('--ar 16:9'));
  assert.ok(res.promptZh.includes('正反派双排站位'));
  assert.ok(res.promptZh.includes('前排（正方联军'));
  assert.ok(res.promptZh.includes('后排（反方势力'));
});

test('Character Lineup: 定妆表与剧本正文的代号一一对应', () => {
  const shots = [{ subjects: ['CHR-401', 'CHR-412'] }];
  const factions = extractCharacterLineup(shots, registry, 'Modern', '');
  const res = generateLineupPrompt(factions, '测试片', 'Modern', '9:16');

  for (const c of [...factions.coalition, ...factions.opposing]) {
    assert.ok(res.promptEn.includes(`[${c.callsign}]`), `Prompt 应包含代号 [${c.callsign}]`);
    assert.ok(res.promptZh.includes(`[${c.callsign}]`), `中文说明应包含代号 [${c.callsign}]`);
  }
});

test('Character Lineup: 没有 registry 时退回内嵌注册表，而不是虚构模板', () => {
  // 内嵌注册表（assets-data.js）与页面启动用的是同一份数据，
  // 因此「没传 registry」也必须产出真实资产，绝不能退回写死的虚构角色。
  const factions = extractCharacterLineup([], null, 'Modern', '现代特战');
  assert.ok(factions.coalition.length + factions.opposing.length > 0);

  // 内嵌数据里所有分组的 ID（名册同时含人仔与载具，两者分属不同分组）
  const embeddedIds = new Set();
  for (const group of Object.values(assets)) {
    if (Array.isArray(group)) for (const a of group) embeddedIds.add(a.id);
  }

  for (const c of [...factions.coalition, ...factions.opposing]) {
    assert.ok(/^[A-Z]{2,5}-\d{3}$/.test(c.id), `${c.id} 应是合法资产 ID`);
    assert.ok(embeddedIds.has(c.id), `${c.id} 应存在于内嵌资产数据里`);
  }
});

test('Character Lineup: vehicles never leak into the minifigure lineup prompt', () => {
  // 真实名册会同时包含人仔与载具；载具若被当成 minifigure 计数，
  // 生成的合影 Prompt 会要求模型画一架人仔大小的直升机。
  const factions = {
    coalition: [
      { id: 'CHR-401', kind: 'character', callsign: 'BASILISK', persona: '米勒', name: '特种部队队员', role: 'Special Forces', outfit: 'plate carrier' },
      { id: 'AIR-601', kind: 'vehicle', callsign: 'CARRION', name: 'HH-60W 铺路鹰', role: '载具', outfit: 'four-blade rotor' }
    ],
    opposing: [
      { id: 'CHR-412', kind: 'character', callsign: 'VULTURE', persona: '科瓦奇', name: '便携防空导弹射手', role: 'Air Defense', outfit: 'launch tube' }
    ]
  };
  const res = generateLineupPrompt(factions, '测试片', 'Modern', '9:16');

  assert.equal(res.characterCount, 2, '只应统计人仔，不含载具');
  assert.ok(!res.promptEn.includes('CARRION'), '载具代号不得出现在人仔全家福 Prompt 中');
  assert.ok(!res.promptEn.includes('HH-60W'));
  assert.ok(res.promptEn.includes('2 distinct LEGO minifigures'));
  assert.ok(res.promptEn.includes('[BASILISK]'));
  assert.ok(res.promptEn.includes('[VULTURE]'));
  assert.ok(res.promptEn.includes('"米勒"'), '应使用人物姓名');
});
