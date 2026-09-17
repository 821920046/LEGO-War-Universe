import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { validateShotSpec, validateFilmPlan } from '../src/domain/shot-spec.js';

const registry = createRegistry(assets, profiles, { references: [] });

test('Advanced spec: hostile factions in same shot without combat action is rejected', () => {
  // CHR-001 is Coalition, CHR-004 is Opposing Force (Gulf War)
  const shot = {
    subjects: ['CHR-001', 'CHR-004'],
    environment: 'ENV-001',
    camera: 'CAM-001',
    lighting: 'LGT-001',
    colorGrade: 'CLR-001',
    action: 'Both soldiers sit side by side drinking coffee peacefully.'
  };
  const result = validateShotSpec(shot, registry, { era: 'Gulf War' });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.code === 'FACTION_CONFLICT_INVALID'));
});

test('Advanced spec: hostile factions in same shot with combat action passes', () => {
  const shot = {
    subjects: ['CHR-001', 'CHR-004'],
    environment: 'ENV-001',
    camera: 'CAM-001',
    lighting: 'LGT-001',
    colorGrade: 'CLR-001',
    action: 'Coalition soldier engages Iraqi commander in active combat standoff.'
  };
  const result = validateShotSpec(shot, registry, { era: 'Gulf War' });
  assert.ok(!result.violations.some(v => v.code === 'FACTION_CONFLICT_INVALID'));
});

test('Advanced spec: narrative phase severe regression without flashback is rejected', () => {
  const plan = {
    intent: { era: 'Modern' },
    shots: [
      {
        phase: 'resolve',
        subjects: ['CHR-401'],
        environment: 'ENV-401',
        camera: 'CAM-001',
        lighting: 'LGT-001',
        colorGrade: 'CLR-001',
        action: 'Operator signals mission accomplished.'
      },
      {
        phase: 'establish',
        subjects: ['CHR-401'],
        environment: 'ENV-401',
        camera: 'CAM-001',
        lighting: 'LGT-001',
        colorGrade: 'CLR-001',
        action: 'Operator deploys at sunrise.',
        isFlashback: false
      }
    ]
  };
  const result = validateFilmPlan(plan, registry);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.code === 'NARRATIVE_PHASE_DISORDER'));
});
