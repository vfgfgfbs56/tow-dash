import test from 'node:test';
import assert from 'node:assert/strict';
import { C, createGame, step, jump, kill, speedAt, distanceAt, timeAtDistance, botWantsJump, localColor, difficultyAt, jumpCue, worldY, worldGravity, isFlipping, activeFlight, activeBoss, bulletHits, bulletImpact, botFlightHeld, setControl, makeBoostGroup, makeFakeGroup, roadAllowed, flightCorridor, flightClearance, verifyFlight, hits, makeStairs, trapHeight, moveRunner } from '../public/engine.js';

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
test('50 full races: random ladders and rings, 16-shot bosses, short transitions, all 300 mazes', () => {
  let total = 0, boosts = 0, stairs = 0, stacks = 0, close = 0, shortenedPairs = 0, threeBlockGaps = 0, remnants = 0;
  const kinds = new Set(), counts = [0, 0, 0, 0, 0, 0], assignments = new Set(), narrow = [], wide = [], pillarCounts = new Set(), ringCounts = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const g = createGame(seed * 91237, seed % 2); g.phase = 'running';
    assert.equal(g.flights.length, 6);
    for (let i = 0; i < 6; i++) {
      const f = g.flights[i];
      assert.ok(f.start >= i * 60 && f.end < (i + 1) * 60);
      assert.equal(Math.round(f.end / C.DT) - Math.round(f.start / C.DT), 1440); assert.deepEqual([...f.lanes].sort(), [0, 1]);
      assert.ok(f.clearance >= 10); assignments.add(f.lanes[0]);
      assert.ok(f.widthRange[0] < 80 && f.widthRange[1] >= 130);
      narrow.push(f.widthRange[0]); wide.push(f.widthRange[1]);
      assert.ok(g.flips.every(t => t + C.FLIP_DURATION <= f.start - 1.5 + 1e-7 || t >= f.end + 1.5 - 1e-7));
    }
    assert.ok(g.flights.filter(f => g.flips.some(t => Math.abs(t - f.end - 1.5) < .01
      || Math.abs(t + C.FLIP_DURATION + 1.5 - f.start) < .01)).length >= 5);
    assert.equal(g.bosses.length, 3);
    for (const boss of g.bosses) {
      assert.ok(boss.start > 120 && boss.end < 355);
      assert.ok(Math.abs(boss.end - boss.start - 16) < 1e-8); assert.equal(boss.shots.length, 16);
      assert.ok(g.flights.every(f => boss.start >= f.end + 1.5 - 1e-7 || boss.end <= f.start - 3.2 + 1e-7));
      assert.ok(g.flips.every(t => t + C.FLIP_DURATION <= boss.start - 1.5 + 1e-7 || t >= boss.end + 3.2 - 1e-7));
      assert.equal(new Set(boss.shots.map(s => s.factor)).size, 16);
      for (let n = 1; n < boss.shots.length; n++) assert.ok(boss.shots[n].at - boss.shots[n - 1].at <= 1);
      for (let t = boss.start; t < boss.end; t += .1)
        assert.ok(boss.shots.filter(s => t >= s.at && t < s.at + C.BULLET_LIFE).length <= 2);
      for (const shot of boss.shots) for (let i = 0; i < 2; i++) {
        const impact = bulletImpact(shot, i ? C.SEPARATION : 0);
        assert.ok(impact > shot.at && impact < shot.at + 2);
      }
    }
    const checked = new Set(), ready = [0, 0]; let previous = null;
    for (let n = 0; n < C.DURATION / C.DT && g.phase === 'running'; n++) {
      for (const group of g.groups) if (!checked.has(group.id)) {
        checked.add(group.id);
        const d = difficultyAt(group.at), parts = g.obstacles.filter(o => o.group === group.id);
        if (group.action === 'jump' && group.boss === undefined) {
          const row = [...parts].sort((a, b) => a.x - b.x);
          for (let i = 1; i < row.length; i++) {
            const gap = row[i].x - row[i - 1].x - row[i - 1].w;
            if (gap >= C.SIZE * 2.8 && gap <= C.SIZE * 3.2) threeBlockGaps++;
          }
        }
        assert.equal(parts.length, group.count);
        if (group.action === 'jump' && group.boss === undefined) assert.ok(group.count >= d.count[0] && group.count <= d.count[1]);
        total += parts.length; counts[d.tier] += parts.length;
        const allCues = group.stages ? group.stages.flatMap(s => s.cues) : group.cues;
        for (const cue of allCues) assert.ok(cue.latest - cue.earliest >= (['boost', 'stairs'].includes(group.action) ? .12 : d.window) - 1e-7);
        for (let i = 0; i < 2; i++) {
          assert.ok(group.starts[i] >= ready[i] + .035 - 1e-7, 'a preceding group leaves time to land');
          ready[i] = group.ends[i];
        }
        if (group.boss === undefined) assert.ok(roadAllowed(g, Math.min(...group.starts), Math.max(...group.ends)));
        stairs += group.action === 'stairs'; close += !!group.close;
        if (group.action === 'stairs') {
          pillarCounts.add(group.pillarCount); ringCounts.add(group.orbCount);
          assert.ok(group.pillarCount >= 3 && group.pillarCount <= 6);
          assert.ok(group.orbCount >= 1 && group.orbCount <= 4);
          assert.equal(parts.filter(o => o.kind === 'pit').length, group.pillarCount - 1);
        }
        stacks += parts.filter(o => o.kind === 'stack').length;
        remnants += group.boss !== undefined;
        if (previous?.action === 'jump' && group.action === 'jump' && previous.boss === undefined && group.boss === undefined
          && group.at - previous.at < difficultyAt(previous.at).gap[0] * .9) shortenedPairs++;
        previous = group;
        if (group.action === 'boost') { boosts++; assert.ok(group.h > C.JUMP ** 2 / (2 * C.GRAVITY) + 6); }
        const enter = timeAtDistance(group.x - C.SEPARATION - C.HIT_HALF);
        const leave = timeAtDistance(group.x + group.w + C.HIT_HALF);
        if (group.boss === undefined) assert.ok(roadAllowed(g, enter, leave));
        for (const o of parts) {
          kinds.add(o.kind);
          assert.ok(o.x >= group.x && o.x + o.w <= group.x + group.w + 1e-7 && o.h <= group.h);
        }
      }
      for (const id of [0, 1]) {
        if (activeFlight(g)) { if (n % 8 === 0) setControl(g, id, botFlightHeld(g, id)); continue; }
        const cue = jumpCue(g, id);
        // Exercise both boundaries, not just one perfect bot trajectory.
        const launch = !cue ? Infinity : (seed + id + (cue.height ? Math.round(cue.height) : 0)) % 3 === 0 ? cue.earliest + C.DT : (seed + id) % 3 === 1 ? cue.latest - C.DT : cue.at;
        if (cue?.active && g.elapsed + C.DT >= launch) jump(g, id);
      }
      step(g);
    }
    assert.equal(g.phase, 'won', `seed ${seed} at ${g.elapsed}`);
    assert.deepEqual(g.players.map(p => p.deaths), [0, 0], `seed ${seed}`);
    assert.equal(g.elapsed, 360); assert.ok(g.flipIndex > 0); assert.equal(g.flightsCompleted, 6);
    assert.equal(g.bossesCompleted, 3); assert.ok(g.bosses.every(b => b.remnantAdded));
    assert.equal(g.roadSide, g.flipIndex % 2 ? -1 : 1);
  }
  assert.ok(total > 8000); assert.ok(boosts > 250); assert.ok(stairs > 250); assert.ok(stacks > 130); assert.ok(close > 500);
  assert.equal(kinds.size, 10); assert.equal(assignments.size, 2); assert.equal(remnants, 150);
  assert.deepEqual([...pillarCounts].sort(), [3, 4, 5, 6]);
  assert.deepEqual([...ringCounts].sort(), [1, 2, 3, 4]);
  assert.ok(Math.min(...narrow) < 75 && Math.max(...wide) > 145);
  assert.ok(shortenedPairs >= 50, 'shorter spacings survive the physics checks, not just the random choice');
  assert.ok(threeBlockGaps >= 50, 'three-cube gaps exist inside verified one-jump groups');
  assert.ok(counts[5] > counts[0], 'final minute has more figures despite boss/flight intervals');
  for (let i = 1; i < counts.length; i++) {
    assert.ok(difficultyAt(i * 60).count[0] >= difficultyAt((i - 1) * 60).count[0]);
    assert.ok(difficultyAt(i * 60).gap[0] < difficultyAt((i - 1) * 60).gap[0]);
  }
  console.log(`Verified ${total} figures, ${boosts} orb obstacles (${stacks} double stacks), ${stairs} varied ladders, ${threeBlockGaps} three-cube gaps, ${shortenedPairs} close group pairs, 300 mazes and 150 bosses × 16 shots; per-minute totals: ${counts.join(', ')}`);
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
test('red trap rises before a jumping player dies; ground-level teammate is safe', () => {
  for (const airborne of [false, true]) {
    const g = emptyGame(), pack = makeFakeGroup(g, 3), o = pack.parts[0];
    g.groups = [pack.group]; g.obstacles = pack.parts;
    assert.equal(trapHeight(o, 0), 0);
    assert.equal(hits(o.x + o.w / 2, 200, o, 0), false, 'no invisible instant-kill column');
    let triggeredAt = null, diedAt = null;
    while (g.elapsed < 4 && g.phase === 'running') {
      if (airborne && Math.abs(g.elapsed - 2.7) < C.DT / 2) jump(g, g.leader);
      step(g);
      if (o.strikes[g.leader] && triggeredAt === null) triggeredAt = g.elapsed;
      if (!g.players[g.leader].alive && diedAt === null) diedAt = g.elapsed;
    }
    assert.equal(g.players[g.leader].deaths, airborne ? 1 : 0);
    assert.equal(g.players[1 - g.leader].deaths, 0);
    if (airborne) {
      assert.ok(diedAt > triggeredAt, 'the visible spike extends before collision');
      assert.ok(trapHeight(o, diedAt) > 30);
      assert.equal(hits(o.x + o.w / 2, 0, o, triggeredAt + C.TRAP_RISE), false);
      assert.equal(trapHeight(o, triggeredAt + 1), 0, 'trap retracts');
    } else assert.deepEqual(o.strikes, [null, null]);
  }
});
test('boss fires sixteen shots faster than once a second: low shots require jumps, high shots pass above', () => {
  for (const jumping of [false, true]) {
    const g = emptyGame();
    const boss = g.bosses[0], low = boss.shots[0], high = boss.shots[1];
    g.tick = Math.round(boss.start / C.DT); g.elapsed = boss.start;
    g.distance = distanceAt(g.elapsed); g.players[1].shieldUntil = 1000;
    let sawCue = false;
    while (g.elapsed < low.at + 2.5 && g.phase === 'running') {
      const cue = jumpCue(g, 0);
      if (cue?.group === `boss-${boss.id}`) sawCue = true;
      if (jumping && cue?.active && g.elapsed + C.DT >= cue.at) jump(g, 0);
      step(g);
    }
    assert.ok(sawCue); assert.equal(g.players[0].deaths, jumping ? 0 : 1);
    const impact = bulletImpact(high, g.players[0].offset);
    assert.equal(bulletHits(distanceAt(impact) + g.players[0].offset, 0, high, impact), false);
    assert.equal(activeBoss(g)?.id, boss.id);
  }
});
test('stair tops support both players, allow repeated jumps and a safe descent on either road side', () => {
  for (const side of [1, -1]) {
    const g = emptyGame(), pack = makeStairs(g, 3);
    assert.ok(pack); g.roadSide = side; g.flipFrom = side;
    g.groups = [pack.group]; g.obstacles = pack.parts; g.orbs = pack.orbs;
    assert.equal(pack.parts.filter(o => o.kind === 'step').length, pack.group.pillarCount);
    assert.equal(pack.parts.filter(o => o.kind === 'pit').length, pack.group.pillarCount - 1);
    assert.equal(pack.orbs.length, pack.group.orbCount);
    assert.ok(pack.group.h > C.JUMP ** 2 / (2 * C.GRAVITY) + pack.parts[0].h);
    const landed = [new Set(), new Set()];
    while (g.elapsed < Math.max(...pack.group.ends) + .2) {
      for (let id = 0; id < 2; id++) if (botWantsJump(g, id)) jump(g, id);
      step(g);
      for (const p of g.players) if (p.grounded && p.y > 0) landed[p.id].add(p.y);
    }
    for (const p of g.players) {
      assert.equal(p.deaths, 0); assert.equal(p.y, 0); assert.equal(p.grounded, true);
      assert.deepEqual([...landed[p.id]].sort((a,b) => a-b), [...new Set(pack.group.stages.map(s => s.height))].sort((a,b) => a-b));
      assert.equal(p.jumps, pack.group.stages.length); assert.equal(p.boosts, pack.orbs.length);
    }
    const still = { y: pack.parts[0].h, vy: 0, grounded: true };
    moveRunner(still, pack.parts[0].x + 80, pack.parts);
    assert.equal(still.y, pack.parts[0].h); assert.equal(still.grounded, true);
    for (const block of pack.parts.filter(o => o.kind === 'step')) {
      assert.equal(block.w % C.SIZE, 0); assert.equal(block.h % C.SIZE, 0);
    }
    for (const orb of pack.orbs) {
      assert.equal(orb.launchXs.length, 2);
      assert.ok(pack.group.stages.some(stage => stage.orbId === orb.id && stage.fromHeight === orb.launchHeight));
    }
  }
  const g = emptyGame(), pack = makeStairs(g, 3);
  g.groups = [pack.group]; g.obstacles = pack.parts;
  while (g.elapsed < 4 && g.phase === 'running') step(g);
  assert.equal(g.phase, 'lost', 'walking into a vertical stair face is lethal');
});
test('respawning over a spiked stair gap lands on the next platform instead of dying immediately', () => {
  const g = emptyGame(), pack = makeStairs(g, 8);
  assert.ok(pack); g.bosses = []; g.groups = [pack.group]; g.obstacles = pack.parts; g.orbs = pack.orbs;
  const [first, second] = pack.parts.filter(o => o.kind === 'step');
  const target = timeAtDistance((first.x + first.w + second.x) / 2 - g.players[0].offset);
  g.tick = Math.round((target - 6) / C.DT); g.elapsed = g.tick * C.DT; g.distance = distanceAt(g.elapsed);
  g.players[1].shieldUntil = 1000;
  kill(g, 0);
  while (!g.players[0].alive && g.phase === 'running') step(g);
  assert.ok(Math.abs(g.elapsed - target) < .08);
  assert.equal(g.players[0].y, pack.group.stages[1].height);
  assert.ok(g.players[0].respawnHoldUntil >= g.elapsed);
  assert.ok(g.players[0].shieldUntil > Math.max(...pack.group.ends));
  while (g.elapsed < Math.max(...pack.group.ends) + .5) step(g);
  assert.equal(g.players[0].deaths, 1);
  assert.equal(g.players[0].alive, true);
});
test('respawning inside a narrow flight enters a safe lane and is guided until first input', () => {
  const g = createGame(91), f = g.flights[0];
  g.phase = 'running'; g.nextAt = 1000; g.obstacles = []; g.groups = []; g.orbs = []; g.flips = []; g.bosses = [];
  g.tick = Math.round((f.start + 1) / C.DT); g.elapsed = g.tick * C.DT; g.distance = distanceAt(g.elapsed);
  g.flightActive = 0;
  for (const p of g.players) { p.flyLane = f.lanes[p.id]; p.flyY = flightCorridor(f, 1, p.flyLane).center; }
  g.players[1].shieldUntil = 1000;
  kill(g, 0);
  while (!g.players[0].alive && g.phase === 'running') {
    setControl(g, 1, botFlightHeld(g, 1)); step(g);
  }
  const p = g.players[0];
  assert.ok(p.spawnAssist);
  assert.ok(flightClearance(f, timeAtDistance(g.distance + p.offset) - f.start, p.flyLane, p.flyY) >= 0);
  while (g.elapsed < f.end + .1) { setControl(g, 1, botFlightHeld(g, 1)); step(g); }
  assert.equal(p.deaths, 1); assert.equal(p.alive, true);
  assert.equal(p.spawnAssist, false);
});
test('a double stacked block is too high without the yellow orb', () => {
  for (const enabled of [false, true]) {
    const g = emptyGame(), pack = makeBoostGroup(g, 4, 'stack');
    assert.ok(pack); assert.equal(pack.parts[0].kind, 'stack');
    g.groups = [pack.group]; g.obstacles = pack.parts; g.orbs = enabled ? [pack.orb] : [];
    while (g.elapsed < 6 && g.phase === 'running') {
      for (let id = 0; id < 2; id++) if (botWantsJump(g, id)) jump(g, id);
      step(g);
    }
    assert.deepEqual(g.players.map(p => p.deaths), enabled ? [0, 0] : [1, 1]);
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
