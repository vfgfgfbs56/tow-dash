import { C, createGame, step, jump, setControl, activeFlight, botFlightHeld, botWantsJump, speedAt } from './engine.js';
import { Renderer } from './render.js';
import { GameFeedback, respawnSeconds } from './feedback.js';

const $ = id => document.getElementById(id);
const renderer = new Renderer($('game'));
const tg = window.Telegram?.WebApp;
const feedback = new GameFeedback(tg?.HapticFeedback);
let game = null, mode = 'menu', self = 0, socket = null, room = null, seq = 0;
let remote = null, pause = null, accumulator = 0, reconnects = 0, reconnectTimer = null;
let lastFrame = performance.now(), lastState = 0, lastPhase = '', toastTimer;
let pending = [], botUsername = '', lastReady = null, enteredCode = '';
const controls = new Set();
let inputHeld = false;
const cryptoSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const clock = seconds => `${String(Math.floor(Math.ceil(seconds) / 60)).padStart(2, '0')}:${String(Math.ceil(seconds) % 60).padStart(2, '0')}`;
function error(message = '') { $('error').hidden = !message; $('error').textContent = message; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2400); }
function screen(name) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== `screen-${name}`;
  $('panel').hidden = false; $('result').hidden = true; $('center-message').hidden = true; error();
}
function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
function sessionSave() { try { if (room) sessionStorage.setItem('tow-room', JSON.stringify(room)); else sessionStorage.removeItem('tow-room'); } catch {} }
function disconnect(leave = false) {
  releaseControls();
  clearTimeout(reconnectTimer); const old = socket; socket = null;
  if (old) { old.onclose = null; if (leave && old.readyState === 1) old.send(JSON.stringify({ type: 'leave' })); old.close(); }
  room = null; sessionSave(); remote = null; pause = null; pending = [];
}
function home() {
  disconnect(true); game = null; mode = 'menu'; lastPhase = ''; renderer.rope = 1;
  screen('home');
  history.replaceState({}, '', location.pathname);
}
async function request(path, body) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, version: C.VERSION, initData: tg?.initData || '' }), signal: controller.signal });
    let data; try { data = await r.json(); } catch { throw new Error('Комнаты недоступны. Запустите проект на Cloudflare или через npm run dev. Тренировка работает без подключения.'); }
    if (!r.ok) throw new Error(data.error || 'Не удалось подключиться.');
    return data;
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('Нет связи с игрой. Проверьте интернет и попробуйте снова.');
    throw e;
  } finally { clearTimeout(timer); }
}
async function busy(button, fn) { if (button.disabled) return; button.disabled = true; error(); try { await fn(); } catch (e) { error(e.message); } finally { button.disabled = false; } }
function connect(data) {
  releaseControls();
  if (socket) { socket.onclose = null; socket.close(); }
  room = data; self = data.self; seq = 0; pending = []; lastReady = null; sessionSave();
  mode = 'online'; screen('wait'); $('invite-code').textContent = data.code;
  setText($('waiting-text'), 'ПОДКЛЮЧАЕМСЯ...');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${data.code}/ws`, ['tow-dash', `session.${data.token}`]);
  socket = ws;
  ws.onopen = () => { reconnects = 0; lastState = performance.now(); orientation(true); };
  ws.onmessage = ev => {
    if (socket !== ws) return;
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'welcome') { self = m.self; seq = Math.max(seq, m.ack || 0); }
    if (m.type === 'update_required') { home(); error('Игра обновлена. Закройте и снова откройте приложение.'); return; }
    if (m.type === 'state') {
      lastState = performance.now(); pause = m.pause; remote = m;
      if (m.game) {
        if (m.game.version !== C.VERSION) { home(); error('Обновите игру на обоих устройствах.'); return; }
        game = m.game;
        feedback.consume(game, self, !document.hidden);
        pending = pending.filter(command => command.seq > (m.ack?.[self] || 0));
        if (!pause) for (const command of pending) setControl(game, self, command.held);
        else releaseControls();
        accumulator = 0;
        if (!$('panel').hidden) $('game').focus({ preventScroll: true });
        $('panel').hidden = true;
      } else {
        game = null;
        setText($('waiting-text'), m.players.length < 2 ? 'ЖДЁМ ДРУГА...' : m.players.every(p => p.ready && p.connected) ? 'ВСЕ НА МЕСТЕ' : 'ДРУГ ПОДКЛЮЧИЛСЯ · ПОВЕРНИТЕ ЭКРАН');
      }
    }
  };
  ws.onclose = ev => {
    if (socket !== ws || !room) return;
    if (ev.code === 4001) { socket = null; toast('Комната открыта в другой вкладке'); mode = 'menu'; game = null; room = null; sessionSave(); screen('home'); return; }
    if (ev.code === 1000 || reconnects >= 16) { socket = null; game = null; room = null; sessionSave(); mode = 'menu'; screen('home'); error('Соединение закрыто. Создайте новую комнату.'); return; }
    pause ||= { until: Date.now() + 20000 };
    reconnects++; reconnectTimer = setTimeout(() => { if (room) connect(room); }, Math.min(1500, 400 + reconnects * 150));
  };
  ws.onerror = () => {};
}
async function fullscreen() {
  try {
    if (tg?.isVersionAtLeast?.('8.0')) tg.requestFullscreen();
    else if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  } catch {}
  try { if (screenOrientation()?.lock) await screenOrientation().lock('landscape'); } catch {}
  orientation();
}
function screenOrientation() { return window.screen?.orientation; }
function orientation(force = false) {
  const landscape = innerWidth > innerHeight;
  $('rotate').hidden = landscape;
  try {
    if (tg?.isVersionAtLeast?.('8.0')) {
      if (landscape) tg.lockOrientation(); else tg.unlockOrientation();
    }
  } catch {}
  const ready = landscape && !document.hidden;
  if (!ready) releaseControls();
  if (mode === 'online' && (force || ready !== lastReady)) { lastReady = ready; send({ type: 'ready', ready, version: C.VERSION }); }
}
function practice() {
  disconnect(true); mode = 'practice'; self = 0;
  game = createGame(cryptoSeed(), cryptoSeed() % 2); accumulator = 0;
  lastPhase = ''; $('panel').hidden = true; $('result').hidden = true;
  $('game').focus({ preventScroll: true });
}
function localControl(held) {
  if (held === inputHeld) return;
  inputHeld = held;
  if (!game) return;
  setControl(game, self, held);
  if (mode === 'online') {
    const command = { type: 'control', seq: ++seq, held };
    pending.push(command); send(command);
  }
  if (held && !activeFlight(game)) { try { tg?.HapticFeedback?.impactOccurred('light'); } catch {} }
}
function pressControl(key) {
  if (!game || game.phase !== 'running' || pause || !game.players[self].alive || document.hidden || innerWidth <= innerHeight) return;
  controls.add(key); localControl(true);
}
function releaseControl(key) {
  controls.delete(key); localControl(controls.size > 0);
}
function releaseControls() {
  controls.clear(); localControl(false);
}
function center(label, value, note = '', className = '') {
  const el = $('center-message'); el.hidden = false; el.className = `center-message ${className}`;
  setText(el.querySelector('p'), label); setText(el.querySelector('strong'), value); setText(el.querySelector('small'), note);
}
function updateUI() {
  setText($('speed'), game && game.phase !== 'countdown' ? `×${speedAt(game.elapsed).toFixed(1)}` : '—');
  setText($('time'), game && game.phase !== 'countdown' ? clock(Math.max(0, C.DURATION - game.elapsed)) : '—');
  if (!game) { $('center-message').hidden = true; return; }
  if (pause && ['running', 'countdown'].includes(game.phase)) {
    center('ЖДЁМ СОЕДИНЕНИЕ', String(Math.max(0, Math.ceil((pause.until - Date.now()) / 1000))), 'ВЕРНИТЕСЬ В ИГРУ · ЭКРАН ГОРИЗОНТАЛЬНО', 'paused'); return;
  }
  if (game.phase === 'countdown') center('НАЧАЛО ЧЕРЕЗ', String(Math.max(1, Math.ceil(game.countdown))), 'ТЫ — СИНИЙ. ДРУГ — КРАСНЫЙ.');
  else if (game.phase === 'running') {
    const remaining = respawnSeconds(game, self);
    if (remaining !== null) {
      releaseControls();
      center('ТЫ ВЕРНЁШЬСЯ ЧЕРЕЗ', String(remaining), '', 'respawn');
    }
    else $('center-message').hidden = true;
  }
  if (['won', 'lost', 'aborted'].includes(game.phase)) {
    releaseControls();
    $('center-message').hidden = true; $('result').hidden = false;
    setText($('result-title'), game.phase === 'won' ? 'ФИНИШ!' : game.phase === 'aborted' ? 'СВЯЗЬ ПРЕРВАНА' : 'НЕ ДОБЕЖАЛИ');
    setText($('result-eyebrow'), game.phase === 'won' ? 'ШЕСТЬ МИНУТ. ОДНА КОМАНДА.' : game.phase === 'aborted' ? 'ПОПРОБУЙТЕ ПОДКЛЮЧИТЬСЯ СНОВА' : 'ОБА ВЫБЫЛИ. НОВАЯ ПОПЫТКА?');
    setText($('result-stats'), `${clock(game.elapsed)} / ${clock(C.DURATION)} · ПРЫЖКОВ: ${game.players.reduce((n, p) => n + p.jumps, 0)}`);
    const asked = remote?.players?.[self]?.rematch;
    $('again').disabled = mode === 'online' && !!asked;
    setText($('rematch-status'), asked ? 'ЖДЁМ, КОГДА ДРУГ НАЖМЁТ «ЕЩЁ РАЗ»' : remote?.players?.some(p => p.rematch) ? 'ДРУГ ГОТОВ К НОВОЙ ПОПЫТКЕ' : '');
  } else if (game.phase !== lastPhase) $('result').hidden = true;
  lastPhase = game.phase;
}
function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, .05); lastFrame = now;
  if (game && !pause && !document.hidden && innerWidth > innerHeight) {
    const onlineFresh = mode !== 'online' || now - lastState < 180;
    if (onlineFresh) {
      accumulator += dt;
      while (accumulator >= C.DT) {
        if (mode === 'practice') {
          if (activeFlight(game)) { if (game.tick % 8 === 0) setControl(game, 1, botFlightHeld(game, 1)); }
          else if (botWantsJump(game, 1)) jump(game, 1);
        }
        // Predict only until the next server snapshot. Outcomes and effects
        // reconcile to the authoritative state on every packet.
        step(game); accumulator -= C.DT;
      }
    } else if (now - lastState > 2000) pause ||= { until: Date.now() + 20000 };
  }
  if (mode === 'practice') feedback.consume(game, self, !document.hidden);
  renderer.draw(game, self, dt, now / 1000); updateUI(); requestAnimationFrame(frame);
}
function invitation() {
  return botUsername ? `https://t.me/${botUsername}?startapp=room_${room.code}` : `${location.origin}/?room=${room.code}`;
}
$('create').addEventListener('click', () => { fullscreen(); busy($('create'), async () => { disconnect(true); game = null; connect(await request('/api/rooms', {})); }); });
$('open-join').addEventListener('click', () => screen('join'));
function setCode(value) { enteredCode = value.replace(/\D/g, '').slice(0, 4); $('room-code').textContent = enteredCode.padEnd(4, '—'); }
for (let n = 0; n <= 9; n++) { const b = document.createElement('button'); b.textContent = n; b.setAttribute('aria-label', `Цифра ${n}`); b.onclick = () => setCode(enteredCode + n); document.querySelector('.keypad').append(b); }
$('clear-code').onclick = () => setCode('');
$('join').onclick = () => {
  if (!/^\d{4}$/.test(enteredCode)) { error('Введите четыре цифры кода.'); return; }
  const code = enteredCode;
  fullscreen(); busy($('join'), async () => { disconnect(true); game = null; connect(await request(`/api/rooms/${code}/join`, {})); });
};
$('share').onclick = async () => {
  if (!room) return;
  const url = invitation(), text = `Дойди до финиша со мной! Комната ${room.code}.`;
  if (tg?.initData) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  else if (navigator.share) { try { await navigator.share({ title: 'С прицепом', text, url }); } catch {} }
  else toast(`ПЕРЕДАЙ ДРУГУ КОД: ${room.code}`);
};
$('practice').onclick = () => { fullscreen(); practice(); };
$('again').onclick = () => { if (mode === 'practice') practice(); else send({ type: 'rematch' }); };
document.querySelectorAll('[data-home]').forEach(b => b.onclick = home);
$('game').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  $('game').setPointerCapture(e.pointerId); pressControl(`pointer-${e.pointerId}`);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('game').addEventListener(type, e => releaseControl(`pointer-${e.pointerId}`));
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', 'c', 'x', 'a'].includes(e.key.toLowerCase())) { e.preventDefault(); return; }
  if (!$('screen-join').hidden && !$('panel').hidden) {
    if (/^\d$/.test(e.key)) { e.preventDefault(); setCode(enteredCode + e.key); }
    if (e.key === 'Backspace') { e.preventDefault(); setCode(enteredCode.slice(0, -1)); }
    if (e.key === 'Enter') { e.preventDefault(); $('join').click(); }
    return;
  }
  if (e.target instanceof HTMLButtonElement) return;
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); if (!e.repeat) pressControl(e.code); }
});
addEventListener('keyup', e => { if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); releaseControl(e.code); } });
addEventListener('blur', releaseControls);
for (const event of ['copy', 'cut', 'paste', 'selectstart', 'contextmenu', 'dragstart'])
  document.addEventListener(event, e => e.preventDefault());
