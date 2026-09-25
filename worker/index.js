import { DurableObject } from 'cloudflare:workers';
import { C, createGame, step, jump, setControl } from '../public/engine.js';
import { validateTelegram } from './auth.js';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => json({ error: message }, status);
const randomInt = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return fail('Недопустимый источник запроса.', 403);
    if (url.pathname === '/api/config') return json({ version: C.VERSION, botUsername: env.BOT_USERNAME || '', telegramOnly: env.REQUIRE_TELEGRAM_AUTH === 'true' });
    const wsMatch = url.pathname.match(/^\/api\/rooms\/(\d{4})\/ws$/);
    if (wsMatch && request.method === 'GET') {
      return env.ROOMS.get(env.ROOMS.idFromName(wsMatch[1])).fetch(request);
    }
    if (request.method !== 'POST') return fail('Маршрут не найден.', 404);
    if (Number(request.headers.get('Content-Length')) > 16000) return fail('Слишком большой запрос.', 413);
    let body;
    try {
      const text = await request.text();
      if (text.length > 16000) return fail('Слишком большой запрос.', 413);
      body = JSON.parse(text);
    } catch { return fail('Неверный запрос.'); }
    if (!body || typeof body !== 'object') return fail('Неверный запрос.');
    if (body.version !== C.VERSION) return fail('Игра обновлена. Закройте и снова откройте приложение.', 409);
    let identity = null;
    if (body.initData) {
      identity = await validateTelegram(body.initData, env.TELEGRAM_BOT_TOKEN);
      if (!identity) return fail('Не удалось проверить Telegram. Закройте игру и откройте её снова. Проверьте токен бота в Cloudflare.', 401);
    }
    if (!identity && env.REQUIRE_TELEGRAM_AUTH === 'true') return fail('Откройте игру через Telegram.', 401);
    identity ||= { uid: `guest:${crypto.randomUUID()}`, name: 'Игрок' };
    if (url.pathname === '/api/rooms') {
      for (let i = 0; i < 15; i++) {
        const code = String(1000 + randomInt(9000));
        const response = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code, identity }) }));
        if (response.status !== 409) return response;
      }
      return fail('Все комнаты заняты. Попробуйте позже.', 503);
    }
    const join = url.pathname.match(/^\/api\/rooms\/(\d{4})\/join$/);
    if (join) return env.ROOMS.get(env.ROOMS.idFromName(join[1])).fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ identity }) }));
    return fail('Маршрут не найден.', 404);
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.meta = null; this.game = null; this.timer = null; this.acc = 0;
    this.lastTick = Date.now(); this.lastSave = 0; this.lastBroadcast = 0;
    this.pause = null; this.ack = [0, 0]; this.limits = new Map();
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('room');
      if (saved && saved.meta.expires > Date.now()) {
        this.meta = saved.meta; this.game = saved.game; this.ack = saved.ack || [0, 0];
        if (this.game && this.game.version !== C.VERSION) {
          this.game = null; this.ack = [0, 0];
          this.meta.players.forEach(p => { p.ready = false; p.rematch = false; });
          await this.save();
        }
        // Recovery freezes simulation at its last checkpoint, never skips hazards.
        if (this.game && ['running', 'countdown'].includes(this.game.phase)) this.ensureTimer();
      }
    });
  }
  sockets(id) { return id === undefined ? this.ctx.getWebSockets() : this.ctx.getWebSockets(String(id)); }
  connected(id) { return this.sockets(id).some(ws => ws.readyState === 1); }
  async save() {
    if (this.meta) await this.ctx.storage.put('room', { meta: this.meta, game: this.game, ack: this.ack });
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/init') {
      // Serialize reservation across the await so two creators cannot share a code.
      return this.ctx.blockConcurrencyWhile(async () => {
        if (this.meta && this.meta.expires > Date.now()) return fail('Занято.', 409);
        const { code, identity } = await request.json();
        this.meta = { code, expires: Date.now() + 30 * 60 * 1000, players: [this.member(identity)] };
        this.game = null; this.ack = [0, 0]; this.pause = null;
        await this.save(); await this.ctx.storage.setAlarm(this.meta.expires);
        return json({ code, token: this.meta.players[0].token, self: 0 });
      });
    }
    if (!this.meta || this.meta.expires <= Date.now()) return fail('Комната не найдена или время ожидания истекло.', 404);
    if (path === '/join') {
      return this.ctx.blockConcurrencyWhile(async () => {
        const { identity } = await request.json();
        if (this.meta.players.some(p => p.uid === identity.uid)) return fail('Вы уже в этой комнате. Откройте её на устройстве друга.', 409);
        if (this.meta.players.length >= 2) return fail('В комнате уже два игрока.', 409);
        this.meta.players.push(this.member(identity));
        await this.save(); this.broadcast();
        return json({ code: this.meta.code, token: this.meta.players[1].token, self: 1 });
      });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail('Нужен WebSocket.', 426);
    const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim());
    const token = protocols.find(s => s.startsWith('session.'))?.slice(8);
    const self = this.meta.players.findIndex(p => p.token === token);
    if (self < 0 || !protocols.includes('tow-dash')) return fail('Недействительная сессия.', 401);
    const [client, server] = Object.values(new WebSocketPair());
    // Attach the replacement first; close events from the old socket must not pause it.
    const old = this.sockets(self);
    this.ctx.acceptWebSocket(server, [String(self)]);
    server.serializeAttachment({ self });
    for (const socket of old) { try { socket.close(4001, 'Replaced'); } catch {} }
    this.meta.players[self].ready = false;
    this.send(server, { type: 'welcome', self, code: this.meta.code, ack: this.ack[self] });
    this.broadcast(); this.ensureTimer();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'tow-dash' } });
  }
  member(identity) { return { ...identity, token: crypto.randomUUID(), ready: false, rematch: false }; }
  send(ws, msg) { try { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch {} }
  broadcast() {
    if (!this.meta) return;
    const msg = { type: 'state', code: this.meta.code, serverNow: Date.now(), game: this.game,
      pause: this.pause, ack: this.ack,
      players: this.meta.players.map((p, id) => ({ id, name: p.name, ready: p.ready, rematch: p.rematch, connected: this.connected(id) })) };
    for (const ws of this.sockets()) this.send(ws, msg);
  }
  start() {
    this.game = createGame(crypto.getRandomValues(new Uint32Array(1))[0], randomInt(2));
    this.meta.players.forEach(p => { p.rematch = false; });
    this.pause = null; this.acc = 0; this.lastTick = Date.now();
    this.meta.expires = Date.now() + 30 * 60 * 1000;
    this.ctx.storage.setAlarm(this.meta.expires);
    this.save(); this.ensureTimer(); this.broadcast();
  }
  webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 512) { ws.close(1009, 'Message too large'); return; }
    const self = ws.deserializeAttachment()?.self;
    if (!Number.isInteger(self) || !this.meta) return;
    const now = Date.now(), limit = this.limits.get(self) || { at: now, count: 0 };
    if (now - limit.at > 1000) { limit.at = now; limit.count = 0; }
    if (++limit.count > 35) { ws.close(1008, 'Rate limit'); return; }
    this.limits.set(self, limit);
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') { this.send(ws, { type: 'pong', sent: msg.sent }); return; }
    if (msg.type === 'ready') {
      if (msg.version !== C.VERSION) {
        this.send(ws, { type: 'update_required' }); ws.close(1000, 'Update required'); return;
      }
      this.meta.players[self].ready = msg.ready !== false;
      if (msg.ready === false && this.game) setControl(this.game, self, false);
      if (!this.game && this.meta.players.length === 2 && [0, 1].every(id => this.connected(id) && this.meta.players[id].ready)) this.start();
      else this.broadcast();
    }
    if (msg.type === 'jump' && this.game && !this.pause && Number.isSafeInteger(msg.seq) && msg.seq > this.ack[self]) {
      this.ack[self] = msg.seq; jump(this.game, self);
    }
    if (msg.type === 'control' && this.game && typeof msg.held === 'boolean' && Number.isSafeInteger(msg.seq) && msg.seq > this.ack[self]) {
      this.ack[self] = msg.seq; setControl(this.game, self, msg.held && !this.pause);
    }
    if (msg.type === 'rematch' && this.game && ['won', 'lost', 'aborted'].includes(this.game.phase)) {
      this.meta.players[self].rematch = true;
      if ([0, 1].every(id => this.connected(id) && this.meta.players[id].rematch)) this.start();
      else this.broadcast();
    }
    if (msg.type === 'leave') {
      if (this.game) this.game.phase = 'aborted';
      this.pause = null; this.meta.expires = Date.now() + 1000;
      this.broadcast(); this.save(); this.ctx.storage.setAlarm(this.meta.expires);
      ws.close(1000, 'Left room');
    }
  }
  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
    const self = ws.deserializeAttachment()?.self;
    if (this.game && Number.isInteger(self) && !this.connected(self)) setControl(this.game, self, false);
    this.broadcast(); this.ensureTimer();
  }
  webSocketError(ws) { try { ws.close(1011, 'Connection error'); } catch {} this.ensureTimer(); }
  ensureTimer() {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / 30);
  }
  tick() {
    if (!this.meta) return this.stopTimer();
    const now = Date.now();
    if (!this.game) { this.stopTimer(); return; }
    if (!['running', 'countdown'].includes(this.game.phase)) { this.stopTimer(); return; }
    const allReady = [0, 1].every(id => this.connected(id) && this.meta.players[id]?.ready);
    if (!allReady) {
      for (const p of this.game.players) p.held = false;
      this.pause ||= { until: now + 20000 };
      if (now > this.pause.until) { this.game.phase = 'aborted'; this.pause = null; this.save(); }
      this.acc = 0; this.lastTick = now;
    } else {
      if (this.pause) { this.pause = null; this.lastTick = now; }
      this.acc += Math.min(.5, (now - this.lastTick) / 1000);
      this.lastTick = now;
      while (this.acc >= C.DT) { step(this.game); this.acc -= C.DT; }
    }
    const ended = !['running', 'countdown'].includes(this.game.phase);
    // Always send terminal state, even between the regular snapshot ticks.
    if (now - this.lastBroadcast >= 49 || ended) { this.broadcast(); this.lastBroadcast = now; }
    if (now - this.lastSave >= 5000 || ended) { this.lastSave = now; this.save(); }
  }
  stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async alarm() {
    if (this.meta && this.meta.expires > Date.now()) { await this.ctx.storage.setAlarm(this.meta.expires); return; }
    for (const ws of this.sockets()) { try { ws.close(1000, 'Room expired'); } catch {} }
    this.stopTimer(); this.meta = null; this.game = null;
    await this.ctx.storage.deleteAll();
  }
}
