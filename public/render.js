import { C, FLIGHT, speedAt, distanceAt, timeAtDistance, localColor, jumpCue, activeFlight, flightCorridor, trapHeight } from './engine.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.seed = null; this.lastEvent = 0;
    this.particles = []; this.rope = 1; this.anchor = .3; this.ys = [0, 0]; this.zoom = 1;
    this.flightKey = ''; this.flightTrails = [[], []]; this.roadPositions = null; this.lastFlightPositions = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.ctx.imageSmoothingEnabled = false;
  }
  burst(x, y, color, gather = false, direction = 1) {
    const count = this.reduced ? 8 : 28;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, force = 70 + Math.random() * 190;
      this.particles.push({ x, y, ox: x, oy: y, vx: Math.cos(a) * force, vy: Math.sin(a) * force - 80 * direction, direction, color, life: 0, duration: gather ? .5 : .85, size: 3 + Math.random() * 7, gather });
    }
  }
  draw(game, self, dt, now) {
    const ctx = this.ctx, { w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    if (this.seed !== (game?.seed ?? null)) {
      this.seed = game?.seed ?? null; this.lastEvent = 0; this.particles = [];
      this.ys = [0, 0]; this.rope = 1;
      this.flightKey = ''; this.flightTrails = [[], []]; this.roadPositions = null; this.lastFlightPositions = null;
    }
    const base = Math.min(w / 1280, h / 660);
    if (game && activeFlight(game)) { this.drawFlight(game, self, dt, now, base); return; }
    const phase = game?.phase, active = phase === 'running';
    let zoom = active ? Math.max(.48, .82 * Math.sqrt(C.START_SPEED / speedAt(game.elapsed))) : 1;
    if (active && (game.players.some(p => p.y > 215) || game.orbs.some(o => o.x > game.distance - 220 && o.x < game.distance + C.BASE_SPEED * speedAt(game.elapsed) * 2.1))) zoom = Math.min(zoom, .68);
    if (active) for (const group of game.groups) {
      if (group.action === 'stairs' && group.x + group.w > game.distance - 200 && group.x < game.distance + C.BASE_SPEED * speedAt(game.elapsed) * 2.6)
        zoom = Math.min(zoom, h * .58 / (base * (group.h + 240)));
    }
    this.zoom += (zoom - this.zoom) * Math.min(1, dt * 5);
    const s = base * this.zoom, floorY = h * .775, ceilingY = h * .225;
    const side = game?.roadSide ?? 1;
    const transfer = game ? Math.min(1, Math.max(0, (game.elapsed - game.flipAt) / C.FLIP_DURATION)) : 1;
    const ease = transfer * transfer * (3 - 2 * transfer);
    const from = game?.flipFrom === -1 ? 1 : 0, to = side === -1 ? 1 : 0;
    const flipped = transfer < 1 ? from + (to - from) * ease : to;
    const direction = 1 - 2 * flipped;
    const ground = floorY + (ceilingY - floorY) * flipped;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, Math.max(0, ground - 3 * base)); ctx.clip();
    this.drawStars(now, base); ctx.restore();
    const alive = game ? game.players.filter(p => p.alive).length : 2;
    let target = !game || phase === 'countdown' || phase === 'won' ? .5 - (C.SEPARATION * s / w / 2) : .21;
    if (active && alive === 1) {
      const survivor = game.players.find(p => p.alive);
      target = .35 - survivor.offset * s / w;
    }
    this.anchor += (target - this.anchor) * Math.min(1, dt * 4);
    const ox = w * this.anchor;
    const players = game?.players || [0, 1].map(id => ({ id, offset: id * C.SEPARATION, y: 0, vy: 0, alive: true, shieldUntil: 0, spawnAt: -10 }));
    const positions = players.map(p => {
      this.ys[p.id] += (p.y - this.ys[p.id]) * Math.min(1, dt * 35);
      return { x: ox + p.offset * s, y: ground - direction * (this.ys[p.id] + C.SIZE / 2) * s };
    });
    if (game && this.lastFlightPositions && game.elapsed - game.flightExitAt < .45) {
      const t = Math.max(0, (game.elapsed - game.flightExitAt) / .45), u = t * t * (3 - 2 * t);
      for (let id = 0; id < 2; id++) {
        positions[id].x = this.lastFlightPositions[id].x * (1 - u) + positions[id].x * u;
        positions[id].y = this.lastFlightPositions[id].y * (1 - u) + positions[id].y * u;
      }
    }
    this.roadPositions = positions.map(p => ({ ...p }));
    const floor = ctx.createLinearGradient(0, 0, w, 0);
    floor.addColorStop(0, '#17171a'); floor.addColorStop(.25, '#7e7e84'); floor.addColorStop(.75, '#7e7e84'); floor.addColorStop(1, '#17171a');
    // Crossfade the roads while the cubes move between them. The HUD never rotates.
    for (const [roadY, roadAlpha, roadDirection] of [[floorY, 1 - flipped, 1], [ceilingY, flipped, -1]]) {
      if (roadAlpha <= 0) continue;
      ctx.globalAlpha = roadAlpha; ctx.fillStyle = floor;
      ctx.fillRect(0, roadY, w, Math.max(2, 3 * base));
      if (game) {
        ctx.fillStyle = '#15151b';
        for (let i = 0; i < 16; i++) {
          const x = ((i * 130 - game.distance * s * .22) % (w + 130) + w + 130) % (w + 130);
          ctx.fillRect(x, roadY + roadDirection * 16 * base, 20 * base, base);
        }
        ctx.save(); ctx.translate(0, roadY); ctx.scale(1, roadDirection);
        for (const o of game.obstacles) {
          const x = ox + (o.x - game.distance) * s;
          if (x > w + 200 || x + o.w * s < -200) continue;
          this.obstacle(o, x, 0, s, now, game.elapsed);
        }
        for (const orb of game.orbs) {
          const x = ox + (orb.x - game.distance) * s;
          if (x < -100 || x > w + 100) continue;
          this.orb(orb, x, s, now, game.players[self].lastOrb === orb.id);
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (game) {
      if (active && transfer === 1) {
        const cue = jumpCue(game, self);
        if (cue && cue.at - game.elapsed < 2) {
          const x = ox + (cue.x - game.distance) * s;
          const markerScale = Math.max(.75, base);
          const progress = Math.max(0, Math.min(1, (game.elapsed - cue.earliest) / (cue.latest - cue.earliest)));
          // One small, soft pulse per jump window; no flashing screen or text.
          ctx.globalAlpha = cue.active ? (this.reduced ? .65 : .32 + Math.sin(progress * Math.PI) * .42) : .15;
          ctx.strokeStyle = '#00b5f1'; ctx.lineWidth = Math.max(1.5, 2 * markerScale);
          for (const lift of [11, 21]) {
            // Outside the road: the cube cannot cover its own timing cue.
            const y = ground - side * cue.height * s + side * lift * markerScale;
            ctx.beginPath(); ctx.moveTo(x - 8 * markerScale, y + side * 6 * markerScale);
            ctx.lineTo(x, y); ctx.lineTo(x + 8 * markerScale, y + side * 6 * markerScale); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        const nextFlip = game.flips[game.flipIndex];
        if (nextFlip && nextFlip - game.elapsed < 4) {
          const x = ox + (distanceAt(nextFlip) + C.SEPARATION / 2 - game.distance) * s;
          ctx.save(); ctx.translate(x, ground); ctx.scale(1, side);
          ctx.globalAlpha = .65; ctx.strokeStyle = '#b39ad9'; ctx.lineWidth = Math.max(1.5, 2 * s);
          ctx.beginPath(); ctx.moveTo(0, -12 * s); ctx.lineTo(-13 * s, -70 * s);
          ctx.lineTo(0, -128 * s); ctx.lineTo(13 * s, -70 * s); ctx.closePath(); ctx.stroke();
          ctx.restore();
        }
        const nextFlight = game.flights.find(f => f.start > game.elapsed);
        if (nextFlight && nextFlight.start - game.elapsed < 2.4) {
          const x = ox + (distanceAt(nextFlight.start) + C.SEPARATION / 2 - game.distance) * s;
          ctx.save(); ctx.translate(x, ground); ctx.scale(1, side);
          ctx.strokeStyle = '#9a8ae6'; ctx.fillStyle = '#171229'; ctx.lineWidth = Math.max(2, 3 * s);
          ctx.beginPath(); ctx.moveTo(-46 * s, 0); ctx.lineTo(-46 * s, -235 * s);
          ctx.lineTo(0, -275 * s); ctx.lineTo(46 * s, -235 * s); ctx.lineTo(46 * s, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#d3c6ff'; ctx.beginPath(); ctx.moveTo(-25 * s, -18 * s); ctx.lineTo(-25 * s, -221 * s);
          ctx.lineTo(0, -243 * s); ctx.lineTo(25 * s, -221 * s); ctx.lineTo(25 * s, -18 * s); ctx.stroke();
          ctx.restore();
        }
      }
      this.events(game, self, positions, side);
    }
    const ropeTarget = alive === 2 ? 1 : 0;
    this.rope += (ropeTarget - this.rope) * Math.min(1, dt * (ropeTarget ? 5 : 8));
    if (this.rope > .015) {
      const a = positions[0], b = positions[1];
      const survivor = players[0].alive ? a : b, other = survivor === a ? b : a;
      const end = { x: survivor.x + (other.x - survivor.x) * this.rope, y: survivor.y + (other.y - survivor.y) * this.rope };
      ctx.globalAlpha = this.rope; ctx.strokeStyle = '#e6e6eb'; ctx.lineWidth = Math.max(1.5, 2.6 * s); ctx.beginPath();
      ctx.moveTo(survivor.x, survivor.y);
      ctx.quadraticCurveTo((survivor.x + end.x) / 2, (survivor.y + end.y) / 2 + direction * (7 * s + Math.sin(now * 6) * 3 * s + (1 - this.rope) * 45 * s), end.x, end.y);
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const p of players) {
      if (!p.alive) continue;
      const pos = positions[p.id], t = game ? game.elapsed - p.spawnAt : 10;
      const grow = Math.min(1, .15 + t * 2.1), color = localColor(p.id, self);
      const size = C.SIZE * s * grow;
      ctx.save(); ctx.translate(pos.x, pos.y);
      const angle = p.y > 0 && !p.grounded ? Math.max(0, (C.JUMP - p.vy) / C.GRAVITY) / FLIGHT * Math.PI : 0;
      ctx.rotate(side * angle + flipped * Math.PI);
      if (game && p.shieldUntil > game.elapsed) {
        ctx.globalAlpha = this.reduced ? .7 : .65 + Math.sin(now * 8) * .15;
        ctx.strokeStyle = color; ctx.lineWidth = 2 * s; ctx.strokeRect(-size / 2 - 7 * s, -size / 2 - 7 * s, size + 14 * s, size + 14 * s);
        ctx.globalAlpha = .85;
      }
      ctx.fillStyle = color; ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = '#000'; ctx.fillRect(-size * .29, -size * .29, size * .58, size * .58);
      ctx.fillStyle = '#fff'; ctx.fillRect(-size * .15, -size * .15, size * .3, size * .3);
      ctx.restore();
      if (p.id === self && (phase === 'countdown' || (active && game.elapsed < 4))) {
        ctx.fillStyle = '#f5f5f7'; ctx.textAlign = 'center'; ctx.font = `${Math.max(9, 14 * base)}px Press, monospace`;
        ctx.fillText('ТЫ', pos.x, pos.y - side * (C.SIZE * s / 2 + 18 * base));
      }
    }
    this.drawParticles(dt, base);
  }
  events(game, self, positions, side = 1) {
    for (const e of game.events) {
      if (e.id <= this.lastEvent) continue;
      this.lastEvent = e.id;
      if (game.elapsed - e.t > .5) continue;
      if (e.type === 'death' || e.type === 'respawn' || e.type === 'boost') {
        const p = positions[e.player];
        this.burst(p.x, p.y, e.type === 'boost' ? '#ffdb63' : localColor(e.player, self), e.type === 'respawn', side);
      }
      if (e.type === 'win') {
        this.burst(this.w * .3, this.h * .3, '#00b5f1'); this.burst(this.w * .7, this.h * .3, '#ff507e');
      }
    }
  }
  drawParticles(dt, base) {
    const ctx = this.ctx;
    this.particles = this.particles.filter(p => p.life < p.duration);
    for (const p of this.particles) {
      p.life += dt; const t = Math.min(1, p.life / p.duration);
      let x, y;
      if (p.gather) { x = p.ox + p.vx * .3 * (1 - t); y = p.oy + p.vy * .3 * (1 - t); }
      else { x = p.ox + p.vx * p.life; y = p.oy + p.vy * p.life + p.direction * 160 * p.life * p.life; }
      ctx.globalAlpha = p.gather ? 1 - t * .6 : 1 - t; ctx.fillStyle = p.color;
      ctx.fillRect(x, y, p.size * base, p.size * base);
    }
    ctx.globalAlpha = 1;
  }
  drawStars(now, base) {
    const c = this.ctx, count = Math.min(52, Math.max(18, Math.floor(this.w * this.h / 29000)));
    const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    for (let i = 0; i < count; i++) {
      const clock = (this.reduced ? .5 : now / (10 + i % 8)) + hash(i + 8);
      const cycle = this.reduced ? 0 : Math.floor(clock), age = this.reduced ? .5 : clock % 1;
      const x = ((hash(i * 7 + cycle * 43) + .045 - age * .045) % 1) * this.w;
      const y = (hash(i * 13 + cycle * 19 + 5) - age * .018) * this.h;
      const size = Math.max(.8, base * (.8 + hash(i + 96) * .65));
      c.globalAlpha = Math.sin(age * Math.PI) ** 2 * (.17 + hash(i + 47) * .24);
      c.fillStyle = '#fff'; c.fillRect(x, y, size, size);
    }
    c.globalAlpha = 1;
  }
  drawFlight(game, self, dt, now, base) {
    const c = this.ctx, { w, h } = this, f = activeFlight(game);
    const key = `${game.seed}:${f.id}`;
    if (key !== this.flightKey) { this.flightKey = key; this.flightTrails = [[], []]; }
    const elapsed = game.elapsed - f.start;
    const transfer = Math.min(1, Math.max(0, elapsed / C.FLY_ENTRY));
    const blend = transfer * transfer * (3 - 2 * transfer);
    const sy = h * .81 / 1000, top = h * .145, ox = w * .24;
    const sx = w * .64 / (distanceAt(Math.min(C.DURATION, game.elapsed + 2.4)) - game.distance);
    const palette = ['#162129', '#211c30', '#142720', '#2b2518', '#271b28', '#16252e'][f.id];
    const edge = ['#81959f', '#928aa7', '#83a394', '#a59c7f', '#a487a2', '#7b9aa9'][f.id];
    const samples = [[], []];
    for (let x = -40; x <= w + 60; x += 20) {
      const t = timeAtDistance(game.distance + (x - ox) / sx) - f.start;
      for (let lane = 0; lane < 2; lane++) {
        const b = flightCorridor(f, t, lane);
        samples[lane].push({ x, top: top + b.top * sy, bottom: top + b.bottom * sy });
      }
    }
    c.save(); c.globalAlpha = Math.min(1, transfer * 1.6);
    const upper = samples[0], lower = samples[1];
    const fill = c.createLinearGradient(0, top, 0, top + 1000 * sy);
    fill.addColorStop(0, '#0c1017'); fill.addColorStop(.5, palette); fill.addColorStop(1, '#0b0f16');
    c.fillStyle = fill;
    const polygon = points => { c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.fill(); };
    polygon([{ x: -40, y: top }, { x: w + 60, y: top }, ...upper.slice().reverse().map(p => ({ x: p.x, y: p.top }))]);
    polygon([...upper.map(p => ({ x: p.x, y: p.bottom })), ...lower.slice().reverse().map(p => ({ x: p.x, y: p.top }))]);
    polygon([...lower.map(p => ({ x: p.x, y: p.bottom })), { x: w + 60, y: h }, { x: -40, y: h }]);
    // Layered wall rims, rivets and a quiet light strip make the tower distinct
    // from the open road. No decorative shape extends into the hit corridor.
    for (const lane of samples) for (const side of ['top', 'bottom']) {
      c.beginPath(); lane.forEach((p, i) => i ? c.lineTo(p.x, p[side]) : c.moveTo(p.x, p[side]));
      c.strokeStyle = '#303a48'; c.lineWidth = Math.max(4, 7 * base); c.stroke();
      c.strokeStyle = edge; c.lineWidth = Math.max(1.5, 2.4 * base); c.stroke();
    }
    for (let lane = 0; lane < 2; lane++) for (const knot of f.paths[lane]) {
      const x = ox + (distanceAt(f.start + knot.t) - game.distance) * sx;
      if (x < -20 || x > w + 20) continue;
      c.fillStyle = '#536170';
      for (const sign of [-1, 1]) {
        const y = top + (knot.y + sign * (knot.half + 15)) * sy;
        c.fillRect(x - 2 * base, y - 2 * base, 4 * base, 4 * base);
        c.globalAlpha *= .55; c.fillRect(x - 12 * base, y + sign * 9 * base, 24 * base, Math.max(1, base)); c.globalAlpha /= .55;
      }
    }
    c.restore();
    c.save(); c.beginPath();
    for (const lane of samples) {
      lane.forEach((p, i) => i ? c.lineTo(p.x, p.top) : c.moveTo(p.x, p.top));
      for (const p of lane.slice().reverse()) c.lineTo(p.x, p.bottom);
      c.closePath();
    }
    c.clip(); this.drawStars(now, base); c.restore();
    const positions = game.players.map(p => {
      const target = { x: ox + p.offset * sx, y: top + p.flyY * sy };
      const start = this.roadPositions?.[p.id] || target;
      return { x: start.x * (1 - blend) + target.x * blend, y: start.y * (1 - blend) + target.y * blend };
    });
    this.lastFlightPositions = positions.map(p => ({ ...p }));
    this.rope += (0 - this.rope) * Math.min(1, dt * 9);
    if (this.rope > .015 && game.players.every(p => p.alive)) {
      const a = positions[0], b = positions[1];
      c.globalAlpha = this.rope; c.strokeStyle = '#e6e6eb'; c.lineWidth = Math.max(1.5, 2 * base);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x + (b.x - a.x) * this.rope, a.y + (b.y - a.y) * this.rope); c.stroke(); c.globalAlpha = 1;
    }
    for (const p of game.players) {
      const color = localColor(p.id, self);
      const trail = this.flightTrails[p.id] = this.flightTrails[p.id].filter(q => q.t <= game.elapsed && q.t > game.elapsed - 1.65);
      if (p.alive && transfer === 1 && (!trail.length || game.elapsed > trail[trail.length - 1].t + .004))
        trail.push({ t: game.elapsed, y: p.flyY });
      if (trail.length > 1) {
        c.save(); c.strokeStyle = color; c.lineWidth = Math.max(2, 4.5 * base); c.lineJoin = 'bevel';
        c.shadowColor = color; c.shadowBlur = this.reduced ? 0 : 12 * base;
        c.globalAlpha = p.alive ? .82 : .42;
        c.beginPath();
        trail.forEach((q, i) => {
          const x = ox + (distanceAt(q.t) + p.offset - game.distance) * sx, y = top + q.y * sy;
          if (i) c.lineTo(x, y); else c.moveTo(x, y);
        });
        c.stroke(); c.restore();
      }
      if (!p.alive) continue;
      const pos = positions[p.id], grow = Math.min(1, .15 + (game.elapsed - p.spawnAt) * 2.1);
      const rx = C.BASE_SPEED * speedAt(game.elapsed) * sx * C.FLY_HALF_TIME * grow;
      const ry = C.FLY_RADIUS * sy * grow, lean = p.held ? -.5 : .5;
      c.save(); c.translate(pos.x, pos.y);
      if (p.shieldUntil > game.elapsed) {
        c.strokeStyle = color; c.globalAlpha = .55; c.lineWidth = Math.max(1, base);
        c.beginPath(); c.ellipse(0, 0, rx + 6 * base, ry + 6 * base, 0, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
      }
      c.fillStyle = color; c.beginPath(); c.moveTo(rx, lean * ry); c.lineTo(-rx, -ry);
      c.lineTo(-rx * .55, 0); c.lineTo(-rx, ry); c.closePath(); c.fill();
      c.fillStyle = '#07090d'; c.beginPath(); c.moveTo(rx * .58, lean * ry * .58);
      c.lineTo(-rx * .57, -ry * .55); c.lineTo(-rx * .36, ry * .48); c.closePath(); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(rx * .39, lean * ry * .4);
      c.lineTo(-rx * .32, -ry * .28); c.lineTo(-rx * .23, ry * .28); c.closePath(); c.fill();
      c.restore();
    }
    this.events(game, self, positions);
    this.drawParticles(dt, base);
  }
  orb(o, x, s, now, used) {
    const c = this.ctx, y = -o.y * s, r = o.r * s;
    c.save(); c.globalAlpha *= used ? .28 : 1;
    c.strokeStyle = '#ffdb63'; c.lineWidth = Math.max(2, 3 * s);
    c.shadowColor = '#f4c548'; c.shadowBlur = this.reduced ? 0 : 15 * s;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.shadowBlur = 0; c.strokeStyle = '#fff8dc'; c.lineWidth = Math.max(1.5, 2 * s);
    c.beginPath(); c.arc(x, y, r * .65, 0, Math.PI * 2); c.stroke();
    c.globalAlpha *= .28; c.strokeStyle = '#ffdb63';
    c.beginPath(); c.arc(x, y, r * (this.reduced ? 1.3 : 1.3 + Math.sin(now * 4) * .09), 0, Math.PI * 2); c.stroke();
    c.restore();
  }
  obstacle(o, x, ground, s, now, elapsed = 0) {
    const c = this.ctx, w = o.w * s, h = o.h * s;
    c.strokeStyle = '#f2f2f5'; c.fillStyle = '#000'; c.lineWidth = Math.max(2, 5 * s); c.lineJoin = 'miter';
    if (o.kind === 'tower') {
      const roof = Math.min(w * .7, h * .22);
      c.beginPath(); c.moveTo(x + w / 2, ground - h + c.lineWidth);
      c.lineTo(x + w - c.lineWidth / 2, ground - h + roof);
      c.lineTo(x + w - c.lineWidth / 2, ground - 2 * s);
      c.lineTo(x + c.lineWidth / 2, ground - 2 * s);
      c.lineTo(x + c.lineWidth / 2, ground - h + roof); c.closePath(); c.stroke();
      for (const ratio of [.28, .55, 1 - roof / h]) {
        c.beginPath(); c.moveTo(x + c.lineWidth, ground - h * ratio); c.lineTo(x + w - c.lineWidth, ground - h * ratio); c.stroke();
      }
      c.fillStyle = '#c9ad5c'; c.fillRect(x + w * .43, ground - h * .42, Math.max(2, w * .14), Math.max(3, 7 * s));
    } else if (o.kind === 'fake') {
      const lift = trapHeight(o, elapsed) * s, tip = Math.min(90 * s, lift);
      c.save(); c.strokeStyle = '#ff334e'; c.fillStyle = '#22080e'; c.lineWidth = Math.max(2, 3.5 * s);
      if (lift > 2 * s) {
        c.beginPath(); c.moveTo(x + c.lineWidth / 2, ground);
        c.lineTo(x + c.lineWidth / 2, ground - lift + tip);
        c.lineTo(x + w / 2, ground - lift);
        c.lineTo(x + w - c.lineWidth / 2, ground - lift + tip);
        c.lineTo(x + w - c.lineWidth / 2, ground); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#ff334e'; c.globalAlpha *= .6;
        c.beginPath(); c.moveTo(x + w * .25, ground - lift + tip * .9);
        c.lineTo(x + w / 2, ground - lift + 12 * s);
        c.lineTo(x + w * .75, ground - lift + tip * .9); c.closePath(); c.fill();
        c.globalAlpha /= .6;
      }
      c.fillStyle = '#3a0a15';
      c.fillRect(x, ground - h, w, h);
      c.strokeRect(x + c.lineWidth / 2, ground - h + c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth);
      c.fillStyle = '#ff334e';
      for (const q of [.25, .5, .75]) c.fillRect(x + w * q - 3 * s, ground - h * .62, 6 * s, 5 * s);
      c.restore();
    } else if (o.kind === 'step') {
      c.fillStyle = '#101317'; c.fillRect(x, ground - h, w, h);
      c.strokeStyle = '#b8c7d0'; c.lineWidth = Math.max(1.5, 2.5 * s);
      c.strokeRect(x + c.lineWidth / 2, ground - h + c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth);
      c.fillStyle = '#f0f6fa'; c.fillRect(x, ground - h, w, Math.max(2, 4 * s));
      c.fillStyle = '#27313a';
      for (let xx = x + 22 * s; xx < x + w - 12 * s; xx += 70 * s) c.fillRect(xx, ground - h + 14 * s, 22 * s, Math.max(1, 2 * s));
    } else if (o.kind === 'stack') {
      c.fillStyle = '#090a0c'; c.fillRect(x, ground - h, w, h);
      for (let i = 0; i < 2; i++) {
        const yy = ground - (i + 1) * h / 2;
        c.strokeRect(x + c.lineWidth / 2, yy + c.lineWidth / 2, w - c.lineWidth, h / 2 - c.lineWidth);
        const size = Math.min(w * .24, h * .12);
        c.fillStyle = '#f2f2f5'; c.fillRect(x + w / 2 - size / 2, yy + h / 4 - size / 2, size, size);
      }
    } else if (o.kind === 'spike' || o.kind === 'double') {
      const n = o.kind === 'double' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const xx = x + i * w / n, ww = w / n;
        c.beginPath(); c.moveTo(xx + c.lineWidth / 2, ground - 2 * s); c.lineTo(xx + ww / 2, ground - h + c.lineWidth); c.lineTo(xx + ww - c.lineWidth / 2, ground - 2 * s); c.closePath(); c.stroke();
      }
    } else if (o.kind === 'block') {
      c.strokeRect(x + c.lineWidth / 2, ground - h + c.lineWidth / 2, Math.max(1, w - c.lineWidth), Math.max(1, h - c.lineWidth));
      c.fillStyle = '#f2f2f5'; c.fillRect(x + w * .4, ground - h * .6, w * .2, h * .2);
    } else {
      c.save(); c.translate(x + w / 2, ground - h / 2); c.rotate(now * 2.8);
      c.lineWidth = Math.max(1.5, 2 * s); c.fillStyle = '#f2f2f5'; c.beginPath();
      for (let i = 0; i < 32; i++) {
        const a = i / 32 * Math.PI * 2, r = Math.min(w, h) / 2 * (i % 2 ? .76 : .95);
        if (!i) c.moveTo(Math.cos(a) * r, Math.sin(a) * r); else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fill(); c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, w * .22, 0, Math.PI * 2); c.fill(); c.restore();
    }
  }
}
