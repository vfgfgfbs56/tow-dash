import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../public/render.js';
import { C, createGame, distanceAt } from '../public/engine.js';

test('the real canvas renderer draws spiked pillars, boss and bullets, remnant and narrow flight without runtime errors', () => {
  const calls = new Map();
  const ctx = new Proxy({}, { get(_target, key) {
    if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
    return (...args) => { calls.set(key, (calls.get(key) || 0) + 1); return undefined; };
  }, set() { return true; } });
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.devicePixelRatio = 1;
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 1440, height: 900 }) };
  const render = new Renderer(canvas), g = createGame(91237);
  g.phase = 'running'; g.elapsed = 10; g.distance = distanceAt(g.elapsed);
  g.obstacles = [
    { kind: 'step', x: g.distance + 250, w: 120, h: 190, cells: 3 },
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
});
