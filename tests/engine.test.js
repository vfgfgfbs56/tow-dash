import test from 'node:test';
import assert from 'node:assert/strict';
import { C, createGame, step, jump, kill, speedAt, distanceAt, timeAtDistance, botWantsJump, localColor, difficultyAt, jumpCue, worldY, worldGravity, isFlipping, activeFlight, botFlightHeld, setControl, makeBoostGroup, makeFakeGroup, roadAllowed, flightCorridor, verifyFlight, hits } from '../public/engine.js';

test('5 second countdown; speed starts at 2.0 and grows every 10 seconds for 6 minutes', () => {
  const g = createGame(7, 1);
  for (let n = 0; n < 599; n++) step(g);
  assert.equal(g.phase, 'countdown'); assert.equal(g.elapsed, 0);
  step(g); assert.equal(g.phase, 'running');
  assert.equal(speedAt(0), 2); assert.equal(speedAt(9.999), 2);
  assert.equal(speedAt(10), 2.1); assert.equal(speedAt(350), 5.5);
  assert.equal(speedAt(360), 5.5); assert.equal(C.DURATION, 360);
  assert.equal(distanceAt(10), 8000); assert.equal(distanceAt(20), 16400);
  for (const t of [0, 1, 9.99, 10, 200, 359]) assert.ok(Math.abs(timeAtDistance(distanceAt(t)) - t) < .00001);
});
test('two perspectives keep identity/order and invert only color', () => {
  for (const leader of [0, 1]) {
    const g = createGame(42, leader);
    assert.equal(g.players[leader].offset, C.SEPARATION);
    assert.equal(g.players[1 - leader].offset, 0);
    for (const self of [0, 1]) {
      assert.equal(localColor(self, self), '#00b5f1');
      assert.equal(localColor(1 - self, self), '#ff507e');
    }
  }
});
test('one player returns in exactly 6 seconds and gets a safe spawn shield', () => {
  const g = createGame(6); g.phase = 'running'; g.nextAt = 1000; g.obstacles = [];
  kill(g, 0);
  for (let n = 0; n < 719; n++) step(g);
  assert.equal(g.players[0].alive, false); assert.equal(g.players[1].alive, true);
  step(g); assert.equal(g.players[0].alive, true);
  assert.equal(g.elapsed, 6); assert.ok(g.players[0].shieldUntil >= 7.25);
  assert.equal(g.events.filter(e => e.type === 'respawn').length, 1);
});
test('both dead ends attempt; jump cannot move a dead player', () => {
  const g = createGame(8); g.phase = 'running'; kill(g, 0); kill(g, 1);
  jump(g, 0); step(g); assert.equal(g.phase, 'lost'); assert.equal(g.players[0].y, 0);
});
test('different seeds generate different tracks; same seed is deterministic', () => {
  assert.deepEqual(createGame(123), createGame(123));
  assert.notDeepEqual(createGame(123).obstacles, createGame(124).obstacles);
  assert.notDeepEqual(createGame(123).flips, createGame(124).flips);
});
test('ceiling gravity reverses world motion; transfers block jumping and preserve a 6 second respawn', () => {
  const g = createGame(18); g.phase = 'running'; g.nextAt = 1000; g.obstacles = []; g.groups = [];
  g.flips = [1]; kill(g, 0);
  for (let n = 0; n < 121; n++) step(g);
  assert.equal(g.roadSide, -1); assert.equal(worldGravity(g), -C.GRAVITY);
  assert.ok(isFlipping(g)); jump(g, 1); step(g); assert.equal(g.players[1].y, 0);
  while (g.elapsed < 2) step(g);
  const before = worldY(g, g.players[1]); jump(g, 1); step(g);
  assert.ok(worldY(g, g.players[1]) > before, 'a ceiling jump moves downward');
  while (g.elapsed < 6) step(g);
  assert.equal(g.players[0].alive, true); assert.equal(g.players[0].spawnAt, 6);
  assert.ok(g.players[0].shieldUntil >= 7.25); assert.equal(g.roadSide, -1);
  const copy = JSON.parse(JSON.stringify(g));
  for (let n = 0; n < 180; n++) { step(g, n === 0 ? [0] : []); step(copy, n === 0 ? [0] : []); }
  assert.deepEqual(g, copy, 'serialized network state uses the same simulation');
});
test('50 full races: boosts, traps, all 300 mazes, safe transitions and both timing-window boundaries', () => {
  let total = 0, boosts = 0; const kinds = new Set(), counts = [0, 0, 0, 0, 0, 0], assignments = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const g = createGame(seed * 91237, seed % 2); g.phase = 'running';
    assert.equal(g.flights.length, 6);
    for (let i = 0; i < 6; i++) {
      const f = g.flights[i];
      assert.ok(f.start >= i * 60 && f.end < (i + 1) * 60);
      assert.equal(Math.round(f.end / C.DT) - Math.round(f.start / C.DT), 1440); assert.deepEqual([...f.lanes].sort(), [0, 1]);
      assert.ok(f.clearance >= 12); assignments.add(f.lanes[0]);
      assert.ok(g.flips.every(t => t < f.start - 3 || t > f.end + 2));
    }
    const checked = new Set();
    for (let n = 0; n < C.DURATION / C.DT && g.phase === 'running'; n++) {
      for (const group of g.groups) if (!checked.has(group.id)) {
        checked.add(group.id);
        const d = difficultyAt(group.at), parts = g.obstacles.filter(o => o.group === group.id);
        assert.equal(parts.length, group.count);
        if (group.action === 'jump') assert.ok(group.count >= d.count[0] && group.count <= d.count[1]);
        total += parts.length; counts[d.tier] += parts.length;
        for (const cue of group.cues) assert.ok(cue.latest - cue.earliest >= (group.action === 'boost' ? .12 : d.window) - 1e-7);
        if (group.action === 'boost') { boosts++; assert.ok(group.h > C.JUMP ** 2 / (2 * C.GRAVITY) + 6); }
        const enter = timeAtDistance(group.x - C.SEPARATION - C.HIT_HALF);
        const leave = timeAtDistance(group.x + group.w + C.HIT_HALF);
        assert.ok(roadAllowed(g, enter, leave));
        for (const o of parts) {
          kinds.add(o.kind);
          assert.ok(o.x >= group.x && o.x + o.w <= group.x + group.w + 1e-7 && o.h <= group.h);
        }
      }
      for (const id of [0, 1]) {
        if (activeFlight(g)) { if (n % 8 === 0) setControl(g, id, botFlightHeld(g, id)); continue; }
        const cue = jumpCue(g, id);
        // Exercise both boundaries, not just one perfect bot trajectory.
        const launch = !cue ? Infinity : seed % 3 === 0 ? cue.earliest + C.DT : seed % 3 === 1 ? cue.latest - C.DT : cue.at;
        if (cue?.active && g.elapsed + C.DT >= launch) jump(g, id);
      }
      step(g);
    }
    assert.equal(g.phase, 'won', `seed ${seed} at ${g.elapsed}`);
    assert.deepEqual(g.players.map(p => p.deaths), [0, 0], `seed ${seed}`);
    assert.equal(g.elapsed, 360); assert.ok(g.flipIndex > 0); assert.equal(g.flightsCompleted, 6);
    assert.equal(g.roadSide, g.flipIndex % 2 ? -1 : 1);
  }
  assert.ok(total > 15000); assert.ok(boosts > 300); assert.equal(kinds.size, 6); assert.equal(assignments.size, 2);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1], `density minute ${i + 1}`);
  console.log(`Verified ${total} hazards, ${boosts} orb towers and 300 mazes; per-minute totals: ${counts.join(', ')}`);
});

