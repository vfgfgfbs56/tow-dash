// Shared deterministic, fixed-step simulation. Cloudflare is authoritative.
import { DEFAULT_LEVEL } from './levels.js';
export const C = Object.freeze({
  VERSION: 8, DT: 1 / 120, DURATION: 360, COUNTDOWN: 5, RESPAWN: 6,
  SIZE: 64, HIT_HALF: 26, GRAVITY: 2800, JUMP: 1080,
  BASE_SPEED: 400, START_SPEED: 2, SPEED_STEP: 0.1,
  SPEED_EVERY: 10, SEPARATION: 172, SHIELD: 1.25,
  FLIP_DURATION: .65, FLIP_BEFORE: 1.5, FLIP_AFTER: 1.5,
  BOOST: 1470, ORB_RADIUS: 34, FAKE_CLEARANCE: 12,
  TRAP_RISE: .12, TRAP_HOLD: .24, TRAP_FALL: .28,
  FLY_DURATION: 12, FLY_ENTRY: .55, FLY_SPEED: 220,
  FLY_RADIUS: 22, FLY_HALF_TIME: .035,
  FLY_BEFORE: 1.5, FLY_AFTER: 1.5,
  BOSS_DURATION: 16, BOSS_BEFORE: 1.5, BOSS_AFTER: 3.4,
  BULLET_LIFE: 1.35, BOSS_SHOTS: 16, SHOT_INTERVAL: .9,
});
export const FLIGHT = 2 * C.JUMP / C.GRAVITY;
export function speedAt(t, level = DEFAULT_LEVEL) {
  const steps = level.duration / C.SPEED_EVERY - 1;
  const index = Math.floor(Math.max(0, Math.min(t, level.duration - 1e-7)) / C.SPEED_EVERY);
  return level.startSpeed + (level.endSpeed - level.startSpeed) * index / steps;
}
export function distanceAt(t, level = DEFAULT_LEVEL) {
  t = Math.max(0, Math.min(level.duration, t));
  const steps = Math.floor(t / C.SPEED_EVERY), rest = t - steps * C.SPEED_EVERY;
  const increment = (level.endSpeed - level.startSpeed) / (level.duration / C.SPEED_EVERY - 1);
  return C.BASE_SPEED * (C.SPEED_EVERY * (steps * level.startSpeed + increment * steps * (steps - 1) / 2) + rest * (level.startSpeed + steps * increment));
}
export function timeAtDistance(x, level = DEFAULT_LEVEL) {
  if (x <= 0) return 0;
  let lo = 0, hi = level.duration + 1;
  for (let i = 0; i < 28; i++) {
    const m = (lo + hi) / 2;
    if (distanceAt(m, level) < x) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
export function random(g) {
  let x = g.rng | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  g.rng = x >>> 0;
  return g.rng / 4294967296;
}
export function heightAfter(t) {
  return Math.max(0, C.JUMP * t - .5 * C.GRAVITY * t * t);
}
export function playerX(g, p) { return g.distance + p.offset; }
export function localColor(id, self) { return id === self ? '#00b5f1' : '#ff507e'; }
const DIFFICULTY = [
  { gap: [1.4, 1.8], count: [1, 2], height: [40, 76], window: .20 },
  { gap: [1.25, 1.55], count: [2, 3], height: [44, 84], window: .19 },
  { gap: [1.13, 1.38], count: [2, 4], height: [48, 92], window: .18 },
  { gap: [1.02, 1.26], count: [3, 4], height: [52, 100], window: .17 },
  { gap: [.95, 1.12], count: [3, 5], height: [54, 108], window: .16 },
  { gap: [.9, 1.02], count: [4, 5], height: [58, 112], window: .15 },
];
export function difficultyAt(t) {
  const tier = Math.max(0, Math.min(5, Math.floor(t / 60)));
  return { tier, ...DIFFICULTY[tier] };
}
export function isFlipping(g) { return g.elapsed - g.flipAt < C.FLIP_DURATION; }
// Screen-space gravity points down on the floor and up on the ceiling.
// y/vy stay in local coordinates measured away from the current road.
export function worldY(g, p, floor = 0, ceiling = -400) {
  return (g.roadSide === 1 ? floor : ceiling) - g.roadSide * (p.y + C.SIZE / 2);
}
export function worldGravity(g) { return g.roadSide * C.GRAVITY; }
export function activeFlight(g) { return g.flightActive >= 0 ? g.flights[g.flightActive] : null; }
export function flightProgress(f, elapsed, offset = 0) {
  return timeAtDistance(distanceAt(elapsed, f.level) + offset, f.level) - f.start;
}
// Independent upper/lower corridors, in a 1000-unit vertical playfield.
// Every wall edge used by the renderer is also used by collision detection.
export function flightCorridor(f, t, lane) {
  const points = f.paths[lane];
  let a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length; i++) if (t <= points[i].t) { b = points[i]; a = points[i - 1]; break; }
  const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  const center = a.y + (b.y - a.y) * u, half = a.half + (b.half - a.half) * u;
  return { center, top: center - half, bottom: center + half };
}
export function flightClearance(f, t, lane, y) {
  let result = Infinity;
  for (const q of [t - C.FLY_HALF_TIME, t, t + C.FLY_HALF_TIME]) {
    const b = flightCorridor(f, q, lane);
    result = Math.min(result, y - C.FLY_RADIUS - b.top, b.bottom - y - C.FLY_RADIUS);
  }
  return result;
}
export function flightSpawnY(f, t, lane) {
  let low = -Infinity, high = Infinity;
  for (const q of [t - C.FLY_HALF_TIME, t, t + C.FLY_HALF_TIME, t + .09]) {
    const b = flightCorridor(f, q, lane);
    low = Math.max(low, b.top + C.FLY_RADIUS + 8);
    high = Math.min(high, b.bottom - C.FLY_RADIUS - 8);
  }
  return low <= high ? (low + high) / 2 : flightCorridor(f, t, lane).center;
}
function followCorridor(f, t, lane, y, held) {
  const target = flightCorridor(f, t + .08, lane).center;
  return y > target + 12 ? true : y < target - 12 ? false : held;
}
export function verifyFlight(f, offset, lane, controlEvery = 1) {
  let y = flightCorridor(f, flightProgress(f, f.start, offset), lane).center;
  let held = false, clearance = Infinity;
  for (let n = 1; n < C.FLY_DURATION / C.DT; n++) {
    const t = flightProgress(f, f.start + n * C.DT, offset);
    if (n * C.DT < C.FLY_ENTRY) y = flightCorridor(f, t, lane).center;
    else {
      if (n % controlEvery === 0) held = followCorridor(f, t, lane, y, held);
      y += (held ? -1 : 1) * C.FLY_SPEED * C.DT;
    }
    clearance = Math.min(clearance, flightClearance(f, t, lane, y));
  }
  return clearance;
}
export function makeFlight(g, minute) {
  // Short four-minute races need room for three bosses after minute two.
  const shortRace = g.level.duration <= 240 && minute >= 2;
  const flightWindow = shortRace ? 3 : 32;
  const start = Math.round((minute * 60 + (shortRace && minute === 3 ? 23 : 10) + random(g) * flightWindow) / C.DT) * C.DT;
  const top = random(g) < .5 ? 0 : 1;
  const f = { id: minute, start, end: start + C.FLY_DURATION, level: g.level, lanes: [top, 1 - top], paths: [] };
  for (let lane = 0; lane < 2; lane++) {
    const base = lane ? 750 : 250;
    const points = [{ t: -1, y: base, half: 126 }, { t: 1.25, y: base, half: 118 }];
    let t = 1.25, y = base, sign = random(g) < .5 ? -1 : 1;
    while (t < C.FLY_DURATION + 3) {
      const span = .75 + random(g) * .45;
      t += span;
      const next = y + sign * (75 + random(g) * 55) * span;
      y = Math.max(base - 120, Math.min(base + 120, next));
      const narrow = points.length % 5 === 3, wide = points.length % 5 === 0;
      const half = wide ? 130 + random(g) * 25 : narrow ? 61 + random(g) * 13 : 78 + random(g) * 40 - minute * 2;
      points.push({ t, y, half });
      // Zigzags interleaved with longer diagonal chambers.
      if (Math.abs(y - base) > 95 || random(g) < .72) sign *= -1;
    }
    f.paths.push(points);
  }
  // Prove both lane assignments at both horizontal positions at 15 Hz input.
  let clearance = Math.min(...[0, C.SEPARATION].flatMap(offset => [0, 1].map(lane => verifyFlight(f, offset, lane, 8))));
  if (clearance < 10) {
    for (let lane = 0; lane < 2; lane++) for (const p of f.paths[lane]) {
      const base = lane ? 750 : 250;
      p.y = base + (p.y - base) * .78; p.half += 12;
    }
    clearance = Math.min(...[0, C.SEPARATION].flatMap(offset => [0, 1].map(lane => verifyFlight(f, offset, lane, 8))));
  }
  if (clearance < 10) throw new Error('Flight route has no verified clearance');
  f.clearance = Math.floor(clearance * 100) / 100;
  f.widthRange = [Math.min(...f.paths.flat().map(p => p.half)), Math.max(...f.paths.flat().map(p => p.half))];
  return f;
}
export function bulletX(b, t) {
  const v = C.BASE_SPEED * speedAt(b.at, b.level);
  return distanceAt(b.at, b.level) + C.SEPARATION + v * 1.25 - v * b.factor * Math.max(0, t - b.at);
}
export function bulletImpact(b, offset) {
  let lo = b.at, hi = b.at + 3;
  for (let n = 0; n < 28; n++) {
    const mid = (lo + hi) / 2;
    if (bulletX(b, mid) - distanceAt(mid, b.level) - offset > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
export function bulletHits(x, y, b, t) {
  if (t < b.at || t > b.at + C.BULLET_LIFE) return false;
  const dx = Math.max(0, Math.abs(x - bulletX(b, t)) - C.HIT_HALF);
  const dy = Math.max(0, Math.abs(y + C.SIZE / 2 - b.y) - C.SIZE / 2);
  return dx * dx + dy * dy < b.r * b.r;
}
export function activeBoss(g) { return g.bosses.find(b => g.elapsed >= b.start && g.elapsed < b.end) || null; }
function makeBosses(g) {
  const bosses = [];
  const shortStarts = g.level.duration <= 240 ? (() => {
    const first = g.flights[2].end + C.BOSS_BEFORE + .05 + random(g);
    return [first, first + C.BOSS_DURATION + C.BOSS_AFTER + random(g), g.flights[3].end + C.BOSS_BEFORE + .05 + random(g)];
  })() : null;
  for (let i = 0; i < 3; i++) {
    let start = shortStarts ? Math.round(shortStarts[i] / C.DT) * C.DT : null;
    if (shortStarts && (start + C.BOSS_DURATION > g.level.duration
      || g.flights.some(f => start < f.end + C.BOSS_BEFORE && start + C.BOSS_DURATION > f.start - 3.2)))
      throw new Error('No room for three boss encounters');
    if (!shortStarts) {
    for (let n = 0; n < 180; n++) {
      const t = Math.round((123 + random(g) * (g.level.duration - 147)) / C.DT) * C.DT;
      if (g.flights.some(f => t < f.end + 1.5 && t + C.BOSS_DURATION > f.start - 3.2)) continue;
      if (bosses.some(b => t < b.end + 3.2 && t + C.BOSS_DURATION > b.start - 3.2)) continue;
      start = t; break;
    }
    if (start === null) {
      for (let t = 121; t < g.level.duration - 19; t += .25) {
        if (g.flights.some(f => t < f.end + 1.5 && t + C.BOSS_DURATION > f.start - 3.2)) continue;
        if (bosses.some(b => t < b.end + 3.2 && t + C.BOSS_DURATION > b.start - 3.2)) continue;
        start = Math.round(t / C.DT) * C.DT; break;
      }
    }
    }
    if (start === null) throw new Error('No room for three boss encounters');
    const boss = { id: i, start, end: start + C.BOSS_DURATION, remnantAdded: false, shots: [] };
    for (let n = 0; n < C.BOSS_SHOTS; n++) {
      const shot = { id: n, at: start + .8 + n * C.SHOT_INTERVAL, level: g.level,
        y: n % 2 ? 300 : 58 + random(g) * 10, r: 11 + random(g) * 3,
        factor: .2 + random(g) * .48 };
      shot.cues = [0, C.SEPARATION].map(offset => {
        const t = bulletImpact(shot, offset);
        return { earliest: t - .31, latest: t - .19, at: t - .25 };
      });
      if (n % 2 === 0) for (const [slot, offset] of [0, C.SEPARATION].entries()) {
        const cue = shot.cues[slot];
        for (let launch = cue.earliest - C.DT; launch <= cue.latest + C.DT; launch += C.DT)
          for (let t = launch; t < launch + FLIGHT; t += C.DT)
            if (bulletHits(distanceAt(t, g.level) + offset, heightAfter(t - launch), shot, t)) throw new Error('Boss bullet window not safe');
      }
      boss.shots.push(shot);
    }
    bosses.push(boss);
  }
  return bosses.sort((a, b) => a.start - b.start);
}
export function createGame(seed = 1, leader = 0, level = DEFAULT_LEVEL) {
  const g = {
    version: C.VERSION, level: { ...level }, seed: seed >>> 0, rng: (seed >>> 0) || 1, leader,
    phase: 'countdown', countdown: C.COUNTDOWN,
    tick: 0, elapsed: 0, distance: 0, obstacles: [], groups: [], orbs: [],
    nextAt: 2.8, roadReady: [0, 0], obstacleId: 0, groupId: 0, eventId: 0, events: [],
    roadSide: 1, flipFrom: 1, flipAt: -10, flipIndex: 0, flips: [],
    flights: [], flightActive: -1, flightsCompleted: 0, flightExitAt: -10,
    bosses: [], bossesCompleted: 0,
    players: [0, 1].map(id => ({
      id, offset: id === leader ? C.SEPARATION : 0,
      y: 0, vy: 0, grounded: true, alive: true, deathAt: -10,
      respawnAt: 0, shieldUntil: 0, spawnAt: -10,
      jumpUntil: -1, deaths: 0, jumps: 0,
      held: false, flyY: 250, flyLane: 0, boosts: 0, lastOrb: -1, orbAt: -10,
      spawnAssist: false, flyAssistHeld: false, respawnHoldUntil: -1,
    })),
  };
  for (let minute = 0; minute < level.duration / 60; minute++) g.flights.push(makeFlight(g, minute));
  g.bosses = makeBosses(g);
  const flipFree = t => t >= 2 && t + C.FLIP_DURATION < g.level.duration - 2
    && g.flights.every(f => t >= f.end + 1.5 || t + C.FLIP_DURATION <= f.start - 1.5)
    && g.bosses.every(b => t >= b.end + 3.2 || t + C.FLIP_DURATION <= b.start - 1.5)
    && g.flips.every(other => Math.abs(t - other) > C.FLIP_DURATION + 3);
  // A gravity gate follows (or precedes) each flight with a 1.5 s transition.
  for (const f of g.flights) {
    const after = f.end + 1.5, before = f.start - 1.5 - C.FLIP_DURATION;
    const t = flipFree(after) ? after : flipFree(before) ? before : null;
    if (t !== null) g.flips.push(Math.round(t / C.DT) * C.DT);
  }
  let flipTime = 20 + random(g) * 10;
  while (flipTime < g.level.duration - 6) {
    if (flipFree(flipTime))
      g.flips.push(Math.round(flipTime * 120) / 120);
    flipTime += 26 + random(g) * 10;
  }
  g.flips.sort((a, b) => a - b);
  fillTrack(g);
  return g;
}
// Conservative rectangular envelope, including saw teeth. The render must
// remain inside this envelope. This keeps the proof stricter than collision.
export function trapHeight(o, elapsed) {
  let height = 0;
  for (const strike of o.strikes || []) {
    if (!strike) continue;
    const age = elapsed - strike.at;
    if (age < 0) continue;
    const up = Math.min(1, age / C.TRAP_RISE);
    const down = Math.max(0, 1 - Math.max(0, age - C.TRAP_RISE - C.TRAP_HOLD) / C.TRAP_FALL);
    height = Math.max(height, strike.reach * up * down);
  }
  return height;
}
export function hits(x, y, o, elapsed = 0) {
  const over = x + C.HIT_HALF > o.x && x - C.HIT_HALF < o.x + o.w;
  if (!over) return false;
  if (o.kind !== 'fake') return y + 6 < o.h;
  if (y <= C.FAKE_CLEARANCE) return false;
  const height = trapHeight(o, elapsed);
  const center = o.x + o.w / 2;
  const nearest = Math.max(x - C.HIT_HALF, Math.min(center, x + C.HIT_HALF));
  const triangle = Math.abs(nearest - center) / (o.w / 2) * Math.min(90, height);
  return y + 6 < height - triangle;
}
export function touchesOrb(x, y, orb) {
  if (y <= 0) return false;
  const dx = Math.max(0, Math.abs(x - orb.x) - C.HIT_HALF);
  const dy = Math.max(0, Math.abs(y + C.SIZE / 2 - orb.y) - C.SIZE / 2);
  return dx * dx + dy * dy <= orb.r * orb.r;
}
function integrateJump(p) {
  if (p.y > 0 || p.vy > 0) {
    p.y = Math.max(0, p.y + p.vy * C.DT - .5 * C.GRAVITY * C.DT * C.DT);
    p.vy -= C.GRAVITY * C.DT;
    if (!p.y) p.vy = 0;
  }
}
function overlaps(x, o) { return x + C.HIT_HALF > o.x && x - C.HIT_HALF < o.x + o.w; }
export function supported(p, x, obstacles) {
  return p.vy <= 0 && (p.y <= 0 || obstacles.some(o => o.kind === 'step' && overlaps(x, o) && Math.abs(p.y - o.h) < .01));
}
// Only step tops are safe. Side faces and every other solid remain lethal.
// Shared by live physics and the stair-route proof.
export function moveRunner(p, x, obstacles) {
  const oldY = p.y;
  if (p.vy === 0 && supported(p, x, obstacles)) { p.grounded = true; return; }
  p.grounded = false;
  integrateJump(p);
  if (p.vy <= 0) {
    let surface = 0;
    for (const o of obstacles) if (o.kind === 'step' && overlaps(x, o)
      && oldY >= o.h - .001 && p.y <= o.h) surface = Math.max(surface, o.h);
    if (p.y <= surface) { p.y = surface; p.vy = 0; p.grounded = true; }
  }
}
export function roadAllowed(g, enter, leave) {
  return g.flips.every(t => leave < t - C.FLIP_BEFORE || enter > t + C.FLIP_AFTER)
    && g.flights.every(f => leave < f.start - C.FLY_BEFORE || enter > f.end + C.FLY_AFTER)
    && g.bosses.every(b => leave < b.start - C.BOSS_BEFORE || enter > b.end + C.BOSS_AFTER);
}
function addBossRemnants(g) {
  for (const boss of g.bosses) {
    if (boss.remnantAdded || g.elapsed + 6 < boss.end) continue;
    const at = boss.end + 1.9, w = 105, h = 90;
    const o = { id: ++g.obstacleId, group: g.groupId + 1, kind: 'remnant', boss: boss.id,
      x: distanceAt(at, g.level) + C.SEPARATION - w / 2, w, h };
    const proof = [safeWindow(o, 0, g.level), safeWindow(o, C.SEPARATION, g.level)];
    if (!proof.every(p => p && p.width >= .16)) throw new Error('Boss remnant has no jump window');
    const cues = proof.map(p => ({ earliest: p.earliest, latest: p.latest, at: p.middle }));
    g.groups.push({ id: ++g.groupId, action: 'jump', at, tier: difficultyAt(at).tier,
      count: 1, x: o.x, w, h, cues, starts: cues.map(c => c.earliest),
      ends: cues.map(c => c.latest + FLIGHT + .04), boss: boss.id });
    g.obstacles.push(o); boss.remnantAdded = true;
    g.groups.sort((a, b) => a.x - b.x);
  }
}
// Find a *continuous* window of jump timings for BOTH positions. Uses exact
// speed transitions and the same conservative hitbox, sampled at 120 Hz.
export function safeWindow(o, offset, level = DEFAULT_LEVEL) {
  const centerAt = timeAtDistance(o.x + o.w / 2 - offset, level);
  let first = null, last = null, runStart = null, best = 0;
  for (let lead = .12; lead <= FLIGHT; lead += C.DT) {
    const launch = centerAt - lead;
    let ok = launch >= 0;
    for (let dt = 0; ok && dt <= FLIGHT + .1; dt += C.DT) {
      const x = distanceAt(launch + dt, level) + offset;
      // 10px extra vertical clearance + 1 physics step of integration error.
      if (hits(x, heightAfter(dt) - 16, o)) ok = false;
    }
    if (ok) {
      if (runStart === null) runStart = lead;
      if (lead - runStart > best) {
        best = lead - runStart; first = centerAt - lead; last = centerAt - runStart;
      }
    } else runStart = null;
  }
  return first === null ? null : { earliest: first, latest: last, width: best, middle: (first + last) / 2 };
}
export function makeGroup(g, at) {
  const d = difficultyAt(at);
  const v = C.BASE_SPEED * speedAt(at, g.level);
  const count = d.count[0] + Math.floor(random(g) * (d.count[1] - d.count[0] + 1));
  const width = Math.min(760, v * (.23 + d.tier * .02 + random(g) * .07) - C.HIT_HALF * 2);
  const group = { id: g.groupId + 1, action: 'jump', at, tier: d.tier, count,
    x: distanceAt(at, g.level) + C.SEPARATION - width / 2,
    w: width, h: d.height[0] + random(g) * (d.height[1] - d.height[0]) };
  let proof;
  for (let i = 0; i < 12; i++) {
    proof = [safeWindow(group, 0, g.level), safeWindow(group, C.SEPARATION, g.level)];
    if (proof.every(p => p && p.width >= d.window)) break;
    const center = group.x + group.w / 2;
    group.w *= .9; group.h *= .92; group.x = center - group.w / 2;
  }
  if (!proof.every(p => p && p.width >= d.window)) return null;
  // Reserve the entire encounter, for BOTH players, outside gravity gates.
  const enter = timeAtDistance(group.x - C.SEPARATION - C.HIT_HALF, g.level);
  const leave = timeAtDistance(group.x + group.w + C.HIT_HALF, g.level);
  if (!roadAllowed(g, enter, leave)) return null;
  group.cues = proof.map(p => ({ earliest: p.earliest, latest: p.latest, at: p.middle }));
  // Some clusters have a three-cube gap between individual figures. They are
  // cleared in one jump; separate jumps still need a full landing interval.
  const roomy = count > 1 && random(g) < .32;
  const spacing = roomy ? Math.min(3 * C.SIZE, group.w * .68 / (count - 1))
    : Math.min(12, group.w * (.006 + random(g) * .024));
  const partWidth = (group.w - spacing * (count - 1)) / count;
  const kinds = ['spike', 'block', 'saw', 'double'];
  const parts = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(random(g) * kinds.length)];
    let w = partWidth, h = group.h * (.72 + random(g) * .28);
    if (kind === 'spike') h = Math.min(h, w * .95);
    if (kind === 'double') h = Math.min(h, w * .47);
    if (kind === 'saw') w = h = Math.min(w, h, 98);
    parts.push({ id: ++g.obstacleId, group: group.id, kind,
      x: group.x + i * (partWidth + spacing) + (partWidth - w) / 2, w, h });
  }
  g.groupId++;
  return { group, parts };
}
function stairLanding(parts, index, offset, launch, fromHeight, orbs, expectedOrb, level) {
  const p = { y: fromHeight, vy: 0, grounded: true };
  if (!supported(p, distanceAt(launch, level) + offset, parts)) return null;
  p.vy = C.JUMP; p.grounded = false;
  let boosted = false;
  for (let n = 1; n < 235; n++) {
    const t = launch + n * C.DT, x = distanceAt(t, level) + offset;
    moveRunner(p, x, parts);
    for (const orb of orbs) if (touchesOrb(x, p.y, { ...orb, r: orb.r - 5 })) {
      if (orb.id !== expectedOrb?.id) return null;
      if (!boosted) { p.vy = orb.power; boosted = true; }
    }
    if (parts.some(o => hits(x, p.y, o))) return null;
    if (p.grounded) return p.y === parts[index].h && boosted === !!expectedOrb ? t : null;
  }
  return null;
}
export function makeStairs(g, at) {
  const tier = difficultyAt(at).tier;
  for (let attempt = 0; attempt < 10; attempt++) {
    const count = 3 + Math.floor(random(g) * 4), peak = 1 + Math.floor(random(g) * (count - 2));
    const landable = Array.from({ length: count }, (_, i) => i).filter(i => i !== peak);
    const optional = landable.filter(i => i && i !== peak + 1);
    const wanted = Math.min(4, landable.length, 1 + Math.floor(random(g) * 4));
    const boosted = new Set([peak + 1]);
    for (let i = 0; i < wanted - 1 && optional.length; i++) {
      const choice = Math.floor(random(g) * optional.length);
      boosted.add(optional.splice(choice, 1)[0]);
    }
    const height = [98 + random(g) * 24 + tier * 2];
    for (let i = 1; i < count; i++) {
      if (i < peak) height.push(height[i - 1] + 42 + random(g) * 16);
      else if (i === peak) height.push(height[i - 1] + 230 + random(g) * 12);
      else if (i === peak + 1) height.push(164 + random(g) * 18 + tier * 2);
      else height.push(Math.max(90, height[i - 1] - 30 - random(g) * 13));
    }
    // Every visible segment is an actual 64×64 square, including collision.
    for (let i = 0; i < count; i++) height[i] = Math.max(2, Math.round(height[i] / C.SIZE)) * C.SIZE;
    const times = [0];
    for (let i = 1; i < count; i++)
      times.push(times[i - 1] + (i === peak ? .9 : i === peak + 1 ? .7 : boosted.has(i) ? 1.45 : .9));
    const spans = height.map((_h, i) => i === peak ? .32 : .79);
    const pillars = times.map((t, i) => ({
      id: g.obstacleId + i + 1, group: g.groupId + 1, kind: 'step',
      x: distanceAt(at + t, g.level) + C.SEPARATION,
      w: Math.max(C.SIZE, Math.round((distanceAt(at + t + spans[i], g.level) - distanceAt(at + t, g.level)) / C.SIZE) * C.SIZE),
      h: height[i],
    }));
    const parts = [...pillars];
    for (let i = 0; i < count - 1; i++) {
      const x = pillars[i].x + pillars[i].w;
      parts.push({ id: g.obstacleId + count + i + 1, group: g.groupId + 1,
        kind: 'pit', x, w: pillars[i + 1].x - x, h: 29 });
    }
    const orbs = [], stages = [], lastLand = [0, 0];
    let valid = true;
    for (const [stageIndex, i] of landable.entries()) {
      const prior = stageIndex ? landable[stageIndex - 1] : -1;
      const fromHeight = prior < 0 ? 0 : pillars[prior].h;
      const launchX = prior < 0 ? null : distanceAt(at + times[prior] + .48, g.level) + C.SEPARATION;
      let orb = null;
      if (boosted.has(i)) {
        orb = { id: `stair-${g.groupId + 1}-${i}`, group: g.groupId + 1,
          x: distanceAt(at + times[prior] + .64, g.level) + C.SEPARATION,
          y: fromHeight + 150, r: C.ORB_RADIUS, power: i === peak + 1 ? C.BOOST : 1280 };
        orbs.push(orb);
      }
      const cues = [];
      for (const [slot, offset] of [0, C.SEPARATION].entries()) {
        const middle = prior < 0 ? timeAtDistance(pillars[0].x - C.HIT_HALF - offset, g.level) - .39
          : timeAtDistance(launchX - offset, g.level);
        const cue = { earliest: middle - .06, latest: middle + .06, at: middle };
        if (cue.earliest < lastLand[slot] + .035) { valid = false; break; }
        let latestLand = 0;
        for (let t = cue.earliest - C.DT; t <= cue.latest + C.DT * 1.01; t += C.DT) {
          const land = stairLanding(parts, i, offset, t, fromHeight, orbs, orb, g.level);
          if (land === null) { valid = false; break; }
          latestLand = Math.max(latestLand, land);
        }
        if (!valid) break;
        lastLand[slot] = latestLand; cues.push(cue);
      }
      if (!valid) break;
      if (orb) {
        orb.launchXs = cues.map((cue, slot) => distanceAt(cue.at, g.level) + [0, C.SEPARATION][slot]);
        orb.launchHeight = fromHeight;
      }
      stages.push({ index: stageIndex, pillar: i, fromHeight, height: pillars[i].h,
        x: pillars[i].x, w: pillars[i].w, orbId: orb?.id ?? null, cues });
    }
    if (!valid) continue;
    const last = pillars[count - 1];
    const ends = [0, C.SEPARATION].map(offset => timeAtDistance(last.x + last.w + C.HIT_HALF - offset, g.level) + Math.sqrt(2 * last.h / C.GRAVITY) + .06);
    const starts = stages[0].cues.map(c => c.earliest);
    if (!roadAllowed(g, Math.min(...starts), Math.max(...ends))) continue;
    const group = { id: ++g.groupId, action: 'stairs', at, tier, count: parts.length, x: pillars[0].x,
      w: last.x + last.w - pillars[0].x, h: Math.max(...height), pillarCount: count, orbCount: orbs.length,
      stages, cues: stages[0].cues, starts, ends };
    g.obstacleId += parts.length;
    return { group, parts, orbs };
  }
  return null;
}
// Simulate the exact impulse/circle contact used in step(). A single ordinary
// jump cannot clear the tower: its height exceeds the unboosted jump apex.
export function boostWindow(tower, orb, offset, level = DEFAULT_LEVEL) {
  const at = timeAtDistance(orb.x - offset, level);
  let first = null, last = null, run = null, best = 0;
  for (let lead = .13; lead <= .66; lead += C.DT) {
    const launch = at - lead, p = { y: 0, vy: C.JUMP };
    let boosted = false, ok = launch >= 0, landed = false;
    for (let n = 1; ok && n <= 240; n++) {
      const t = launch + n * C.DT, x = distanceAt(t, level) + offset;
      integrateJump(p);
      // Slightly smaller orb and taller tower give a safety margin.
      if (!boosted && touchesOrb(x, p.y, { ...orb, r: orb.r - 5 })) { boosted = true; p.vy = C.BOOST; }
      if (hits(x, p.y - 12, tower)) ok = false;
      if (n > 2 && p.y === 0) { landed = true; ok &&= x - C.HIT_HALF > tower.x + tower.w; break; }
    }
    ok &&= boosted && landed;
    if (ok) {
      if (run === null) run = lead;
      if (lead - run > best) { best = lead - run; first = at - lead; last = at - run; }
    } else run = null;
  }
  return first === null ? null : { earliest: first, latest: last, width: best, middle: (first + last) / 2 };
}
export function makeBoostGroup(g, at, variant) {
  const tier = difficultyAt(at).tier, v = C.BASE_SPEED * speedAt(at, g.level);
  const kind = variant || (random(g) < .55 ? 'stack' : 'tower');
  const w = kind === 'stack' ? 124 + random(g) * 24 : 66 + random(g) * 24;
  const h = 280 + tier * 6 + random(g) * 14;
  const tower = { id: g.obstacleId + 1, group: g.groupId + 1, kind, x: distanceAt(at, g.level) + C.SEPARATION - w / 2, w, h };
  const orb = { id: g.groupId + 1, x: tower.x - v * .42, y: 142, r: C.ORB_RADIUS };
  const proof = [boostWindow(tower, orb, 0, g.level), boostWindow(tower, orb, C.SEPARATION, g.level)];
  if (!proof.every(p => p && p.width >= .12)) return null;
  const enter = Math.min(...proof.map(p => p.earliest));
  const leave = Math.max(...proof.map(p => p.latest)) + 1.8;
  if (!roadAllowed(g, enter, leave)) return null;
  const group = { id: ++g.groupId, action: 'boost', at, tier, count: 1, x: tower.x, w, h,
    cues: proof.map(p => ({ earliest: p.earliest, latest: p.latest, at: p.middle })) };
  orb.launchXs = group.cues.map((cue, slot) => distanceAt(cue.at, g.level) + [0, C.SEPARATION][slot]);
  orb.launchHeight = 0;
  g.obstacleId++;
  return { group, parts: [tower], orb };
}
export function makeFakeGroup(g, at) {
  const tier = difficultyAt(at).tier, v = C.BASE_SPEED * speedAt(at, g.level);
  const w = Math.min(170, v * .12), h = 28;
  const x = distanceAt(at, g.level) + C.SEPARATION - w / 2;
  if (!roadAllowed(g, timeAtDistance(x - C.SEPARATION - C.HIT_HALF, g.level), timeAtDistance(x + w + C.HIT_HALF, g.level))) return null;
  const group = { id: ++g.groupId, action: 'stay', at, tier, count: 1, x, w, h, cues: [] };
  return { group, parts: [{ id: ++g.obstacleId, group: group.id, kind: 'fake', x, w, h, strikes: [null, null] }] };
}
function bounds(pack, level) {
  const o = pack.group;
  if (o.starts) return;
  o.starts = [0, C.SEPARATION].map((offset, i) => o.action === 'stay'
    ? timeAtDistance(o.x - C.HIT_HALF - offset, level) : o.cues[i].earliest);
  o.ends = [0, C.SEPARATION].map((offset, i) => o.action === 'stay'
    ? timeAtDistance(o.x + o.w + C.HIT_HALF - offset, level) + .04
    : o.cues[i].latest + (o.action === 'boost' ? 1.8 : FLIGHT + .04));
}
export function fillTrack(g) {
  addBossRemnants(g);
  while (g.nextAt < Math.min(g.level.duration - 2, g.elapsed + 6)) {
    const roll = g.nextAt < 5 ? 1 : random(g);
    const factory = roll < .16 ? makeStairs : roll < .34 ? makeBoostGroup : roll < .47 ? makeFakeGroup : makeGroup;
    let next = null;
    // Short gaps are allowed only after BOTH players have recovered. This also
    // prevents a previous long boost or stair descent from forcing a trap jump.
    for (let attempt = 0; attempt < 3; attempt++) {
      next = factory(g, g.nextAt);
      if (!next) break;
      bounds(next, g.level);
      const shift = Math.max(...next.group.starts.map((t, i) => g.roadReady[i] + .035 - t));
      if (shift <= 0) break;
      g.nextAt += shift + .015; next = null;
    }
    if (next && (!roadAllowed(g, Math.min(...next.group.starts), Math.max(...next.group.ends))
      || Math.max(...next.group.ends) > g.level.duration - .4)) next = null;
    if (next) {
      g.groups.push(next.group); g.obstacles.push(...next.parts);
      if (next.orb) g.orbs.push(next.orb);
      if (next.orbs) g.orbs.push(...next.orbs);
      g.roadReady = next.group.ends;
    }
    const { gap } = difficultyAt(g.nextAt);
    const close = random(g) < .55;
    const interval = (gap[0] + random(g) * (gap[1] - gap[0])) * (close ? .45 + random(g) * .25 : 1);
    if (next) {
      next.group.close = close;
      g.nextAt = next.group.action === 'stairs' ? timeAtDistance(next.group.x + next.group.w - C.SEPARATION, g.level) + interval : g.nextAt + interval;
    } else g.nextAt += .65 + random(g) * .35;
  }
  g.obstacles = g.obstacles.filter(o => o.x + o.w > g.distance - 250);
  g.groups = g.groups.filter(o => o.x + o.w > g.distance - 250);
  g.orbs = g.orbs.filter(o => o.x + o.r > g.distance - 250);
}
export function emit(g, type, player) {
  g.events.push({ id: ++g.eventId, type, player, t: g.elapsed });
  if (g.events.length > 24) g.events.shift();
}
export function jump(g, id) {
  const p = g.players[id];
  if (g.phase === 'running' && p?.alive && !isFlipping(g) && !activeFlight(g)) p.jumpUntil = g.elapsed + .12;
}
export function setControl(g, id, held) {
  const p = g.players[id];
  if (!p || typeof held !== 'boolean') return;
  if (p.spawnAssist) p.spawnAssist = false;
  const pressed = held && !p.held;
  p.held = held;
  if (pressed) jump(g, id);
}
export function kill(g, id) {
  const p = g.players[id];
  if (!p?.alive || p.shieldUntil > g.elapsed || g.phase !== 'running') return;
  p.alive = false; p.deathAt = g.elapsed; p.respawnAt = g.elapsed + C.RESPAWN;
  p.vy = 0; p.jumpUntil = -1; p.held = false; p.deaths++;
  p.spawnAssist = false; p.respawnHoldUntil = -1;
  emit(g, 'death', id);
}
export function step(g, inputs = []) {
  if (g.phase === 'countdown') {
    g.countdown = Math.max(0, g.countdown - C.DT);
    if (g.countdown < 1e-7) { g.countdown = 0; g.phase = 'running'; emit(g, 'start', -1); }
    return;
  }
  if (g.phase !== 'running') return;
  for (const id of inputs) jump(g, id);
  g.tick++; g.elapsed = Math.min(g.level.duration, g.tick * C.DT);
  g.distance = distanceAt(g.elapsed, g.level);
  if (g.elapsed >= g.level.duration) { g.phase = 'won'; emit(g, 'win', -1); return; }
  for (const boss of g.bosses) {
    if (g.tick === Math.round(boss.start / C.DT)) emit(g, 'boss-enter', -1);
    if (g.tick === Math.round(boss.end / C.DT)) { g.bossesCompleted++; emit(g, 'boss-exit', -1); }
  }
  fillTrack(g);
  const flightIndex = g.flights.findIndex(f => g.elapsed + 1e-7 >= f.start && g.elapsed < f.end - 1e-7);
  if (flightIndex !== g.flightActive) {
    if (flightIndex >= 0) {
      g.flightActive = flightIndex;
      const f = activeFlight(g);
      for (const p of g.players) {
        p.flyLane = f.lanes[p.id];
        p.flyY = flightCorridor(f, flightProgress(f, g.elapsed, p.offset), p.flyLane).center;
        p.y = 0; p.vy = 0; p.grounded = true; p.jumpUntil = -1;
      }
      emit(g, 'flight-enter', -1);
    } else {
      g.flightActive = -1; g.flightsCompleted++; g.flightExitAt = g.elapsed;
      for (const p of g.players) { p.y = 0; p.vy = 0; p.grounded = true; p.jumpUntil = -1; p.spawnAssist = false; }
      emit(g, 'flight-exit', -1);
    }
  }
  if (g.flipIndex < g.flips.length && g.elapsed + 1e-7 >= g.flips[g.flipIndex]) {
    g.flipAt = g.flips[g.flipIndex++]; g.flipFrom = g.roadSide; g.roadSide *= -1;
    for (const p of g.players) { p.y = 0; p.vy = 0; p.grounded = true; p.jumpUntil = -1; }
    emit(g, 'flip', -1);
  }
  for (const p of g.players) {
    if (!p.alive) {
      if (g.elapsed + 1e-7 >= p.respawnAt) {
        p.alive = true; p.y = 0; p.vy = 0; p.grounded = true; p.spawnAt = g.elapsed;
        p.respawnHoldUntil = -1;
        if (activeFlight(g)) {
          const f = activeFlight(g);
          p.flyY = flightSpawnY(f, flightProgress(f, g.elapsed, p.offset), p.flyLane);
          p.spawnAssist = true; p.flyAssistHeld = false;
        }
        // Exact 6 second respawn, followed by a visible shield through any
        // obstacle already under the spawn point. No teleport into a hazard.
        p.shieldUntil = g.elapsed + C.SHIELD;
        const x = playerX(g, p);
        if (!activeFlight(g)) {
          const stairs = g.groups.find(group => group.action === 'stairs'
            && x + C.HIT_HALF >= group.x && x - C.HIT_HALF <= group.x + group.w);
          const platform = stairs?.stages.find(stage => stage.x + stage.w > x - C.HIT_HALF);
          if (platform) {
            p.y = platform.height;
            p.respawnHoldUntil = Math.max(g.elapsed, timeAtDistance(platform.x + C.HIT_HALF - p.offset, g.level));
            p.shieldUntil = Math.max(p.shieldUntil, Math.max(...stairs.ends) + .3);
          }
        }
        for (const o of activeFlight(g) ? [] : g.obstacles) {
          if (o.x < x + C.HIT_HALF && o.x + o.w > x - C.HIT_HALF)
            p.shieldUntil = Math.max(p.shieldUntil, timeAtDistance(o.x + o.w + C.HIT_HALF - p.offset, g.level) + .15);
        }
        emit(g, 'respawn', p.id);
      }
      continue;
    }
    if (activeFlight(g)) {
      const f = activeFlight(g), t = flightProgress(f, g.elapsed, p.offset);
      if (g.elapsed - f.start < C.FLY_ENTRY) p.flyY = flightCorridor(f, t, p.flyLane).center;
      else {
        if (p.spawnAssist) p.flyAssistHeld = followCorridor(f, t, p.flyLane, p.flyY, p.flyAssistHeld);
        p.flyY += (p.spawnAssist ? p.flyAssistHeld : p.held) ? -C.FLY_SPEED * C.DT : C.FLY_SPEED * C.DT;
      }
      if (p.shieldUntil <= g.elapsed && flightClearance(f, t, p.flyLane, p.flyY) < 0) kill(g, p.id);
      continue;
    }
    if (isFlipping(g)) { p.y = 0; p.vy = 0; p.grounded = true; continue; }
    if (p.respawnHoldUntil > g.elapsed) { p.vy = 0; p.grounded = true; p.jumpUntil = -1; continue; }
    const x = playerX(g, p);
    p.grounded = supported(p, x, g.obstacles);
    if (p.grounded && p.jumpUntil >= g.elapsed - C.DT) {
      p.vy = C.JUMP; p.grounded = false; p.jumpUntil = -1; p.jumps++;
      emit(g, 'jump', p.id);
    }
    moveRunner(p, x, g.obstacles);
    for (const orb of g.orbs) {
      if (p.lastOrb !== orb.id && touchesOrb(playerX(g, p), p.y, orb)) {
        p.vy = orb.power ?? C.BOOST; p.grounded = false; p.lastOrb = orb.id; p.boosts++; p.orbAt = g.elapsed;
        emit(g, 'boost', p.id);
      }
    }
    for (const o of g.obstacles) {
      if (o.kind !== 'fake' || o.strikes[p.id] || p.y <= C.FAKE_CLEARANCE) continue;
      const warning = C.BASE_SPEED * speedAt(g.elapsed, g.level) * C.TRAP_RISE;
      if (x + C.HIT_HALF >= o.x - warning && x - C.HIT_HALF < o.x + o.w) {
        o.strikes[p.id] = { at: g.elapsed, reach: Math.max(230, p.y + C.SIZE + 110 + Math.max(0, p.vy) * .22) };
        emit(g, 'trap', p.id);
      }
    }
    if (p.shieldUntil <= g.elapsed) {
      for (const o of g.obstacles) {
        if (hits(x, p.y, o, g.elapsed)) { kill(g, p.id); break; }
      }
      if (p.alive) {
        const boss = activeBoss(g);
        if (boss?.shots.some(b => bulletHits(x, p.y, b, g.elapsed))) kill(g, p.id);
      }
    }
  }
  if (g.players.every(p => !p.alive)) { g.phase = 'lost'; emit(g, 'lose', -1); }
}
export function jumpCue(g, id) {
  const p = g.players[id];
  if (g.phase !== 'running' || !p?.alive || !p.grounded || p.respawnHoldUntil > g.elapsed || isFlipping(g) || activeFlight(g)) return null;
  const x = playerX(g, p);
  const boss = activeBoss(g);
  if (boss) for (const shot of boss.shots) {
    if (shot.id % 2) continue;
    const cue = shot.cues[p.offset === 0 ? 0 : 1];
    if (g.elapsed > cue.latest || g.elapsed < shot.at) continue;
    return { ...cue, group: `boss-${boss.id}`, key: `boss-${boss.id}:${shot.id}`,
      x: distanceAt(cue.at, g.level) + p.offset, height: 0,
      active: g.elapsed >= cue.earliest && g.elapsed <= cue.latest };
  }
  const group = g.groups.find(o => o.x + o.w > x - C.HIT_HALF);
  if (!group || group.action === 'stay') return null;
  const slot = p.offset === 0 ? 0 : 1;
  const stage = group.action === 'stairs' ? group.stages.find(s => Math.abs(s.fromHeight - p.y) < .01 && s.cues[slot].latest >= g.elapsed) : null;
  if (group.action === 'stairs' && !stage) return null;
  const cue = stage ? stage.cues[slot] : group.cues[slot];
  if (g.elapsed > cue.latest) return null;
  const orbId = stage?.orbId ?? (group.action === 'boost' ? group.id : null);
  return { ...cue, group: group.id, key: `${group.id}:${stage?.index ?? 0}`, height: stage?.fromHeight ?? 0, x: distanceAt(cue.at, g.level) + p.offset,
    orbId,
    active: g.elapsed >= cue.earliest && g.elapsed <= cue.latest };
}
export function botWantsJump(g, id) {
  const cue = jumpCue(g, id);
  return !!cue && cue.active && g.elapsed + C.DT >= cue.at;
}
export function botFlightHeld(g, id) {
  const f = activeFlight(g), p = g.players[id];
  if (!f || !p?.alive) return false;
  return followCorridor(f, flightProgress(f, g.elapsed, p.offset), p.flyLane, p.flyY, p.held);
}
