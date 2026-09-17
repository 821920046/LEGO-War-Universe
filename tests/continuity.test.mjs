import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContinuityChain, enforceContinuityChain, DAMAGE_HIERARCHY } from '../src/domain/continuity.js';

test('Continuity: empty shots list is ok', () => {
  const result = validateContinuityChain([], null);
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test('Continuity: enforceContinuityChain injects all required continuity states', () => {
  const raw = [
    { phase: 'establish', subjects: ['CHR-401'], action: 'Deploying' },
    { phase: 'climax', subjects: ['CHR-401'], action: 'Combat engage' }
  ];
  const enforced = enforceContinuityChain(raw);
  assert.equal(enforced.length, 2);

  // Shot 0
  assert.equal(enforced[0].shotId, 'shot_1');
  assert.ok(enforced[0].continuityIn);
  assert.ok(enforced[0].continuityOut);
  assert.equal(enforced[0].referenceFrame, null); // First shot has no previous frame

  // Shot 1
  assert.equal(enforced[1].shotId, 'shot_2');
  assert.equal(enforced[1].referenceFrame, 'shot_1_end_frame');
  assert.equal(enforced[1].damageState, 'damaged'); // climax upgrade
  assert.equal(enforced[1].variant, 'battle-worn');
});

test('Continuity: missing reference frame on shot > 0 raises MISSING_REFERENCE_FRAME', () => {
  const shots = [
    { shotId: 's1', subjects: ['CHR-401'], screenDirection: 'neutral', damageState: 'weathered', variant: 'standard' },
    { shotId: 's2', subjects: ['CHR-401'], screenDirection: 'neutral', damageState: 'weathered', variant: 'standard' } // no referenceFrame
  ];
  const result = validateContinuityChain(shots, null);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.code === 'MISSING_REFERENCE_FRAME'));
});

test('Continuity: vehicle damage state regression raises DAMAGE_STATE_REGRESSION', () => {
  const shots = [
    { shotId: 's1', referenceFrame: null, subjects: ['VEH-001'], screenDirection: 'neutral', damageState: 'damaged', variant: 'standard' },
    { shotId: 's2', referenceFrame: 'shot_0_end_frame', subjects: ['VEH-001'], screenDirection: 'neutral', damageState: 'clean', variant: 'standard' }
  ];
  const result = validateContinuityChain(shots, null);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.code === 'DAMAGE_STATE_REGRESSION'));
});

test('Continuity: character variant regression raises VARIANT_REGRESSION', () => {
  const shots = [
    { shotId: 's1', referenceFrame: null, subjects: ['CHR-401'], screenDirection: 'neutral', damageState: 'weathered', variant: 'battle-worn' },
    { shotId: 's2', referenceFrame: 'shot_0_end_frame', subjects: ['CHR-401'], screenDirection: 'neutral', damageState: 'weathered', variant: 'clean' }
  ];
  const result = validateContinuityChain(shots, null);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.code === 'VARIANT_REGRESSION'));
});

test('Continuity: 180-degree axis jump raises AXIS_JUMP_ACROSS_LINE', () => {
  const shots = [
    { shotId: 's1', referenceFrame: null, subjects: ['CHR-401'], screenDirection: 'left-to-right', damageState: 'weathered', variant: 'standard', phase: 'build' },
    { shotId: 's2', referenceFrame: 'shot_0_end_frame', subjects: ['CHR-401'], screenDirection: 'right-to-left', damageState: 'weathered', variant: 'standard', phase: 'build' }
  ];
  const result = validateContinuityChain(shots, null);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.code === 'AXIS_JUMP_ACROSS_LINE'));
});