function emptyGame() {
  const g = createGame(31); g.phase = 'running'; g.nextAt = 1000;
  g.flights = []; g.flips = []; g.groups = []; g.obstacles = []; g.orbs = [];
  return g;
}
test('yellow circle is required, automatic in air, and separately usable by both players', () => {
  for (const enabled of [true, false]) {
    const g = emptyGame(), pack = makeBoostGroup(g, 4);
    assert.ok(pack); g.groups = [pack.group]; g.obstacles = pack.parts; g.orbs = enabled ? [pack.orb] : [];
    let peak = 0;
    while (g.elapsed < 6 && g.phase === 'running') {
      for (let id = 0; id < 2; id++) if (botWantsJump(g, id)) jump(g, id);
      step(g); peak = Math.max(peak, ...g.players.map(p => p.y));
    }
    if (enabled) {
      assert.deepEqual(g.players.map(p => p.deaths), [0, 0]);
      assert.deepEqual(g.players.map(p => p.boosts), [1, 1]); assert.ok(peak > 300);
    } else { assert.equal(g.phase, 'lost'); assert.deepEqual(g.players.map(p => p.boosts), [0, 0]); }
  }
});
test('fake figure is harmless on the road and lethal when jumping over it, even above its roof', () => {
  for (const airborne of [false, true]) {
    const g = emptyGame(), pack = makeFakeGroup(g, 3);
    g.groups = [pack.group]; g.obstacles = pack.parts;
    assert.equal(hits(pack.group.x + 10, 0, pack.parts[0]), false);
    assert.equal(hits(pack.group.x + 10, pack.group.h + 100, pack.parts[0]), true);
    while (g.elapsed < 4 && g.phase === 'running') {
      if (airborne && Math.abs(g.elapsed - 2.7) < C.DT / 2) jump(g, g.leader);
      step(g);
    }
    assert.equal(g.players[g.leader].deaths, airborne ? 1 : 0);
  }
});
test('flight hold rises, release falls, wall contact kills, respawn returns inside own lane', () => {
  const g = createGame(91), f = g.flights[0];
  g.phase = 'running'; g.nextAt = 1000; g.obstacles = []; g.orbs = [];
  g.tick = Math.round(f.start / C.DT) - 1; step(g);
  assert.equal(g.flightActive, 0);
  while (g.elapsed < f.start + .6) step(g);
  g.players[1].shieldUntil = 1000;
  const p = g.players[0], original = p.flyY;
  setControl(g, 0, true); for (let i = 0; i < 12; i++) step(g);
  assert.ok(p.flyY < original - 20);
  const high = p.flyY; setControl(g, 0, false); for (let i = 0; i < 12; i++) step(g);
  assert.ok(p.flyY > high + 20);
  p.flyY = -100; step(g); assert.equal(p.alive, false);
  const death = g.elapsed;
  while (g.elapsed < death + 6 - C.DT / 2) step(g);
  assert.equal(p.alive, true); assert.ok(Math.abs(p.spawnAt - death - 6) < 1e-7);
  assert.ok(p.flyY > (p.flyLane ? 500 : 0) && p.flyY < (p.flyLane ? 1000 : 500));
  const copy = JSON.parse(JSON.stringify(g));
  for (let n = 0; n < 120; n++) {
    for (const state of [g, copy]) { for (let id = 0; id < 2; id++) setControl(state, id, botFlightHeld(state, id)); step(state); }
  }
  assert.deepEqual(g, copy);
});
