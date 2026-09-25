import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAndParseJson, callAiBrain, DEFAULT_AI_CONFIG } from '../src/domain/ai-brain.js';
import { alignShotsToLego } from '../src/domain/lego-aligner.js';

test('AI Brain: cleanAndParseJson parses clean JSON and markdown codeblock JSON', () => {
  const plainJson = '{"test": 123}';
  assert.equal(cleanAndParseJson(plainJson).test, 123);

  const mdJson = '```json\n{"hello": "world"}\n```';
  assert.equal(cleanAndParseJson(mdJson).hello, 'world');

  const rawMdJson = '```\n{"movie": "TopGun"}\n```';
  assert.equal(cleanAndParseJson(rawMdJson).movie, 'TopGun');
});

test('AI Brain: alignShotsToLego infers valid continuous shot parameters', () => {
  const raw = [
    { action: '战机掠过', shotType: '全景' },
    { action: '导弹追击', shotType: '特写' }
  ];
  const aligned = alignShotsToLego(raw);
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].phase, 'establish');
  assert.equal(aligned[0].screenDirection, 'towards-camera');
  assert.equal(aligned[1].phase, 'build');
  assert.equal(aligned[1].damageState, 'weathered');
});

test('AI Brain: callAiBrain with empty apiKey gracefully falls back to local engine', async () => {
  const result = await callAiBrain({
    query: '壮志凌云',
    requestedShots: 4,
    config: { apiKey: '' }
  });

  assert.equal(result.isAiGenerated, false);
  assert.ok(result.matchedMovie.includes('壮志凌云'));
  assert.equal(result.shots.length, 4);
  assert.ok(result.shots[0].action.includes('隐形五代战机'));
});
