import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCharacterLineup, generateLineupPrompt } from '../src/domain/character-lineup.js';

test('Character Lineup: extracts unique characters from shots array', () => {
  const shots = [
    { shotId: 'shot_1', subjects: ['CHR-401', 'AIR-620'] },
    { shotId: 'shot_2', subjects: ['CHR-401', 'CHR-405'] },
    { shotId: 'shot_3', subjects: ['CHR-405', 'ENV-640'] }
  ];

  const lineup = extractCharacterLineup(shots);
  assert.equal(lineup.length, 2);
  const ids = lineup.map(c => c.id);
  assert.ok(ids.includes('CHR-401'));
  assert.ok(ids.includes('CHR-405'));
  assert.ok(lineup[0].name.includes('幽灵队长'));
  assert.ok(lineup[1].name.includes('猎鹰狙击手'));
});

test('Character Lineup: empty shots gracefully provides fallback characters', () => {
  const lineup = extractCharacterLineup([]);
  assert.ok(lineup.length >= 2);
  assert.ok(lineup[0].id.startsWith('CHR-'));
});

test('Character Lineup: generates full lineup prompt containing all characters and studio anchor settings', () => {
  const characters = [
    { id: 'CHR-401', name: '幽灵队长', role: '指挥官', outfit: '黑色战术服，夜视仪' },
    { id: 'CHR-405', name: '猎鹰狙击手', role: '狙击手', outfit: '吉利伪装服，消音重狙' }
  ];

  const res = generateLineupPrompt(characters, '暗夜突袭', 'Modern', '16:9');
  assert.equal(res.characterCount, 2);
  assert.ok(res.promptEn.includes('standing together side by side'));
  assert.ok(res.promptEn.includes('幽灵队长'));
  assert.ok(res.promptEn.includes('猎鹰狙击手'));
  assert.ok(res.promptEn.includes('--ar 16:9'));
  assert.ok(res.promptZh.includes('全角色定妆全家福参考图'));
});
