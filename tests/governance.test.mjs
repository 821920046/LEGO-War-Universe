import test from 'node:test';
import assert from 'node:assert/strict';
import { checkContentGovernance } from '../src/domain/governance.js';

test('Governance check empty string', () => {
    const result = checkContentGovernance('');
    assert.equal(result.status, 'passed');
});

test('Governance check blocked political figure', () => {
    const result = checkContentGovernance('普京来了');
    assert.equal(result.status, 'blocked');
    assert.ok(result.flags.includes('REAL_POLITICAL_FIGURE'));
});

test('Governance check blocked english political figure action', () => {
    const result = checkContentGovernance('trump sends troops to the front');
    assert.equal(result.status, 'blocked');
});

test('Governance check graphic violence', () => {
    const result1 = checkContentGovernance('斩首示众');
    assert.equal(result1.status, 'blocked');
    assert.ok(result1.flags.includes('GRAPHIC_VIOLENCE_AND_HARM'));

    const result2 = checkContentGovernance('decapitation sequence');
    assert.equal(result2.status, 'blocked');
    assert.ok(result2.flags.includes('GRAPHIC_VIOLENCE_AND_HARM'));
});

test('Governance check modern conflict', () => {
    const result = checkContentGovernance('俄乌冲突背景下');
    assert.equal(result.status, 'review_required');
    assert.ok(result.flags.includes('SENSITIVE_MODERN_CONFLICT'));
});

test('Governance check nuclear launch', () => {
    const result = checkContentGovernance('prepare for nuclear launch');
    assert.equal(result.status, 'review_required');
});

test('Governance check safe marine scene', () => {
    const result = checkContentGovernance('航母战斗群在远海风暴中放飞舰载机');
    assert.equal(result.status, 'passed');
});

test('Governance check historical conflict', () => {
    const result = checkContentGovernance('二战诺曼底登陆');
    assert.equal(result.status, 'passed');
});