for (const event of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(event, e => e.preventDefault(), { passive: false });
document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false });
addEventListener('resize', () => orientation()); document.addEventListener('visibilitychange', () => orientation(true));
setInterval(() => send({ type: 'ping', sent: performance.now() }), 3000);
try {
  tg?.ready(); tg?.expand(); tg?.setHeaderColor('#000000'); tg?.setBackgroundColor('#000000');
  if (tg?.isVersionAtLeast?.('7.7')) tg.disableVerticalSwipes();
  const inset = () => {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      document.documentElement.style.setProperty(`--safe-${side}`, `${Math.max(tg?.safeAreaInset?.[side] || 0, tg?.contentSafeAreaInset?.[side] || 0)}px`);
    }
  };
  tg?.onEvent('safeAreaChanged', inset); tg?.onEvent('contentSafeAreaChanged', inset); inset();
} catch {}
fetch('/api/config').then(r => r.json()).then(c => botUsername = c.botUsername || '').catch(() => {});
const start = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
const invite = new URLSearchParams(location.search).get('room') || start.replace(/^room_/, '');
if (/^\d{4}$/.test(invite)) { screen('join'); setCode(invite); }
else { try { const saved = JSON.parse(sessionStorage.getItem('tow-room')); if (saved?.token && /^\d{4}$/.test(saved.code)) connect(saved); } catch {} }
orientation(); requestAnimationFrame(frame);
