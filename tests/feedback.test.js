import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFeedback, respawnSeconds } from '../public/feedback.js';

test('only the dead player sees a respawn countdown', () => {
  const g = { phase: 'running', elapsed: 3, players: [{ alive: false, respawnAt: 9 }, { alive: true }] };
  assert.equal(respawnSeconds(g, 0), 6); assert.equal(respawnSeconds(g, 1), null);
  g.players[0].alive = true; assert.equal(respawnSeconds(g, 0), null);
  g.phase = 'lost'; g.players[0].alive = false; assert.equal(respawnSeconds(g, 0), null);
});
test('Telegram haptics are local, deduplicated across snapshots and reset for a new match', () => {
  const calls = [], feedback = new GameFeedback({ impactOccurred: style => calls.push(style), notificationOccurred: type => calls.push(type) });
  const g = { seed: 1, elapsed: 0, events: [{ id: 1, type: 'start', player: -1, t: 0 }] };
  feedback.consume(g, 0); feedback.consume(structuredClone(g), 0);
  g.elapsed = 1; g.events.push({ id: 2, type: 'death', player: 1, t: 1 }); feedback.consume(g, 0);
  g.elapsed = 2; g.events.push({ id: 3, type: 'death', player: 0, t: 2 }); feedback.consume(g, 0); feedback.consume(g, 0);
  g.elapsed = 8; g.events.push({ id: 4, type: 'respawn', player: 0, t: 8 }); feedback.consume(g, 0);
  assert.deepEqual(calls, ['medium', 'error', 'success']);
  g.seed = 2; g.elapsed = 0; g.events = [{ id: 1, type: 'start', player: -1, t: 0 }]; feedback.consume(g, 0);
  assert.equal(calls.at(-1), 'medium'); assert.equal(calls.length, 4);
  g.elapsed = 2; g.events.push({ id: 2, type: 'death', player: 0, t: 2 }); feedback.consume(g, 0, false); feedback.consume(g, 0, true);
  assert.equal(calls.length, 4);
  assert.doesNotThrow(() => new GameFeedback().consume(g, 0));
});
