import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Renderer } from '../public/render.js';
import { C, createGame, distanceAt, makeBoostGroup } from '../public/engine.js';
import { levelsFromHtml } from '../public/levels.js';

test('the real canvas renderer draws spiked pillars, boss and bullets, remnant and narrow flight without runtime errors', () => {
  const calls = new Map();
  const labels = [];
  const ctx = new Proxy({}, { get(_target, key) {
    if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (key === 'fillText') return value => { labels.push(value); calls.set(key, (calls.get(key) || 0) + 1); };
    return (...args) => { calls.set(key, (calls.get(key) || 0) + 1); return undefined; };
  }, set() { return true; } });
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.devicePixelRatio = 1;
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 1440, height: 900 }) };
  const render = new Renderer(canvas), g = createGame(91237);
  g.phase = 'running'; g.elapsed = 10; g.distance = distanceAt(g.elapsed);
  g.obstacles = [
    { kind: 'step', x: g.distance + 250, w: 128, h: 192 },
    { kind: 'pit', x: g.distance + 370, w: 90, h: 29 },
    { kind: 'remnant', x: g.distance + 470, w: 105, h: 90 },
  ];
  g.groups = []; g.orbs = [];
  render.draw(g, 0, 1 / 60, 10);
  assert.ok(calls.get('strokeRect') >= 4, 'individual white pillar cells are drawn');
  assert.ok(calls.get('lineTo') >= 3, 'ground spikes are drawn');
  const boss = g.bosses[0], shot = boss.shots[0];
  g.elapsed = shot.at + .7; g.distance = distanceAt(g.elapsed); g.obstacles = [];
  const arcs = calls.get('arc') || 0;
  render.draw(g, 0, 1 / 60, g.elapsed);
  assert.ok((calls.get('arc') || 0) >= arcs + 2, 'boss face and bullet are drawn');
  const f = g.flights[0]; g.elapsed = f.start + 4; g.distance = distanceAt(g.elapsed);
  g.flightActive = 0; render.draw(g, 0, 1 / 60, g.elapsed);
  assert.ok(calls.get('clip') >= 2, 'flight corridor clips its background');
  g.flightActive = -1;
  const pack = makeBoostGroup(g, 4);
  assert.ok(pack); g.groups = [pack.group]; g.obstacles = pack.parts; g.orbs = [pack.orb];
  const cue = pack.group.cues[g.players[0].offset === 0 ? 0 : 1];
  g.elapsed = cue.at; g.distance = distanceAt(g.elapsed);
  render.draw(g, 0, 1 / 60, g.elapsed);
  assert.ok(labels.includes('ПРЫГАЙ'), 'the orb timing cue is visible at the launch point');
});

test('yellow orb keeps its launch marker visible before and after the jump cue', () => {
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.devicePixelRatio = 1;
  const ctx = new Proxy({}, { get(_target, key) {
    if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  }, set() { return true; } });
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 1440, height: 900 }) };
  const render = new Renderer(canvas), g = createGame(91237), pack = makeBoostGroup(g, 4);
  assert.ok(pack); g.phase = 'running'; g.groups = [pack.group]; g.obstacles = pack.parts; g.orbs = [pack.orb];
  assert.equal(pack.orb.launchXs.length, 2);
  const markers = [], original = render.orbLaunchMarker.bind(render);
  render.orbLaunchMarker = (...args) => { markers.push(args); original(...args); };
  for (const self of [0, 1]) {
    const cue = pack.group.cues[g.players[self].offset === 0 ? 0 : 1];
    for (const offset of [-.2, .12]) {
      g.elapsed = cue.at + offset; g.distance = distanceAt(g.elapsed);
      const prior = markers.length;
      render.draw(g, self, 1 / 60, g.elapsed);
      assert.ok(markers.length > prior, `player ${self} sees the marker at ${offset}s from cue`);
    }
  }
});

test('stair blocks have square outlines and no inner dots', () => {
  const outlined = [], filled = [];
  const ctx = new Proxy({}, { get(_target, key) {
    if (key === 'strokeRect') return (...args) => outlined.push(args);
    if (key === 'fillRect') return (...args) => filled.push(args);
    return () => {};
  }, set() { return true; } });
  const renderer = { ctx };
  Renderer.prototype.obstacle.call(renderer, { kind: 'step', w: 128, h: 192 }, 10, 0, 1, 0);
  assert.equal(outlined.length, 6);
  for (const [_x, _y, width, height] of outlined) assert.equal(width, height);
  assert.deepEqual(filled, [[10, -192, 128, 192]], 'only the black backing is filled');
});

test('the tenth flight has a valid palette on the ten-minute level', () => {
  const level = levelsFromHtml(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'))[5];
  const ctx = new Proxy({}, { get(_target, key) {
    if (key === 'createLinearGradient') return () => ({ addColorStop(_position, color) {
      assert.match(color, /^#[a-f0-9]{6}$/i);
    } });
    return () => {};
  }, set() { return true; } });
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.devicePixelRatio = 1;
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 1440, height: 900 }) };
  const renderer = new Renderer(canvas), game = createGame(12345, 0, level);
  game.phase = 'running'; game.flightActive = 9;
  game.elapsed = game.flights[9].start + 3; game.distance = distanceAt(game.elapsed, level);
  renderer.draw(game, 0, 1 / 60, game.elapsed);
});
