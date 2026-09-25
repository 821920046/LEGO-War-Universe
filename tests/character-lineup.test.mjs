import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDualFactionLineup, generateLineupPrompt } from '../src/domain/character-lineup.js';

test('Character Lineup: extracts dual factions with front and back rows', () => {
  const lineup = extractDualFactionLineup('黑鹰坠落', 'Modern');
  assert.equal(lineup.frontRow.length, 4);
  assert.equal(lineup.backRow.length, 4);
  assert.equal(lineup.allCharacters.length, 8);

  // 验证前排正派
  assert.equal(lineup.frontRow[0].nameplate, '[GHOST]');
  assert.equal(lineup.frontRow[0].faction, 'protagonist');

  // 验证后排反派
  assert.equal(lineup.backRow[0].nameplate, '[WARLORD]');
  assert.equal(lineup.backRow[0].faction, 'antagonist');
});

test('Character Lineup: generates prompt with two tiers and distinct nameplates', () => {
  const lineup = extractDualFactionLineup('黑鹰坠落', 'Modern');
  const res = generateLineupPrompt(lineup, '黑鹰坠落', '16:9');

  assert.equal(res.totalCount, 8);
  assert.ok(res.promptEn.includes('FRONT ROW'));
  assert.ok(res.promptEn.includes('ELEVATED BACK ROW'));
  assert.ok(res.promptEn.includes('NAMEPLATE LABEL'));
  assert.ok(res.promptEn.includes('[GHOST]'));
  assert.ok(res.promptEn.includes('[WARLORD]'));
  assert.ok(res.promptZh.includes('前排（正派特遣队）'));
  assert.ok(res.promptZh.includes('后排（反派敌对势力）'));
});
