import test from 'node:test';
import assert from 'node:assert/strict';
import { transpileMovieToLego, CINEMA_DATABASE } from '../src/domain/cinema-homage.js';
import { parseIntent } from '../src/domain/intent.js';
import { validateContinuityChain } from '../src/domain/continuity.js';

test('Cinema homage: database contains classic military and sci-fi films', () => {
  assert.ok(CINEMA_DATABASE.length >= 7);
  const titles = CINEMA_DATABASE.map(c => c.title);
  assert.ok(titles.some(t => t.includes('壮志凌云')));
  assert.ok(titles.some(t => t.includes('地心引力')));
  assert.ok(titles.some(t => t.includes('黑鹰坠落')));
  assert.ok(titles.some(t => t.includes('明日边缘')));
});

test('Cinema homage: transpile Top Gun accurately generates 4 shots with director notes', () => {
  const result = transpileMovieToLego('壮志凌云', 4);
  assert.ok(result.matchedMovie.includes('壮志凌云'));
  assert.equal(result.shots.length, 4);
  assert.ok(result.visualGrammar.cameraMotion.includes('超低空'));
  assert.ok(result.creatorTips.includes('前3秒'));
  assert.ok(result.shots[0].action.includes('隐形五代战机'));
  assert.ok(result.shots[0].radioVoice.includes('无线电'));
});

test('Cinema homage: transpile Gravity outputs space station orbital shots', () => {
  const result = transpileMovieToLego('地心引力', 4);
  assert.ok(result.matchedMovie.includes('地心引力'));
  assert.ok(result.shots[0].action.includes('空间站') || result.shots[0].action.includes('宇航员'));
  assert.ok(result.visualGrammar?.soundDesign?.includes('寂静') || result.visualGrammar?.soundDesign?.includes('静音'));
});

test('Cinema homage: transpiled shots pass continuity validation without MISSING_REFERENCE_FRAME', () => {
  const result = transpileMovieToLego('黑鹰坠落', 8);
  const val = validateContinuityChain(result.shots);
  assert.equal(val.ok, true);
  assert.equal(val.violations.length, 0);
  assert.equal(result.shots[1].referenceFrame, 'shot_1_end_frame');
  assert.equal(result.era, 'Modern');
});

test('Intent parser: recognizes orbital and space keywords', () => {
  const intent = parseIntent('宇航员在近地轨道空间站外壁维修太阳能电池翼');
  assert.equal(intent.era, 'Orbital');
  assert.equal(intent.setting, 'space');
  assert.equal(intent.governance.status, 'passed');
});

test('Intent parser: recognizes modern high-tech stealth fighter and drone swarm', () => {
  const intent = parseIntent('隐形战机协同无人机蜂群执行突防空战');
  assert.equal(intent.era, 'Modern High-Tech');
  assert.equal(intent.governance.status, 'passed');
});
