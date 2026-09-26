// Integration against the REAL local Cloudflare Worker + Durable Object runtime.
// Start npm run dev in another terminal. Node 22+ provides WebSocket.
import assert from 'node:assert/strict';
import { C, jumpCue, activeFlight, botFlightHeld } from '../public/engine.js';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
async function post(path, body = {}) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: C.VERSION, ...body }) });
  return { status: r.status, body: await r.json() };
}
function client(session) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + `/api/rooms/${session.code}/ws`, ['tow-dash', `session.${session.token}`]);
  const c = { ws, messages: [], state: null };
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); c.messages.push(m); if (m.type === 'state') c.state = m; });
  return c;
}
async function until(fn, timeout = 10000) {
  const start = Date.now(); while (!fn()) { if (Date.now() - start > timeout) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 25)); }
}
assert.equal((await post('/api/rooms', { version: 1 })).status, 409);
const config = await (await fetch(base + '/api/config')).json();
assert.equal(config.version, C.VERSION); assert.equal(config.levels.length, 6);
const owner = crypto.randomUUID();
assert.equal((await post('/api/progress', { guestId: owner })).body.highest, 1);
assert.equal((await post('/api/rooms', { guestId: owner, level: 2 })).status, 403);
const a = await post('/api/rooms', { guestId: owner, level: 1 }); assert.equal(a.status, 200);
assert.equal(a.body.level, 1);
const b = await post(`/api/rooms/${a.body.code}/join`); assert.equal(b.status, 200);
assert.equal(b.body.level, 1);
assert.equal((await post(`/api/rooms/${a.body.code}/join`)).status, 409);
const missing = await post('/api/rooms/0000/join'); assert.equal(missing.status, 404);
const p0 = client(a.body), p1 = client(b.body);
let replacement;
try {
  await until(() => p0.ws.readyState === 1 && p1.ws.readyState === 1);
  const send = (c, m) => c.ws.send(JSON.stringify({ version: C.VERSION, ...m }));
  send(p0, { type: 'ready' }); send(p1, { type: 'ready' });
  await until(() => p0.state?.game?.phase === 'countdown' && p1.state?.game);
  assert.equal(p0.state.level, p1.state.level);
  assert.equal(p0.state.game.level.id, 1);
  assert.equal(p0.state.game.seed, p1.state.game.seed);
  assert.equal(p0.messages.find(m => m.type === 'welcome').self, 0);
  assert.equal(p1.messages.find(m => m.type === 'welcome').self, 1);
  await until(() => p0.state?.game?.phase === 'running');
  send(p0, { type: 'control', seq: 1, held: true });
  await until(() => p1.state.game.players[0].y > 0);
  assert.equal(p1.state.ack[0], 1);
  assert.equal(p1.state.game.players[0].held, true);
  send(p0, { type: 'control', seq: 2, held: false });
  await until(() => p1.state.ack[0] === 2);
  assert.equal(p1.state.game.players[0].held, false);
  send(p0, { type: 'ready', ready: false });
  await until(() => p1.state.pause);
  const elapsed = p1.state.game.elapsed;
  await new Promise(r => setTimeout(r, 300));
  assert.equal(p1.state.game.elapsed, elapsed);
  send(p0, { type: 'ready', ready: true }); await until(() => !p1.state.pause);
  // Both clients die without jumping; restart requires both votes.
  await until(() => p0.state.game.phase === 'lost', 10000);
  const seed = p0.state.game.seed;
  send(p0, { type: 'rematch' }); await new Promise(r => setTimeout(r, 150));
  assert.equal(p0.state.game.phase, 'lost');
  send(p1, { type: 'rematch' }); await until(() => p0.state.game.phase === 'countdown');
  assert.notEqual(p0.state.game.seed, seed);
  // Replacing one socket restores the same player and does not expose tokens.
  replacement = client(a.body);
  await until(() => replacement.ws.readyState === 1);
  send(replacement, { type: 'ready' });
  await until(() => replacement.messages.some(m => m.type === 'welcome'));
  assert.equal(replacement.messages.find(m => m.type === 'welcome').self, 0);
  assert.ok(!JSON.stringify(p1.state).includes(a.body.token));
  const sent = [-1, -1], seq = [2, 0], held = [false, false];
  const autopilot = setInterval(() => {
    for (const [id, c] of [[0, replacement], [1, p1]]) {
      if (!c.state?.game || c.ws.readyState !== 1) continue;
      if (activeFlight(c.state.game)) {
        const next = botFlightHeld(c.state.game, id);
        if (next !== held[id]) { held[id] = next; send(c, { type: 'control', seq: ++seq[id], held: next }); }
        continue;
      }
      if (held[id]) { held[id] = false; send(c, { type: 'control', seq: ++seq[id], held: false }); }
      const cue = jumpCue(c.state.game, id);
      if (cue?.active && sent[id] !== cue.key) {
        sent[id] = cue.key;
        send(c, { type: 'control', seq: ++seq[id], held: true });
        send(c, { type: 'control', seq: ++seq[id], held: false });
      }
    }
  }, 12);
  try {
    await until(() => (replacement.state?.game?.flightActive === 0 && p1.state?.game?.flightActive === 0)
      || ['lost', 'aborted'].includes(replacement.state?.game?.phase), 65000);
    assert.equal(replacement.state.game.phase, 'running', `network race ended at ${replacement.state.game.elapsed}s, deaths ${replacement.state.game.players.map(p => p.deaths)}`);
    assert.deepEqual(replacement.state.game.flights, p1.state.game.flights);
    assert.notEqual(replacement.state.game.players[0].flyLane, replacement.state.game.players[1].flyLane);
    await until(() => replacement.state.game.flightsCompleted === 1 && p1.state.game.flightsCompleted === 1, 15000);
    assert.deepEqual(replacement.state.game.players.map(p => p.deaths), [0, 0]);
    assert.deepEqual(replacement.state.game.flips, p1.state.game.flips);
  } finally { clearInterval(autopilot); }
  send(replacement, { type: 'leave' }); replacement.ws.close();
  console.log('PASS: two-client room, version, press/release, pause, loss, rematch, reconnect, separate lanes, 12-second flight without deaths, private tokens');
} finally { p0.ws.close(); p1.ws.close(); replacement?.ws.close(); }
