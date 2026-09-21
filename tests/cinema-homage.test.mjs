import test from 'node:test';
import assert from 'node:assert/strict';
import { transpileMovieToLego, CINEMA_DATABASE } from '../src/domain/cinema-homage.js';
import { parseIntent } from '../src/domain/intent.js';

test('Cinema homage: database contains classic military and sci-fi films', () => {
  assert.ok(CINEMA_DATABASE.length >= 8);
  const titles = CINEMA_DATABASE.map(c => c.title);
  assert.ok(titles.includes('壮志凌云：独行侠'));
  assert.ok(titles.includes('地心引力'));
  assert.ok(titles.includes('黑鹰坠落'));
  assert.ok(titles.includes('明日边缘'));
});

test('Cinema homage: transpile Top Gun accurately generates 4 shots with director notes', () => {
  const result = transpileMovieToLego('壮志凌云', 4);
  assert.equal(result.matchedMovie, '壮志凌云：独行侠');
  assert.equal(result.era, 'Modern High-Tech');
  assert.equal(result.shots.length, 4);
  assert.ok(result.directorNotes.pedagogyLesson.includes('景别拉片教学'));
  assert.ok(result.directorNotes.visualStyle.includes('超低空'));
  assert.ok(result.shots[0].action.includes('隐形五代战机'));
});

test('Cinema homage: transpile Gravity outputs space station orbital shots', () => {
  const result = transpileMovieToLego('地心引力', 4);
  assert.equal(result.matchedMovie, '地心引力');
  assert.equal(result.era, 'Orbital');
  assert.ok(result.shots[0].action.includes('近地轨道空间站外壁'));
  assert.ok(result.directorNotes.audioScore.includes('真空完全静音'));
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
