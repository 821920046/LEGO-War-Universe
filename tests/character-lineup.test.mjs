import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCharacterLineup, generateLineupPrompt } from '../src/domain/character-lineup.js';

test('Character Lineup: extracts dual-faction character roster (coalition & opposing)', () => {
  const factions = extractCharacterLineup([], null, 'Modern', '特种部队突袭');

  assert.ok(factions.coalition && factions.coalition.length >= 4, '正方角色数量不少于 4 人');
  assert.ok(factions.opposing && factions.opposing.length >= 4, '反方角色数量不少于 4 人');

  // 验证每个角色都包含唯一 id、callsign、name、role、outfit、faction 属性
  for (const c of factions.coalition) {
    assert.equal(c.faction, 'coalition');
    assert.ok(c.id.startsWith('CHR-C'));
    assert.ok(c.callsign && typeof c.callsign === 'string');
    assert.ok(c.name && typeof c.name === 'string');
    assert.ok(c.role && typeof c.role === 'string');
    assert.ok(c.outfit && typeof c.outfit === 'string');
  }

  for (const c of factions.opposing) {
    assert.equal(c.faction, 'opposing');
    assert.ok(c.id.startsWith('CHR-O'));
    assert.ok(c.callsign && typeof c.callsign === 'string');
    assert.ok(c.name && typeof c.name === 'string');
    assert.ok(c.role && typeof c.role === 'string');
    assert.ok(c.outfit && typeof c.outfit === 'string');
  }
});

test('Character Lineup: adapts roster template according to era', () => {
  const wwiiFactions = extractCharacterLineup([], null, 'WWII', '二战诺曼底登陆');
  assert.ok(wwiiFactions.coalition.some(c => c.name.includes('米勒') || c.callsign === 'CAPTAIN'));
  assert.ok(wwiiFactions.opposing.some(c => c.name.includes('装甲') || c.callsign === 'PANZER'));

  const orbitalFactions = extractCharacterLineup([], null, 'Orbital', '空间站危机');
  assert.ok(orbitalFactions.coalition.some(c => c.name.includes('轨道') || c.callsign === 'ASTRO'));
  assert.ok(orbitalFactions.opposing.some(c => c.name.includes('碎片') || c.callsign === 'DEBRIS'));
});

test('Character Lineup: generates two-row lineup prompt with nameplate labels', () => {
  const factions = extractCharacterLineup([], null, 'Modern', '黑鹰坠落');
  const res = generateLineupPrompt(factions, '黑鹰坠落', 'Modern', '16:9');

  assert.equal(res.characterCount, factions.coalition.length + factions.opposing.length);

  // 验证双排站位描述
  assert.ok(res.promptEn.includes('two clear rows'), 'Prompt 必须指明分两排站位');
  assert.ok(res.promptEn.includes('FRONT ROW'), 'Prompt 必须指明前排正方');
  assert.ok(res.promptEn.includes('BACK ROW'), 'Prompt 必须指明后排反方');

  // 验证代号名牌标签
  assert.ok(res.promptEn.includes('nameplate label'), 'Prompt 必须包含角色脚下的名牌标签');
  assert.ok(res.promptEn.includes('[GHOST]'), 'Prompt 包含正方角色代号');
  assert.ok(res.promptEn.includes('[VIPER]'), 'Prompt 包含反方角色代号');

  // 验证画幅与中文说明
  assert.ok(res.promptEn.includes('--ar 16:9'));
  assert.ok(res.promptZh.includes('正反派双排站位'));
  assert.ok(res.promptZh.includes('前排（正方联军'));
  assert.ok(res.promptZh.includes('后排（反方势力'));
});
