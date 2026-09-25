// Online callers pass authoritative snapshots only. A replay/reconnect must not
// repeat haptics or turn a predicted collision into a false death vibration.
export class GameFeedback {
  constructor(api) { this.api = api; this.seed = null; this.lastEvent = 0; }
  consume(game, self, visible = true) {
    if (!game) return;
    if (game.seed !== this.seed) { this.seed = game.seed; this.lastEvent = 0; }
    for (const event of game.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (!visible || game.elapsed - event.t > 1 || event.t > game.elapsed + .05) continue;
      try {
        if (event.type === 'start') this.api?.impactOccurred('medium');
        else if (event.player === self && event.type === 'death') this.api?.notificationOccurred('error');
        else if (event.player === self && event.type === 'respawn') this.api?.notificationOccurred('success');
      } catch { /* Unsupported/disabled device haptics must not interrupt play. */ }
    }
  }
}
export function respawnSeconds(game, self) {
  const me = game?.players[self];
  if (game?.phase !== 'running' || !me || me.alive) return null;
  return Math.max(1, Math.ceil(me.respawnAt - game.elapsed));
}
