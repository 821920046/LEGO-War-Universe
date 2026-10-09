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
    shotType: '拐角遭遇手持近景 (Contact Handheld)',
    focus: 'clash',
    damageState: 'weathered',
    variant: 'standard',
    screenDirection: 'left-to-right',
    action: '第一发穿甲弹从侧翼打来，在炮塔边上炸开，两车在开阔地边缘正面交战。'
  };

  const result = compileKeyframeImage(shot, registry);
  assert.ok(result.prompt.includes('Cinematic still photograph of a miniature LEGO stop-motion set'));
  assert.ok(result.prompt.includes('Special Forces Operator'));
  assert.ok(result.prompt.includes('M1A1 Abrams'));
  assert.ok(result.prompt.includes('[condition: weathered]'));
  assert.ok(result.prompt.includes('Subject orientation: facing left-to-right'));

  // 6.7.3：首帧是 image-to-video 的锚点，必须是一张**站得住的静止构图**，
  // 而不是把整段叙事复述一遍。此前这一格塞的是整段中文正文。
  assert.ok(result.prompt.includes('frozen single instant'), '首帧必须声明是静止瞬间');
  assert.ok(result.prompt.includes('Contact Handheld'), '景别的英文部分要进构图');
  assert.ok(result.prompt.includes('the two opposing minifigures'), 'focus 要决定站位描述');
  assert.ok(!result.prompt.includes('两车在开阔地边缘正面交战'), '整段叙事不得塞进首帧');
  assert.ok(result.prompt.includes('Action context (Chinese): 第一发穿甲弹从侧翼打来'),
    '只留第一个视觉分句作为画面提示');
  assert.ok(!/\.\s*\./.test(result.prompt), '不得出现连续句点（旧实现会拼出「交战。.」）');

  assert.ok(result.negativePrompt.includes('blurry'));
});
