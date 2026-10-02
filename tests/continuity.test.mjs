import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContinuityChain, enforceContinuityChain, DAMAGE_HIERARCHY } from '../src/domain/continuity.js';
import { continuityRepairWarnings } from '../src/ui/render.js';

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

test('Continuity: enforceContinuityChain preserves authored screenDirection and damageState', () => {
  // 回归用例：早期实现会无条件用运行态覆盖作者设定，
  // 导致整片轴向恒为 left-to-right、战损永远到不了 destroyed。
  const authored = [
    { phase: 'establish', subjects: ['VEH-101'], screenDirection: 'towards-camera', damageState: 'clean', action: 'A' },
    { phase: 'build', subjects: ['VEH-101'], screenDirection: 'left-to-right', damageState: 'weathered', action: 'B' },
    { phase: 'resolve', subjects: ['VEH-101'], screenDirection: 'away-from-camera', damageState: 'destroyed', action: 'C' }
  ];
  const out = enforceContinuityChain(authored);
  assert.deepEqual(out.map(s => s.screenDirection), ['towards-camera', 'left-to-right', 'away-from-camera']);
  assert.deepEqual(out.map(s => s.damageState), ['clean', 'weathered', 'destroyed']);
  assert.equal(validateContinuityChain(out).ok, true);
});

test('Continuity: damage state can never regress even if a later shot asks for a lighter state', () => {
  const authored = [
    { phase: 'climax', subjects: ['VEH-101'], damageState: 'damaged', action: 'A' },
    { phase: 'resolve', subjects: ['VEH-101'], damageState: 'clean', action: 'B' }
  ];
  const out = enforceContinuityChain(authored);
  assert.equal(out[1].damageState, 'damaged');
  assert.equal(validateContinuityChain(out).ok, true);
});

test('Continuity: illegal axis reversal is auto-repaired to a neutral on-axis beat', () => {
  const authored = [
    { phase: 'build', subjects: ['CHR-401'], screenDirection: 'left-to-right', action: 'A' },
    { phase: 'climax', subjects: ['CHR-401'], screenDirection: 'right-to-left', action: 'B' }
  ];
  const out = enforceContinuityChain(authored);
  assert.equal(out[1].screenDirection, 'neutral');
  assert.equal(out[1].axisRepairedFrom, 'right-to-left');
  // 修复后的链条必须是合法的，而不是把违规留给用户
  assert.equal(validateContinuityChain(out).ok, true);
});

test('Continuity: repaired authored axis direction is surfaced as a visible warning', () => {
  const warnings = continuityRepairWarnings([
    { screenDirection: 'left-to-right' },
    { screenDirection: 'neutral', axisRepairedFrom: 'right-to-left' }
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'AXIS_DIRECTION_AUTO_REPAIRED');
  assert.equal(warnings[0].severity, 'warning');
  assert.match(warnings[0].message, /right-to-left.*neutral/);
  assert.match(warnings[0].message, /确认.*创作意图/);
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
