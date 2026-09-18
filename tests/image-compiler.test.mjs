import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { compileKeyframeImage } from '../src/domain/image-compiler.js';

const registry = createRegistry(assets, profiles, { references: [] });

test('Keyframe image compiler compiles valid static photo prompt', () => {
  const shot = {
    shotId: 'shot_1',
    subjects: ['CHR-401', 'VEH-001'],
    environment: 'ENV-001',
    camera: 'CAM-001',
    lighting: 'LGT-001',
    colorGrade: 'CLR-001',
    damageState: 'weathered',
    variant: 'standard',
    screenDirection: 'left-to-right',
    action: 'Special Forces operator running towards the tank in combat.'
  };

  const result = compileKeyframeImage(shot, registry);
  assert.ok(result.prompt.includes('Cinematic still photograph of a miniature LEGO stop-motion set'));
  assert.ok(result.prompt.includes('Special Forces Operator'));
  assert.ok(result.prompt.includes('M1A1 Abrams'));
  assert.ok(result.prompt.includes('[condition: weathered]'));
  assert.ok(result.prompt.includes('Subject orientation: facing left-to-right'));
  assert.ok(!result.prompt.includes('running towards')); // Replaced with static pose
  assert.ok(result.negativePrompt.includes('blurry'));
});
