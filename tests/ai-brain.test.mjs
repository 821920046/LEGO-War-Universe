import test from 'node:test';
import assert from 'node:assert/strict';
import { callAiBrain } from '../src/domain/ai-brain.js';
import { alignShotsToLego } from '../src/domain/lego-aligner.js';

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

test('AI Brain Client: callAiBrain seamlessly outputs full plan with built-in fallback', async () => {
  const result = await callAiBrain({
    query: '壮志凌云',
    requestedShots: 4
  });

  assert.ok(result.matchedMovie.includes('壮志凌云'));
  assert.equal(result.shots.length, 4);
  assert.ok(result.shots[0].action.includes('隐形五代战机'));
});
