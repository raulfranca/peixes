'use strict';
(function () {
  // ===================================================================
  // Regras do jogo
  // ===================================================================
  const SETTINGS_KEY = 'contracorrente:settings';
  const settings = Object.assign({ sound: true, demo: false, dailyLimit: true }, load(SETTINGS_KEY));
  const DEMO = !!settings.demo;
  const DAY = DEMO ? 60 * 1000 : 24 * 60 * 60 * 1000; // no modo demonstração, 1 dia = 1 minuto
  const WEEK = 7 * DAY;                                // a corrente esvazia a barra inteira em 7 dias
  const TOUCH_GAIN = 0.3;                              // cada visita enche 30% da barra
  const STATE_KEY = DEMO ? 'contracorrente:demo' : 'contracorrente:v1';

  const N_FISH = 150;
  const ME_SPEED = 0.2;      // rad/s, sentido anti-horário
  const ME_RADIUS = 0.74;    // fração do raio do anel
  const CONV_DUR = 3.0;      // segundos para virar de lado
  const TAU = Math.PI * 2;

  const GRAY = [149, 159, 164];
  const BLUE = [76, 184, 240];
  const BLUE_ME = [108, 202, 250];

  // ===================================================================
  // Utilidades
  // ===================================================================
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sem armazenamento: segue em memória */ }
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const ease = (dt, rate) => 1 - Math.exp(-dt * rate);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Dia local (ou "dia" de 1 minuto no modo demonstração)
  const dayIndex = (ts) => Math.floor((ts - new Date(ts).getTimezoneOffset() * 60000) / DAY);
  const daysAgo = (ts) => dayIndex(Date.now()) - dayIndex(ts);
  function fmtAgo(ts) {
    const d = daysAgo(ts);
    if (d <= 0) return 'hoje';
    if (d === 1) return 'ontem';
    return `há ${d} dias`;
  }
  function fmtUntilZero(c) {
    const days = (c * WEEK) / DAY;
    if (days < 1) {
      const h = Math.round(days * 24);
      return h <= 1 ? 'em menos de uma hora' : `em ${h} horas`;
    }
    const n = Math.round(days);
    return n === 1 ? 'em 1 dia' : `em ${n} dias`;
  }
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  const pct = (v) => `${Math.round(v * 100)}%`;

  // ===================================================================
  // Estado salvo
  // ===================================================================
  let state = load(STATE_KEY);
  if (!state || typeof state.seed !== 'number' || typeof state.people !== 'object') {
    state = { seed: (Math.random() * 2 ** 31) | 0, me: null, people: {}, log: [] };
  }
  state.log = Array.isArray(state.log) ? state.log : [];
  const save = () => store(STATE_KEY, state);
  save();

  function progressOf(p, now = Date.now()) {
    if (p.converted) return 1;
    return clamp(p.progress - (now - p.updatedAt) / WEEK, 0, 1);
  }
  function visitedToday(p) {
    return settings.dailyLimit && p.lastVisitAt != null && daysAgo(p.lastVisitAt) <= 0;
  }
  const peopleList = () => Object.keys(state.people).map((k) => ({ slot: +k, p: state.people[k] }));
  const convertedCount = () => peopleList().filter((x) => x.p.converted).length;
  const againstCount = () => (state.me ? 1 : 0) + convertedCount();

  // ===================================================================
  // O cardume
  // ===================================================================
  const fish = [];
  (function makeFish() {
    const rnd = mulberry32(state.seed);
    for (let i = 0; i < N_FISH; i++) {
      const tri = (rnd() + rnd()) / 2;
      const rf = 0.5 + 0.5 * tri;
      const w0 = 0.15 + 0.065 * rnd();
      fish.push({
        i, rf, rfCur: rf, w0, w: w0,
        theta: rnd() * TAU,
        wobA: 0.012 + 0.028 * rnd(), wobF: 0.15 + 0.35 * rnd(), wobP: rnd() * TAU,
        size: 0.82 + 0.36 * rnd(), sizeMul: 1,
        shade: 0.72 + 0.3 * rnd(),
        tailP: rnd() * TAU,
        x: 0, y: 0, vx: 0, vy: 0, speed: 0, heading: 0, ready: false,
        kind: 'gray',   // 'gray' | 'blue' | 'me'
        blue: 0,        // quanto de azul permanente
        flash: 0,       // brilho passageiro do toque
        slow: 1, slowTarget: 1,
        conv: null,
        free: false,
      });
    }
  })();

  let me = null;
  function becomeMe(f) {
    me = f;
    f.kind = 'me';
    f.blue = 1;
    f.w = -ME_SPEED;
    f.rf = ME_RADIUS;
    f.sizeMul = 1.18;
  }
  if (state.me && fish[state.me.slot]) becomeMe(fish[state.me.slot]);
  for (const { slot, p } of peopleList()) {
    const f = fish[slot];
    if (!f || f === me) { delete state.people[slot]; continue; }
    if (p.converted) { f.kind = 'blue'; f.blue = 1; f.w = -f.w0; }
  }

  function startConversion(f, { toW, toKind, toSize = 1, done }) {
    f.conv = { t0: T, fromW: f.w, toW, toKind, fromSize: f.sizeMul, toSize, done };
  }

  // ===================================================================
  // Canvas, câmera e layout
  // ===================================================================
  const canvas = $('sea');
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, R = 160, fishLen = 14;
  const cam = { x: 0, y: 0, s: 1, tx: 0, ty: 0, ts: 1 };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    R = Math.max(110, Math.min(W * 0.45, (H - 150) / 2.16));
    fishLen = clamp(R * 0.1, 14, 30);
    updateCamTarget(true);
  }

  function updateCamTarget(snap) {
    const top = 64;
    const sheetH = sheetIsOpen ? sheet.offsetHeight : 0;
    const bottom = H - (sheetIsOpen ? sheetH : 40);
    const avail = bottom - top;
    cam.tx = W / 2;
    cam.ty = top + avail / 2;
    cam.ts = clamp(avail / (2 * R * 1.1), 0.42, 1);
    if (!sheetIsOpen) { cam.ty = H / 2 + 8; cam.ts = 1; }
    if (snap) { cam.x = cam.tx; cam.y = cam.ty; cam.s = cam.ts; }
  }

  // Textura de grão de filme
  const grain = document.createElement('canvas');
  (function makeGrain() {
    grain.width = grain.height = 180;
    const g = grain.getContext('2d');
    const img = g.createImageData(180, 180);
    for (let k = 0; k < img.data.length; k += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = Math.random() * 70;
    }
    g.putImageData(img, 0, 0);
  })();
  const grainPattern = ctx.createPattern(grain, 'repeat');

  // Partículas de luz em suspensão
  const motes = Array.from({ length: 42 }, () => ({
    u: Math.random(), v: Math.random(), z: 0.3 + Math.random() * 0.7, ph: Math.random() * TAU,
  }));
  const ripples = [];
  const sparks = [];

  // ===================================================================
  // Movimento
  // ===================================================================
  let T = 0;
  let visit = null;
  let selected = null;

  function turnToward(f, target, maxStep, prefer) {
    let d = angDiff(target, f.heading);
    if (prefer && Math.abs(d) > 2.4 && Math.sign(d) !== prefer) d += prefer * TAU;
    f.heading += clamp(d, -maxStep, maxStep);
  }

  function updateOrbit(f, dt) {
    let w = f.w;
    let rOff = 0;
    let wobK = 1;
    let turnRate = 7;
    let prefer = 0;
    if (f.conv) {
      const c = f.conv;
      const k = clamp((T - c.t0) / CONV_DUR, 0, 1);
      const s = smooth(0.28, 0.82, k);
      w = lerp(c.fromW, c.toW, s);
      f.blue = Math.max(f.blue, smooth(0.02, 0.42, k));
      f.sizeMul = lerp(c.fromSize, c.toSize, smooth(0.1, 0.6, k));
      const bump = Math.sin(Math.PI * k);
      rOff = bump * 0.05;
      wobK = 1 - bump;
      turnRate = 2.6;
      prefer = -1; // o nariz vira para fora do anel
      if (k >= 1) {
        f.conv = null;
        f.w = c.toW;
        f.kind = c.toKind;
        if (c.done) c.done();
      }
    }
    const weff = w * f.slow * (reduced ? 0.55 : 1);
    f.theta += weff * dt;
    f.rfCur += (f.rf - f.rfCur) * ease(dt, 0.9);
    const wob = wobK * f.wobA * Math.sin(T * f.wobF + f.wobP);
    const dwob = wobK * f.wobA * f.wobF * Math.cos(T * f.wobF + f.wobP);
    const r = R * (f.rfCur + wob + rOff);
    const dr = R * dwob;
    const cs = Math.cos(f.theta), sn = Math.sin(f.theta);
    f.x = r * cs; f.y = r * sn;
    f.vx = -r * weff * sn + dr * cs;
    f.vy = r * weff * cs + dr * sn;
    f.speed = Math.hypot(f.vx, f.vy);
    const dir = Math.sign(weff || w || f.w || 1);
    const desired = f.speed > 1.5 && !f.conv ? Math.atan2(f.vy, f.vx) : f.theta + dir * Math.PI / 2;
    if (!f.ready) { f.heading = desired; f.ready = true; }
    turnToward(f, desired, turnRate * dt, prefer);
  }

  function updateFree(f, dt) {
    const v = visit;
    v.t += dt;
    if (v.phase === 'seek') {
      const tg = v.target;
      const dx0 = tg.x - f.x, dy0 = tg.y - f.y;
      const dist = Math.hypot(dx0, dy0);
      const lead = clamp(dist / (R * 1.2), 0.05, 0.6);
      const ax = tg.x + tg.vx * lead, ay = tg.y + tg.vy * lead;
      const desired = Math.atan2(ay - f.y, ax - f.x);
      turnToward(f, desired, (dist < fishLen * 4 ? 7 : 3.4) * dt, 0);
      const cruise = R * 0.95;
      const targetSpeed = dist < fishLen * 3 ? Math.max(cruise * 0.55, tg.speed * 1.6) : cruise;
      f.speed += (targetSpeed - f.speed) * ease(dt, 2.4);
      f.x += Math.cos(f.heading) * f.speed * dt;
      f.y += Math.sin(f.heading) * f.speed * dt;
      const reach = fishLen * 0.62 * (f.size * f.sizeMul + tg.size * tg.sizeMul) / 2;
      if (Math.hypot(tg.x - f.x, tg.y - f.y) < reach || v.t > 9) {
        v.phase = 'recoil';
        v.t = 0;
        onTouch();
      }
    } else {
      // pequeno recuo depois do toque e volta à corrente
      const tangent = Math.atan2(f.y, f.x) - Math.PI / 2;
      turnToward(f, tangent, 2.6 * dt, 0);
      const orbitSpeed = R * f.rfCur * ME_SPEED;
      f.speed += (orbitSpeed - f.speed) * ease(dt, 3);
      f.x += Math.cos(f.heading) * f.speed * dt;
      f.y += Math.sin(f.heading) * f.speed * dt;
      if (v.t > 1.0) {
        f.theta = Math.atan2(f.y, f.x);
        const wob = f.wobA * Math.sin(T * f.wobF + f.wobP);
        f.rfCur = Math.hypot(f.x, f.y) / R - wob;
        f.free = false;
        finishVisit();
      }
    }
  }

  function update(dt) {
    T += dt;
    const k = ease(dt, 4.5);
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.s += (cam.ts - cam.s) * k;

    for (const f of fish) {
      f.slow += (f.slowTarget - f.slow) * ease(dt, 2.5);
      if (f.free) updateFree(f, dt); else updateOrbit(f, dt);
      f.flash = Math.max(0, f.flash - dt / 1.9);
      f.tailP += dt * (5 + Math.min(14, f.speed / (fishLen * 0.6)) + (f.conv ? 6 : 0));
    }
    for (let n = ripples.length - 1; n >= 0; n--) {
      ripples[n].t += dt / ripples[n].dur;
      if (ripples[n].t >= 1) ripples.splice(n, 1);
    }
    for (let n = sparks.length - 1; n >= 0; n--) {
      const s = sparks[n];
      s.t += dt / s.dur;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vx *= 1 - dt * 1.4; s.vy *= 1 - dt * 1.4;
      if (s.t >= 1) sparks.splice(n, 1);
    }
    if (!reduced) {
      for (const m of motes) {
        m.v -= dt * 0.004 * m.z;
        m.u += Math.sin(T * 0.2 + m.ph) * dt * 0.0015;
        if (m.v < -0.02) { m.v = 1.02; m.u = Math.random(); }
      }
    }
    if (intro) intro.tick();
  }

  // ===================================================================
  // Desenho
  // ===================================================================
  const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  function fishPath(L, tail) {
    const b = L * 0.19;
    const jx = -L * 0.22;
    const c = Math.cos(tail), s = Math.sin(tail);
    const tp = (px, py) => [jx + (px - jx) * c - py * s, (px - jx) * s + py * c];
    const up = tp(-L * 0.52, -L * 0.2);
    const notch = tp(-L * 0.4, 0);
    const lo = tp(-L * 0.52, L * 0.2);
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0);
    ctx.bezierCurveTo(L * 0.36, -b * 1.2, L * 0.02, -b * 1.1, jx, -b * 0.16);
    ctx.lineTo(up[0], up[1]);
    ctx.quadraticCurveTo(lerp(up[0], notch[0], 0.4), lerp(up[1], notch[1], 0.6) , notch[0], notch[1]);
    ctx.quadraticCurveTo(lerp(lo[0], notch[0], 0.4), lerp(lo[1], notch[1], 0.6), lo[0], lo[1]);
    ctx.lineTo(jx, b * 0.16);
    ctx.bezierCurveTo(L * 0.02, b * 1.1, L * 0.36, b * 1.2, L * 0.5, 0);
    ctx.closePath();
  }

  function tintOf(f) {
    const p = state.people[f.i];
    if (!p || p.converted) return 0;
    return progressOf(p) * 0.38;
  }

  function drawFish(f, alpha) {
    const L = fishLen * f.size * f.sizeMul;
    const base = [GRAY[0] * f.shade, GRAY[1] * f.shade, GRAY[2] * f.shade];
    const target = f.kind === 'me' ? BLUE_ME : BLUE;
    const m = Math.max(f.blue, tintOf(f), f.flash * 0.92);
    const glow = f.kind === 'me' ? 1 : Math.max(f.blue * 0.65, f.flash);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.heading);
    ctx.globalAlpha = alpha;
    if (glow > 0.02) {
      ctx.shadowColor = `rgba(76,184,240,${0.75 * glow})`;
      ctx.shadowBlur = 16 * glow * dpr * cam.s;
    }
    ctx.fillStyle = rgb(mix(base, target, m));
    fishPath(L, Math.sin(f.tailP) * 0.32);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a0e11';
    ctx.fillRect(0, 0, W, H);

    const g = ctx.createRadialGradient(cam.x, cam.y, 0, cam.x, cam.y, R * cam.s * 1.7);
    g.addColorStop(0, 'rgba(30,52,63,0.55)');
    g.addColorStop(0.55, 'rgba(18,31,38,0.32)');
    g.addColorStop(1, 'rgba(10,14,17,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // poeira de luz
    for (const m of motes) {
      const a = (0.05 + 0.13 * m.z) * (0.6 + 0.4 * Math.sin(T * 0.7 + m.ph));
      ctx.fillStyle = `rgba(200,220,228,${a})`;
      ctx.beginPath();
      ctx.arc(m.u * W, m.v * H, 0.5 + m.z * 1.1, 0, TAU);
      ctx.fill();
    }

    const fade = intro ? intro.fade : 1;

    // mundo
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.x, dpr * cam.y);

    // a corrente: arcos tênues girando no sentido do cardume
    ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const r = R * (0.52 + k * 0.095);
      const a0 = T * (0.1 + k * 0.012) * (reduced ? 0.5 : 1) + k * 1.7;
      ctx.strokeStyle = `rgba(150,172,182,${0.035 * fade})`;
      ctx.lineWidth = 1.4 / cam.s;
      ctx.beginPath();
      ctx.arc(0, 0, r, a0, a0 + 0.9 + (k % 3) * 0.25);
      ctx.stroke();
    }

    for (const f of fish) if (f.kind === 'gray' && !f.conv) drawFish(f, fade);
    for (const f of fish) if ((f.kind !== 'gray' || f.conv) && f !== me) drawFish(f, fade);
    if (me) drawFish(me, fade);

    for (const rp of ripples) {
      const a = (1 - rp.t) * (1 - rp.t);
      ctx.strokeStyle = `rgba(76,184,240,${0.7 * a})`;
      ctx.lineWidth = (rp.w || 1.6) / cam.s;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, fishLen * (0.5 + rp.t * rp.size), 0, TAU);
      ctx.stroke();
    }
    for (const s of sparks) {
      ctx.fillStyle = `rgba(140,210,250,${(1 - s.t) * 0.9})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 - s.t * 0.5), 0, TAU);
      ctx.fill();
    }

    if (selected) {
      const pulse = 0.5 + 0.5 * Math.sin(T * 3.2);
      const named = !!state.people[selected.i] || selected === me;
      ctx.strokeStyle = named ? `rgba(76,184,240,${0.4 + 0.35 * pulse})` : `rgba(230,237,239,${0.3 + 0.35 * pulse})`;
      ctx.lineWidth = 1.3 / cam.s;
      ctx.beginPath();
      ctx.arc(selected.x, selected.y, fishLen * (0.95 + 0.08 * pulse) * selected.size * selected.sizeMul, 0, TAU);
      ctx.stroke();
    }

    // nomes, em pixels de tela para ficarem nítidos
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fade > 0.5) drawLabels();

    // grão
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = grainPattern;
    const ox = reduced ? 0 : (Math.random() * 180) | 0, oy = reduced ? 0 : (Math.random() * 180) | 0;
    ctx.translate(-ox, -oy);
    ctx.fillRect(0, 0, W + ox, H + oy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  function drawLabels() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '500 11px Jost, "Avenir Next", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(6,10,12,0.9)';
    ctx.shadowBlur = 6 * dpr;
    const one = (f, name, prog, isBlue) => {
      const sx = cam.x + f.x * cam.s;
      const sy = cam.y + f.y * cam.s + fishLen * 0.5 * cam.s + 5;
      const strong = f === selected;
      ctx.globalAlpha = strong ? 1 : 0.68;
      ctx.fillStyle = isBlue ? '#8fd3f7' : '#dfe7ea';
      ctx.fillText(name, sx, sy);
      if (prog != null) {
        const bw = 24;
        ctx.globalAlpha = strong ? 0.9 : 0.6;
        ctx.fillStyle = 'rgba(149,159,164,0.35)';
        ctx.fillRect(sx - bw / 2, sy + 15, bw, 2);
        ctx.fillStyle = '#4cb8f0';
        ctx.fillRect(sx - bw / 2, sy + 15, bw * prog, 2);
      }
    };
    for (const { slot, p } of peopleList()) {
      const f = fish[slot];
      one(f, p.name, p.converted ? null : progressOf(p), p.converted || !!f.conv);
    }
    if (me && state.me) one(me, state.me.name, null, true);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // posição do centro do anel no DOM
  const centerEl = $('center');
  let lastCenter = '';
  function placeCenter() {
    const size = R * 0.86;
    const key = `${cam.x.toFixed(1)}|${cam.y.toFixed(1)}|${cam.s.toFixed(3)}|${size.toFixed(0)}`;
    if (key === lastCenter) return;
    lastCenter = key;
    centerEl.style.width = centerEl.style.height = `${size}px`;
    centerEl.style.fontSize = `${clamp(R * 0.14, 17, 40)}px`;
    centerEl.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s}) translate(-50%, -50%)`;
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    update(dt);
    draw();
    placeCenter();
    requestAnimationFrame(frame);
  }

  // ===================================================================
  // Som e vibração
  // ===================================================================
  const sound = (() => {
    let ac = null;
    function audio() {
      if (!settings.sound) return null;
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(freq, at, dur, gain) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + at;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    return {
      unlock: () => audio(),
      touch() {
        const f = 587.33 * (1 + (Math.random() - 0.5) * 0.03);
        tone(f, 0, 1.1, 0.07); tone(f * 1.5, 0.07, 0.9, 0.035); tone(f * 2, 0, 0.5, 0.018);
      },
      name() { tone(783.99, 0, 0.7, 0.04); tone(1174.66, 0.08, 0.6, 0.02); },
      convert() {
        [392, 493.88, 587.33, 739.99, 783.99, 987.77].forEach((f, n) => tone(f, n * 0.16, 2.8 - n * 0.2, 0.045));
      },
    };
  })();
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* sem vibração */ } };

  // ===================================================================
  // Interface: ficha, pílula, toast, dica
  // ===================================================================
  const sheet = $('sheet');
  const sheetBody = $('sheet-body');
  let sheetIsOpen = false;
  let sheetView = null;     // { kind, fish, ... }
  let sheetLocked = false;  // ficha que não fecha (nome inicial)

  function openSheet(view, html, { locked = false } = {}) {
    sheetView = view;
    sheetLocked = locked;
    sheetBody.innerHTML = html;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    sheet.inert = false;
    sheetIsOpen = true;
    sheet.scrollTop = 0;
    $('hint').hidden = true;
    requestAnimationFrame(() => updateCamTarget(false));
  }
  function closeSheet(force) {
    if (!sheetIsOpen || (sheetLocked && !force)) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.inert = true;
    sheetIsOpen = false;
    sheetView = null;
    if (!visit) select(null);
    updateCamTarget(false);
    refreshHint();
  }
  if (window.ResizeObserver) new ResizeObserver(() => sheetIsOpen && updateCamTarget(false)).observe(sheet);

  function select(f) {
    if (selected && selected !== f) selected.slowTarget = 1;
    selected = f;
    if (f && f !== me) f.slowTarget = 0.35;
  }

  let toastTimer = 0;
  function toast(text, ms = 3600) {
    const el = $('toast');
    if (visit) return;
    el.textContent = text;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function refreshHint() {
    const el = $('hint');
    if (!state.me || intro || sheetIsOpen || visit) { el.hidden = true; return; }
    const list = peopleList();
    let text = '';
    if (list.length === 0) text = 'Toque em qualquer ponto do cardume para dar nome a alguém.';
    else if (!list.some((x) => x.p.visits > 0)) text = `Toque em ${list[0].p.name} para fazer uma visita.`;
    if (!text) { el.hidden = true; return; }
    if (el.textContent !== text || el.hidden) { el.textContent = text; el.hidden = false; }
  }

  function refreshChrome() {
    const n = peopleList().length;
    const badge = $('net-badge');
    badge.textContent = n;
    badge.hidden = n === 0;
    $('top-actions').hidden = !state.me;
    $('demo-chip').hidden = !DEMO;
    $('count-num').textContent = againstCount();
    $('count-cap').textContent = 'contra a corrente';
  }

  // ---------- telas da ficha ----------
  function meterHTML(v, id = 'card') {
    return `<div class="meter" role="progressbar" aria-label="Proximidade" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v * 100)}">
      <div class="meter-track"><div class="meter-fill" id="${id}-fill" style="width:${(v * 100).toFixed(1)}%"></div></div>
      <span class="meter-val" id="${id}-val">${pct(v)}</span>
    </div>`;
  }

  function statusLine(p) {
    if (p.converted) return `Mudou de lado em ${fmtDate(p.convertedAt)} · ${p.visits} ${p.visits === 1 ? 'visita' : 'visitas'}`;
    const c = progressOf(p);
    const parts = [p.lastVisitAt ? `Última visita ${fmtAgo(p.lastVisitAt)}` : 'Ainda sem visitas'];
    if (c > 0.005) parts.push(`a corrente esvazia a barra ${fmtUntilZero(c)}`);
    else if (p.visits > 0) parts.push('a barra esfriou');
    return parts.join(' · ');
  }

  function openName(f) {
    select(f);
    openSheet({ kind: 'name', fish: f }, `
      <div class="head">
        <p class="eyebrow">Um peixe do cardume</p>
        <h2 class="title">Quem é esse peixinho?</h2>
      </div>
      <p class="lede">Dê a ele o nome de alguém da sua vida. Alguém que você quer visitar, cuidar e chamar para perto.</p>
      <form class="field-row" data-form="name" autocomplete="off">
        <label class="sr" for="fish-name">Nome da pessoa</label>
        <input class="input" id="fish-name" name="name" maxlength="24" placeholder="Nome da pessoa" required enterkeyhint="done">
        <button class="btn primary" type="submit">Dar nome</button>
      </form>
      <button class="btn text" type="button" data-act="close">Agora não</button>`);
    focusSoon('fish-name');
  }

  function openCard(f, opts = {}) {
    const p = state.people[f.i];
    if (!p) return openName(f);
    select(f);
    const c = progressOf(p);
    const today = !p.converted && visitedToday(p);
    const lede = opts.justNamed
      ? `<p class="lede">Cada visita acende <strong>30%</strong> da barra. A corrente apaga tudo em <strong>7 dias</strong>. Quando a barra encher, ${esc(p.name)} fica azul e muda de lado.</p>`
      : '';
    const visitBtn = p.converted
      ? `<button class="btn primary" type="button" data-act="visit">Nadar até ${esc(p.name)}</button>`
      : `<button class="btn primary" type="button" data-act="visit" ${today ? 'disabled' : ''}>${today ? 'Visitado hoje' : `Visitar ${esc(p.name)}`}</button>`;
    openSheet({ kind: 'card', fish: f }, `
      <div class="head">
        <p class="eyebrow ${p.converted ? 'blue' : ''}">${p.converted ? 'Contra a corrente' : 'No cardume'} · desde ${fmtDate(p.createdAt)}</p>
        <h2 class="title ${p.converted ? 'blue' : ''}" id="card-title">${esc(p.name)}</h2>
      </div>
      ${lede}
      ${p.converted ? '' : meterHTML(c)}
      <p class="meta" id="card-meta">${statusLine(p)}</p>
      ${today ? '<p class="note">Uma visita por dia conta. Volte amanhã para manter a barra acesa.</p>' : ''}
      <div class="actions">
        ${visitBtn}
        <button class="btn ghost round" type="button" data-act="more" aria-label="Mais opções" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="more" id="more" hidden>
        <button class="btn ghost small" type="button" data-act="rename">Renomear</button>
        ${p.converted ? '' : '<button class="btn danger small" type="button" data-act="release">Soltar no cardume</button>'}
      </div>`);
  }

  function openRename(f) {
    const isMe = f === me;
    const current = isMe ? state.me.name : state.people[f.i].name;
    openSheet({ kind: 'rename', fish: f }, `
      <div class="head">
        <p class="eyebrow">Renomear</p>
        <h2 class="title">${esc(current)}</h2>
      </div>
      <form class="field-row" data-form="rename" autocomplete="off">
        <label class="sr" for="rename-input">Novo nome</label>
        <input class="input" id="rename-input" name="name" maxlength="24" value="${esc(current)}" required enterkeyhint="done">
        <button class="btn primary" type="submit">Salvar</button>
      </form>
      <button class="btn text" type="button" data-act="back">Voltar</button>`);
    focusSoon('rename-input', true);
  }

  function weekVisits() {
    const since = Date.now() - WEEK;
    return state.log.filter((t) => t >= since).length;
  }

  function openMe() {
    select(me);
    const n = peopleList().length;
    openSheet({ kind: 'me', fish: me }, `
      <div class="head">
        <p class="eyebrow blue">Você · o primeiro a virar de lado</p>
        <h2 class="title blue">${esc(state.me.name)}</h2>
      </div>
      <div class="stats">
        <div class="stat"><b>${n}</b><span>na sua rede</span></div>
        <div class="stat"><b class="blue">${againstCount()}</b><span>contra a corrente</span></div>
        <div class="stat"><b>${weekVisits()}</b><span>visitas nos últimos 7 dias</span></div>
      </div>
      <p class="lede">Toque num peixe cinza para dar nome a alguém. Toque em alguém com nome para visitar.</p>
      <div class="actions">
        <button class="btn ghost" type="button" data-act="net">Ver sua rede</button>
        <button class="btn text" type="button" data-act="rename">Renomear</button>
      </div>`);
  }

  function openNet() {
    select(null);
    const list = peopleList();
    const now = Date.now();
    const canVisit = [], visited = [], against = [];
    for (const x of list) {
      x.c = progressOf(x.p, now);
      if (x.p.converted) against.push(x);
      else if (visitedToday(x.p)) visited.push(x);
      else canVisit.push(x);
    }
    const byProg = (a, b) => b.c - a.c;
    canVisit.sort(byProg); visited.sort(byProg);
    against.sort((a, b) => (b.p.convertedAt || 0) - (a.p.convertedAt || 0));
    const item = (x) => `<li><button class="net-item ${x.p.converted ? 'converted' : ''}" type="button" data-act="goto" data-slot="${x.slot}">
        <span class="net-name">${esc(x.p.name)}</span>
        <span class="mini" aria-hidden="true"><span style="width:${(x.c * 100).toFixed(1)}%"></span></span>
        <span class="net-status">${x.p.converted ? `Mudou de lado em ${fmtDate(x.p.convertedAt)}` : `${pct(x.c)} · ${x.p.lastVisitAt ? `última visita ${fmtAgo(x.p.lastVisitAt)}` : 'ainda sem visitas'}`}</span>
      </button></li>`;
    const group = (label, arr) => (arr.length ? `<p class="group-label">${label} · ${arr.length}</p><ul class="net">${arr.map(item).join('')}</ul>` : '');
    const body = list.length
      ? group(settings.dailyLimit ? 'Para visitar hoje' : 'No cardume', canVisit) + group('Visitados hoje', visited) + group('Contra a corrente', against)
      : '<p class="lede">Ninguém ainda. Feche esta ficha e toque em qualquer ponto do cardume para dar nome a alguém.</p>';
    openSheet({ kind: 'net' }, `
      <div class="head">
        <p class="eyebrow">Sua rede</p>
        <h2 class="title">${list.length === 1 ? '1 pessoa' : `${list.length} pessoas`}</h2>
      </div>
      ${body}`);
  }

  function openSettings() {
    select(null);
    const sw = (key, label, small) => `<div class="switch-row"><div><span>${label}</span>${small ? `<small>${small}</small>` : ''}</div>
      <button class="switch" type="button" role="switch" aria-checked="${!!settings[key]}" aria-label="${label}" data-act="toggle" data-key="${key}"></button></div>`;
    openSheet({ kind: 'settings' }, `
      <div class="head">
        <p class="eyebrow">Ajustes</p>
        <h2 class="title">Como a corrente funciona</h2>
      </div>
      <ul class="rules">
        <li><b>+30%</b><span>a cada visita a alguém do cardume.</span></li>
        <li><b>7 dias</b><span>é o que a corrente leva para esvaziar uma barra cheia.</span></li>
        <li><b>100%</b><span>e o peixe fica azul, vira de lado e passa a nadar com você.</span></li>
      </ul>
      <div>
        ${sw('dailyLimit', 'Uma visita por pessoa por dia', 'Visitas repetidas no mesmo dia não enchem a barra.')}
        ${sw('sound', 'Som')}
        ${sw('demo', 'Modo demonstração', '1 dia vira 1 minuto, num aquário separado. Recarrega o app.')}
      </div>
      <p class="sub-title">Seus dados</p>
      <p class="meta">Tudo fica salvo só neste aparelho. Exporte um arquivo para guardar ou levar para outro aparelho.</p>
      <div class="actions">
        <button class="btn ghost small" type="button" data-act="export">Exportar</button>
        <button class="btn ghost small" type="button" data-act="import">Importar</button>
        <button class="btn danger small" type="button" data-act="reset">Recomeçar do zero</button>
      </div>`);
  }

  function openCelebration(p) {
    const n = againstCount();
    const thirteen = n === 13 ? '<p class="lede"><strong>Treze contra a corrente.</strong> Como no começo.</p>' : '';
    openSheet({ kind: 'celebrate' }, `
      <div class="head">
        <p class="eyebrow blue">Mudou de lado</p>
        <h2 class="title blue">${esc(p.name)} agora nada com você.</h2>
      </div>
      <p class="lede">Já são <strong>${n}</strong> contra a corrente.</p>
      ${thirteen}
      <div class="actions"><button class="btn primary" type="button" data-act="close">Continuar</button></div>`);
  }

  function openIntroName(f) {
    select(f);
    openSheet({ kind: 'intro' }, `
      <div class="head">
        <p class="eyebrow blue">O primeiro</p>
        <h2 class="title blue">Esse peixinho é você.</h2>
      </div>
      <p class="lede">Ele virou de lado e agora nada contra a corrente. Como você se chama?</p>
      <form class="field-row" data-form="me" autocomplete="off">
        <label class="sr" for="me-name">Seu nome</label>
        <input class="input" id="me-name" name="name" maxlength="24" placeholder="Seu nome" required enterkeyhint="done">
        <button class="btn primary" type="submit">Sou eu</button>
      </form>`, { locked: true });
    focusSoon('me-name');
  }

  function focusSoon(id, selectAll) {
    setTimeout(() => {
      const el = $(id);
      if (!el) return;
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      if (selectAll) el.select();
    }, 380);
  }

  // atualiza a ficha aberta enquanto a corrente puxa a barra
  setInterval(() => {
    if (!sheetIsOpen || !sheetView) return;
    if (sheetView.kind === 'card') {
      const p = state.people[sheetView.fish.i];
      if (!p || p.converted) return;
      const c = progressOf(p);
      const fill = $('card-fill'), val = $('card-val'), meta = $('card-meta');
      if (fill && !fill.classList.contains('gain')) fill.style.width = `${(c * 100).toFixed(1)}%`;
      if (val) val.textContent = pct(c);
      if (meta) meta.textContent = statusLine(p);
    }
  }, DEMO ? 1000 : 30000);

  // ===================================================================
  // Ações
  // ===================================================================
  function nameFish(f, raw) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!name) return;
    const now = Date.now();
    state.people[f.i] = { name, progress: 0, updatedAt: now, createdAt: now, visits: 0, lastVisitAt: null, converted: false, convertedAt: null };
    save();
    f.flash = 0.55;
    ripples.push({ x: f.x, y: f.y, t: 0, dur: 1.1, size: 2.2 });
    sound.name();
    buzz(10);
    refreshChrome();
    openCard(f, { justNamed: true });
  }

  function startVisit(f) {
    if (visit || !me || f === me) return;
    closeSheet(true);
    select(f);
    f.slowTarget = 0.45;
    me.free = true;
    me.speed = Math.max(me.speed, R * me.rfCur * ME_SPEED);
    visit = { target: f, phase: 'seek', t: 0 };
    const p = state.people[f.i];
    const c = progressOf(p);
    $('toast').hidden = true;
    $('pill-text').textContent = p.converted ? `Nadando até ${p.name}` : `Visitando ${p.name}`;
    $('pill-fill').style.width = `${(c * 100).toFixed(1)}%`;
    $('pill').querySelector('.pill-meter').hidden = !!p.converted;
    $('pill').hidden = false;
    refreshHint();
  }

  function onTouch() {
    const f = visit.target;
    const p = state.people[f.i];
    f.flash = 1;
    f.rfCur += 0.025; // o toquinho empurra de leve
    ripples.push({ x: (f.x + me.x) / 2, y: (f.y + me.y) / 2, t: 0, dur: 1.2, size: 3 });
    ripples.push({ x: f.x, y: f.y, t: 0, dur: 1.8, size: 4.5, w: 1 });
    sound.touch();
    buzz(14);
    if (!p) return;
    const now = Date.now();
    if (p.converted) {
      p.visits += 1;
      p.lastVisitAt = now;
      state.log.push(now);
      save();
      $('pill-text').textContent = `Você e ${p.name}, contra a corrente`;
      return;
    }
    const before = progressOf(p, now);
    const counts = !visitedToday(p);
    if (!counts) {
      $('pill-text').textContent = `${p.name} sentiu o toque`;
      return;
    }
    const after = Math.min(1, before + TOUCH_GAIN);
    p.progress = after;
    p.updatedAt = now;
    p.visits += 1;
    p.lastVisitAt = now;
    state.log.push(now);
    state.log = state.log.filter((t) => t > now - 30 * DAY);
    save();
    $('pill-text').textContent = `${p.name} sentiu o toque · ${pct(after)}`;
    $('pill-fill').style.width = `${(after * 100).toFixed(1)}%`;
    if (after >= 1) visit.convert = true;
  }

  function finishVisit() {
    const v = visit;
    const f = v.target;
    const p = state.people[f.i];
    f.slowTarget = 1;
    if (v.convert && p) {
      setTimeout(() => convert(f, p), 300);
    }
    setTimeout(() => {
      $('pill').hidden = true;
      visit = null;
      if (!v.convert) {
        if (selected === f) select(null);
        refreshHint();
      }
    }, v.convert ? 300 : 1400);
  }

  function convert(f, p) {
    p.converted = true;
    p.convertedAt = Date.now();
    p.progress = 1;
    save();
    select(f);
    f.slowTarget = 1;
    sound.convert();
    buzz([20, 60, 40]);
    startConversion(f, {
      toW: -f.w0,
      toKind: 'blue',
      done() {
        for (let n = 0; n < 28; n++) {
          const a = Math.random() * TAU, s = R * (0.12 + Math.random() * 0.35);
          sparks.push({ x: f.x, y: f.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 0.8 + Math.random() * 1.6, t: 0, dur: 1.2 + Math.random() * 1.2 });
        }
        ripples.push({ x: f.x, y: f.y, t: 0, dur: 2.2, size: 7, w: 1.2 });
        refreshChrome();
        const num = $('count-num');
        num.classList.remove('pulse'); void num.offsetWidth; num.classList.add('pulse');
        openCelebration(p);
      },
    });
  }

  function releaseFish(f) {
    delete state.people[f.i];
    save();
    f.slowTarget = 1;
    refreshChrome();
    closeSheet(true);
    toast('Voltou a ser um peixe sem nome no cardume.');
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'contracorrente', version: 1, exportedAt: new Date().toISOString(), demo: DEMO, state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `contracorrente-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Arquivo exportado.');
  }

  $('import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const s = data.state || data;
        if (typeof s.seed !== 'number' || typeof s.people !== 'object') throw new Error('formato');
        store(STATE_KEY, s);
        location.reload();
      } catch (err) {
        toast('Esse arquivo não é um backup do Contracorrente.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---------- cliques dentro da ficha ----------
  sheet.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const f = sheetView && sheetView.fish;
    switch (act) {
      case 'close': closeSheet(); break;
      case 'visit': if (f) startVisit(f); break;
      case 'more': {
        const more = $('more');
        more.hidden = !more.hidden;
        btn.setAttribute('aria-expanded', String(!more.hidden));
        break;
      }
      case 'rename': if (f) openRename(f); break;
      case 'back': if (f) (f === me ? openMe() : openCard(f)); break;
      case 'release':
        if (btn.classList.contains('armed')) releaseFish(f);
        else { btn.classList.add('armed'); btn.textContent = `Tocar de novo para soltar ${state.people[f.i].name}`; }
        break;
      case 'net': openNet(); break;
      case 'goto': {
        const target = fish[+btn.dataset.slot];
        if (target) openCard(target);
        break;
      }
      case 'toggle': {
        const key = btn.dataset.key;
        settings[key] = !settings[key];
        store(SETTINGS_KEY, settings);
        btn.setAttribute('aria-checked', String(settings[key]));
        if (key === 'demo') setTimeout(() => location.reload(), 250);
        if (key === 'sound' && settings.sound) sound.name();
        break;
      }
      case 'export': exportData(); break;
      case 'import': $('import-file').click(); break;
      case 'reset':
        if (btn.classList.contains('armed')) {
          try { localStorage.removeItem(STATE_KEY); } catch (err) { /* nada a apagar */ }
          location.reload();
        } else {
          btn.classList.add('armed');
          btn.textContent = DEMO ? 'Tocar de novo para apagar o aquário de teste' : 'Tocar de novo para apagar tudo';
        }
        break;
    }
  });

  sheet.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const value = (form.elements.name && form.elements.name.value) || '';
    const kind = form.dataset.form;
    const f = sheetView && sheetView.fish;
    if (kind === 'name' && f) nameFish(f, value);
    if (kind === 'me') finishIntro(value);
    if (kind === 'rename' && f) {
      const name = value.trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!name) return;
      if (f === me) { state.me.name = name; save(); openMe(); }
      else { state.people[f.i].name = name; save(); openCard(f); }
      refreshHint();
    }
  });

  // ---------- toques no mar ----------
  function pick(sx, sy) {
    const wx = (sx - cam.x) / cam.s, wy = (sy - cam.y) / cam.s;
    const hitNamed = 36 / cam.s, hitAny = 60 / cam.s;
    let best = null, bestScore = Infinity;
    for (const f of fish) {
      const d = Math.hypot(f.x - wx, f.y - wy);
      const named = f === me || !!state.people[f.i];
      if (d > (named ? hitNamed : hitAny)) continue;
      const score = d - (named ? 16 / cam.s : 0);
      if (score < bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    sound.unlock();
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 12) return;
    handleTap(e.clientX, e.clientY);
  });

  function handleTap(sx, sy) {
    if (intro || !state.me) return;
    if (visit) { return; }
    if (sheetLocked) return;
    const f = pick(sx, sy);
    if (!f) { closeSheet(); return; }
    if (f.conv) return;
    if (f === me) openMe();
    else if (state.people[f.i]) openCard(f);
    else openName(f);
  }

  $('btn-net').addEventListener('click', () => { if (!visit && !intro) openNet(); });
  $('btn-settings').addEventListener('click', () => { if (!visit && !intro) openSettings(); });
  centerEl.addEventListener('click', () => { if (!visit && !intro && state.me) openNet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('resize', resize);

  // ===================================================================
  // Abertura
  // ===================================================================
  let intro = null;
  const centerLine = $('center-line');
  const countEl = $('center-count');

  function line(text) {
    centerLine.classList.remove('show');
    setTimeout(() => {
      centerLine.textContent = text;
      if (text) centerLine.classList.add('show');
    }, text ? 700 : 0);
  }

  function pickIntroFish() {
    let best = fish[0], bd = Infinity;
    const tx = 0, ty = -R * 0.72;
    for (const f of fish) {
      const d = Math.hypot(f.x - tx, f.y - ty) + Math.abs(f.rf - 0.74) * R;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function startIntro() {
    countEl.hidden = true;
    centerLine.hidden = false;
    $('skip').hidden = false;
    const steps = [
      [1.2, () => line('Todos nadam para o mesmo lado.')],
      [5.0, () => line('')],
      [5.6, () => line('Até que um deles…')],
      [7.4, () => convertIntro()],
      [8.6, () => line('')],
    ];
    intro = {
      t: 0,
      fade: 0,
      step: 0,
      chosen: null,
      tick() {
        this.t = T - this.t0;
        this.fade = smooth(0.1, 2.6, this.t);
        while (this.step < steps.length && this.t >= steps[this.step][0]) { steps[this.step][1](); this.step++; }
      },
      t0: T,
    };
    function convertIntro() {
      if (!intro || intro.chosen) return;
      const f = pickIntroFish();
      intro.chosen = f;
      f.slowTarget = 0.6;
      sound.convert();
      startConversion(f, {
        toW: -ME_SPEED,
        toKind: 'me',
        toSize: 1.18,
        done() {
          becomeMe(f);
          f.slowTarget = 1;
          ripples.push({ x: f.x, y: f.y, t: 0, dur: 2.2, size: 6, w: 1.2 });
          $('skip').hidden = true;
          openIntroName(f);
        },
      });
    }
    intro.skip = () => {
      steps.length = 0;
      line('');
      intro.fade = 1;
      intro.t0 = T - 10;
      if (!intro.chosen) {
        const f = pickIntroFish();
        intro.chosen = f;
        f.heading += Math.PI;
        f.blue = 1;
        becomeMe(f);
        f.ready = false;
      }
      if (!intro.chosen.conv) { $('skip').hidden = true; openIntroName(intro.chosen); }
    };
  }

  $('skip').addEventListener('click', () => intro && intro.skip());

  function finishIntro(raw) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!name || !intro || !me) return;
    state.me = { name, slot: me.i, createdAt: Date.now() };
    save();
    intro = null;
    sheetLocked = false;
    closeSheet(true);
    centerLine.hidden = true;
    countEl.hidden = false;
    refreshChrome();
    sound.name();
    setTimeout(refreshHint, 600);
  }

  // ===================================================================
  // Início
  // ===================================================================
  resize();
  refreshChrome();
  if (state.me) {
    centerLine.hidden = true;
    countEl.hidden = false;
    refreshHint();
    // lembrete gentil de quem a corrente está levando
    const cooling = peopleList()
      .filter((x) => !x.p.converted && x.p.lastVisitAt && daysAgo(x.p.lastVisitAt) >= 3 && progressOf(x.p) > 0)
      .sort((a, b) => progressOf(a.p) - progressOf(b.p));
    if (cooling.length) setTimeout(() => toast(`A corrente está levando ${cooling[0].p.name}. Que tal uma visita?`, 5200), 1800);
  } else {
    startIntro();
  }
  requestAnimationFrame((t) => { lastFrame = t; requestAnimationFrame(frame); });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sem modo offline aqui */ });
    });
  }
})();
