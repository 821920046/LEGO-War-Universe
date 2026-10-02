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

test('Governance normalizes full-width, spaced, punctuated, and zero-width evasions', () => {
    for (const text of ['ＴＲＵＭＰ', 't r u m p', 't.r.u.m.p', 'tr\u200Bump', 'b1den']) {
        const result = checkContentGovernance(text);
        assert.equal(result.status, 'blocked', `expected block for ${JSON.stringify(text)}`);
        assert.ok(result.flags.includes('REAL_POLITICAL_FIGURE'));
    }
});

test('Governance detects common Cyrillic lookalike substitutions', () => {
    const result = checkContentGovernance('trumр'); // Cyrillic р in place of Latin p
    assert.equal(result.status, 'blocked');
    assert.ok(result.flags.includes('REAL_POLITICAL_FIGURE'));
});

test('Governance normalizes spaced Chinese terms without changing result contract', () => {
    const result = checkContentGovernance('斩 首');
    assert.equal(result.status, 'blocked');
    assert.ok(result.flags.includes('GRAPHIC_VIOLENCE_AND_HARM'));
    assert.ok(Array.isArray(result.reasons));
    assert.ok(Array.isArray(result.matchedRules));
});

test('Governance does not fuse adjacent words into a false positive', () => {
    // 早期实现先把空格标点全部删掉再 includes，导致：
    //   "multi-spectrum panoramic" → "...spectrumpanoramic..." 里凭空出现 "trump"
    //   "crisis" 含 "isis"、"computing" 含 "putin"
    // 合法内容被误判为真实政治人物，整条生成链路 502。
    const falsePositives = [
        'tactical high-cut helmet with integrated multi-spectrum panoramic night vision goggles',
        'crisis response operation',
        'high-performance computing cluster',
        'the trumpet sounded at dawn',
        'put in place a new doctrine'
    ];
    for (const text of falsePositives) {
        assert.equal(checkContentGovernance(text).status, 'passed', `误伤: ${text}`);
    }
});

test('Governance still catches separator-inserted evasion for single-word terms', () => {
    // 逐字插分隔符是真实存在的绕过手法，必须继续拦截
    for (const text of ['t r u m p', 't.r.u.m.p', 'p u t i n']) {
        assert.equal(checkContentGovernance(text).status, 'blocked', `漏检: ${text}`);
    }
});

test('Governance matches multi-word terms across word boundaries', () => {
    for (const text of ['al qaeda network', 'al-qaeda network', 'xi jinping speech']) {
        assert.equal(checkContentGovernance(text).status, 'blocked', `漏检: ${text}`);
    }
});

test('Governance handles common English morphology without over-blocking', () => {
    assert.equal(checkContentGovernance('genocides').status, 'blocked');
    assert.equal(checkContentGovernance('tortured prisoners').status, 'blocked');
    assert.equal(checkContentGovernance('decapitated').status, 'blocked');
});

// ---------------------------------------------------------------------------
// 对抗审查补测：同形字 / 全角 / leet 绕过面，以及资产描述误伤面。
// 这些用例来自「对抗审查」阶段对治理引擎的系统性攻击，属永久回归护栏。
// ---------------------------------------------------------------------------

test('Governance blocks homoglyph, full-width and leet evasions', () => {
    const evasions = [
        'рutin',        // 西里尔 р 冒充拉丁 p
        'putіn',        // 西里尔 і 冒充拉丁 i
        'put1n',        // leet：1 -> i
        'ｔｒｕｍｐ',      // 全角字母（NFKC 归一后应命中）
        'аl-qaeda'      // 西里尔 а 冒充拉丁 a
    ];
    for (const text of evasions) {
        assert.equal(
            checkContentGovernance(text).status,
            'blocked',
            '漏检同形/全角/leet 绕过: ' + JSON.stringify(text)
        );
    }
});

test('Governance does not fire on legitimate asset descriptions (误伤面回归)', () => {
    // 背景：早期实现把空格标点全部删掉再 includes(term)，导致
    // "multi-spectrum panoramic" 粘成 "...spectrumpanoramic..." 内含 "trump"，
    // 整段合法资产描述被误判为真实政治人物、整个 API 直接 502。
    const safe = [
        'multi-spectrum panoramic surveillance array',
        'crisis response unit',
        'quantum computing datalink node',
        'brass trumpet signal corps',
        'armour crew reloading main gun',
        'leadership crew of a tank',
        'method of entry via robotic platform',
        'specialist operator with CBRN training',
        'aerial reconnaissance drone swarm',
        'screwdriver set in the toolbag'
    ];
    for (const text of safe) {
        const r = checkContentGovernance(text);
        assert.equal(r.status, 'passed', '误伤合法描述: ' + text + ' -> ' + r.status + ' / ' + r.flags.join(','));
    }
});
