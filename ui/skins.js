/* =====================================================================
   PIXEL OFFICE — skins (Office perks · Farm · Space) + client side of the RPG layer.
   Loaded after the main script: it uses its drawing helpers (iso, poly, tile, box, R, shadow, shade, …).
   A skin replaces how the floor, the desks, the people and the sky are DRAWN; the data underneath
   (rooms = projects, desks = sessions) is the same for every skin.
   ===================================================================== */
(() => {
  'use strict';
  const RC = RPGCORE, sin = Math.sin, cos = Math.cos, PI2 = Math.PI * 2;
  const rnd = (n, seed) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
  const ell = (c, x, y, rx, ry, fill) => { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, PI2); c.fill(); };
  const line = (c, a, b, col, w = 1) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); };
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const working = () => AGENTS.filter(a => a.state === 'working').length;

  /* ---------- client side RPG state ---------- */
  const RPGV = window.RPGV = {
    state: null, listeners: [],
    set(s) { this.state = s; this.skew = Date.now() - (s.now || Date.now()); this.listeners.forEach(f => f(s)); },
    now() { return Date.now() - (this.skew || 0); },
    preview: null,                             // {level}: look at the world as it would be at that level (client-only, saved progress is untouched)
    level() { return this.preview ? this.preview.level : this.state ? this.state.company.level : 1; },
    company() { return this.state && this.state.company; },
    land(root) { if (this.preview) return this.fakeLand(root); return (this.state && this.state.lands[root]) || null; },
    char(sid) { if (this.preview) return { level: this.preview.level, title: RC.titleFor(this.preview.level), xp: 0, hi: 0 }; return (this.state && this.state.chars[sid]) || null; },
    fakeLand(root) {                           // a full, varied field for the preview
      const L = this.preview.level, kinds = RC.unlockedKinds(L), n = RC.maxPlots(Math.min(10, L)), now = Date.now(), plots = [];
      for (let i = 0; i < n; i++) plots.push({ c: i, k: kinds[(i + RC.hash(root)) % kinds.length], at: now - [0.05, 0.4, 0.7, 1.2][(i * 7 + RC.hash(root)) % 4] * RC.GROW_MS });
      return { name: 'preview', ...RC.progress(40 * 9, 'land'), plots, coins: 0, harvested: 0 };
    },
    demo() {                                   // pre-grown sample world for the file:// demo and for first-time users without a bridge
      const now = Date.now(), lands = {}; let n = 0;
      for (const k of DKEYS) { const plots = []; const used = new Set(); for (let i = 0; i < 14; i++) { let c; do c = Math.floor(rnd(i + n * 7, 3) * RC.CELLS.length); while (used.has(c)); used.add(c); plots.push({ c, k: Math.floor(rnd(i, n + 9) * 5), at: now - rnd(i, n + 2) * RC.GROW_MS * 1.5 }); } lands['demo:' + k] = { name: DIVS[k].label, ...RC.progress(400 + n * 220, 'land'), plots, coins: 40, harvested: 6 }; n++; }
      this.set({ now, company: { ...RC.progress(1240), streak: 4, today: { day: RC.dayKey(now), xp: 85 }, stats: { tools: 420, turns: 61, tokens: 880000, approvals: 12, harvests: 9, coins: 160, planted: 35 } }, lands, chars: {} });
    }
  };
  const rootFor = key => (typeof OBS !== 'undefined' && OBS) ? Object.keys(obsRoom).find(r => obsRoom[r] === key) : 'demo:' + key;
  const landFor = key => RPGV.land(rootFor(key));
  const cellXY = (key, i) => { const D = DIVS[key], [rx, ry] = RC.CELLS[i]; return [D.ox + rx, D.oy + ry]; };
  const rooms = () => { const s = soloKey(); return s ? [s] : DKEYS; };

  /* ---------- time of day + weather (shared by the Farm and Space skins) ---------- */
  const WX = { time: localStorage.getItem('po.time') || 'auto', weather: localStorage.getItem('po.weather') || 'auto', cur: 'sun', until: 0 };
  function hourNow(t) { if (WX.time === 'fast') return (t * 0.4) % 24; const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  function nightFactor(t) {
    if (WX.time === 'day') return 0; if (WX.time === 'night') return 1;
    const h = hourNow(t); return h >= 21 || h < 5 ? 1 : h >= 19.5 ? (h - 19.5) / 1.5 : h < 6.5 ? 1 - (h - 5) / 1.5 : 0;
  }
  function weather(t) {
    if (WX.weather !== 'auto') return WX.weather;
    const now = performance.now() / 1000;
    if (now > WX.until) { const p = .08 + .07 * Math.min(4, working()), r = Math.random(); WX.cur = r < p ? 'rain' : r < p + .3 ? 'cloud' : 'sun'; WX.until = now + 60 + Math.random() * 120; }
    return WX.cur;
  }
  const isNight = t => nightFactor(t) > .5;

  /* atmosphere drawn over the world: night tint, rain, sun glow, fog of clouds */
  function atmosphere(c, t, kind) {
    const n = nightFactor(t), w = weather(t);
    if (n > 0) { c.globalCompositeOperation = 'source-atop'; c.fillStyle = kind === 'space' ? `rgba(20,10,60,${.5 * n})` : `rgba(10,18,70,${.52 * n})`; c.fillRect(0, 0, W0, H0); c.globalCompositeOperation = 'source-over'; }
    if (n < .6 && w !== 'rain') { c.globalCompositeOperation = 'source-atop'; const g = c.createRadialGradient(W0 * .86, -20, 10, W0 * .86, -20, 640); g.addColorStop(0, `rgba(255,236,170,${.3 * (1 - n)})`); g.addColorStop(1, 'rgba(255,236,170,0)'); c.fillStyle = g; c.fillRect(0, 0, W0, H0); c.globalCompositeOperation = 'source-over'; }
    if (w === 'rain' && kind !== 'space') {
      c.strokeStyle = 'rgba(205,228,255,.8)'; c.lineWidth = 1.4; c.beginPath();
      for (let i = 0; i < 260; i++) { const sp = 200 + rnd(i, 1) * 140, x = (rnd(i, 2) * (W0 + 200) + t * 50) % (W0 + 200) - 100, y = (rnd(i, 3) * H0 + t * sp) % H0; c.moveTo(x, y); c.lineTo(x - 4, y + 13); }
      c.stroke();
      for (let i = 0; i < 18; i++) { const ph = (t * .9 + rnd(i, 4)) % 1, [x, y] = iso(1 + rnd(i, 5) * 14, 1 + rnd(i, 6) * 14, 0); c.strokeStyle = `rgba(210,230,255,${.55 * (1 - ph)})`; c.beginPath(); c.ellipse(x, y, 2 + ph * 7, 1 + ph * 3, 0, 0, PI2); c.stroke(); }
      c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(40,60,100,.2)'; c.fillRect(0, 0, W0, H0); c.globalCompositeOperation = 'source-over';
    }
  }
  function sky(c, t, kind) {                  // clouds / stars behind the island
    const n = nightFactor(t), w = weather(t);
    if (n > .2) { for (let i = 0; i < 70; i++) { const x = rnd(i, 7) * W0, y = rnd(i, 8) * H0 * .75, tw = .5 + .5 * sin(t * 2 + i); c.fillStyle = `rgba(255,255,255,${(.35 + .45 * tw) * Math.min(1, n * 1.5)})`; c.fillRect(Math.round(x), Math.round(y), i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1); } }
    if (kind === 'farm') {
      const nc = w === 'sun' ? 4 : 9; for (let i = 0; i < nc; i++) { const x = (rnd(i, 9) * (W0 + 300) + t * (4 + i)) % (W0 + 300) - 150, y = 40 + rnd(i, 10) * 190, s = 26 + rnd(i, 11) * 30, a = (w === 'rain' ? .75 : .5) * (1 - n * .6);
        c.fillStyle = `rgba(${w === 'rain' ? '150,160,185' : '255,255,255'},${a})`; for (const [dx, dy, r] of [[0, 0, 1], [.8, .12, .8], [-.8, .12, .75], [.3, -.28, .7]]) { c.beginPath(); c.ellipse(x + dx * s, y + dy * s, s * r * .9, s * r * .5, 0, 0, PI2); c.fill(); } }
    }
  }
  const SKY = {
    farm: (n, w) => { const d = ['#7ec8ff', '#bfe6ff', '#e9f7ff'], nn = ['#0b1030', '#1b2a5e', '#3a3f7a']; const mix = (a, b, f) => { const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * f)).join(',')})`; };
      const g = w === 'rain' ? ['#8a98ad', '#a9b4c4', '#c9d1dc'] : d; return `linear-gradient(180deg, ${mix(g[0], nn[0], n)}, ${mix(g[1], nn[1], n)} 55%, ${mix(g[2], nn[2], n)})`; },
    space: n => `radial-gradient(ellipse at 70% 10%, rgb(${Math.round(250 - 190 * n)},${Math.round(214 - 170 * n)},${Math.round(160 - 90 * n)}), rgb(${Math.round(222 - 170 * n)},${Math.round(150 - 110 * n)},${Math.round(104 - 50 * n)}) 55%, rgb(${Math.round(150 - 110 * n)},${Math.round(92 - 60 * n)},${Math.round(70 - 20 * n)}))`
  };
  let lastSky = '';
  function paintSky(t, kind) { const st = document.getElementById('stage'); if (!st) return; const n = Math.round(nightFactor(t) * 20) / 20, w = weather(t), key = kind + n + w; if (key === lastSky) return; lastSky = key; st.style.background = kind === 'farm' ? SKY.farm(n, w) : SKY.space(n); }

  /* ---------- people: a farmer and a little robot (same anchor/height as the office avatars) ---------- */
  function person(c, ax, ay, a, t, pose, kind) {
    const L = a.look, P = 2, ph = a.phase, work = pose === 'back' || pose === 'work', wave = pose === 'wait', sleep = pose === 'idle';
    const r = (u, top, w, h, col) => { c.fillStyle = col; c.fillRect(ax + u * P, ay - top * P, w * P, h * P); };
    const rc = RPGV.char(a.sid), lvl = rc ? rc.level : 1, bob = sleep ? 0 : Math.round(sin(t * (work ? 9 : 3) + ph) * 1);
    shadow(c, ax, ay + 1, 12, 5, .3);
    if (kind === 'farmer') {
      const shirt = L.shirt, bib = '#3d62b3', boot = '#5a3b22', hat = '#e6bc4a';
      if (sleep) { r(-9, 9, 18, 7, '#d8b85a'); r(-9, 9, 18, 1, '#f0d884'); r(-9, 2, 18, 1, '#a88a3a'); }      // hay bale seat
      const y0 = sleep ? 14 : 0;
      r(-3, y0 + 5, 2, 5, boot); r(1, y0 + 5, 2, 5, boot); r(-3, y0 + 10, 2, 8, bib); r(1, y0 + 10, 2, 8, bib);
      r(-4, y0 + 20 + bob, 8, 10, shirt); r(-3, y0 + 18 + bob, 6, 8, bib); r(-1, y0 + 25 + bob, 2, 2, '#f2d36b');
      const sw = work ? Math.round(sin(t * 9 + ph) * 4) : 0;
      if (wave) { r(4, y0 + 30 + bob + Math.round(sin(t * 8) * 2), 2, 9, L.skin); r(-6, y0 + 19 + bob, 2, 9, shirt); }
      else if (work) { r(4, y0 + 24 + bob, 2, 8, shirt); r(-6, y0 + 24 + bob, 2, 8, shirt); r(6 + sw, y0 + 22 + bob, 1, 15, '#7a5230'); r(5 + sw, y0 + 36 + bob, 5, 2, '#9aa3ad'); }      // hoe
      else { r(4, y0 + 19 + bob, 2, 9, shirt); r(-6, y0 + 19 + bob, 2, 9, shirt); }
      const hy = y0 + 31 + bob;
      r(-3, hy, 6, 7, L.skin); r(-4, hy + 6, 8, 1, hat); r(-6, hy + 6, 12, 1, hat); r(-3, hy + 7, 6, 3, hat); r(-3, hy + 9, 6, 1, shade(hat, -.25));
      if (lvl >= 4) r(-3, hy + 7, 6, 1, '#c8434a');
      if (!work) { if (sleep) { r(-2, hy + 3, 2, 1, '#2a1d12'); r(1, hy + 3, 2, 1, '#2a1d12'); } else { r(-2, hy + 3, 1, 2, '#2a1d12'); r(1, hy + 3, 1, 2, '#2a1d12'); r(-1, hy + 1, 2, 1, '#b5594a'); } }
    } else {
      const body = L.shirt, dark = shade(body, -.35), lite = shade(body, .3), eye = sleep ? '#3a4a6a' : wave ? (Math.floor(t * 4) % 2 ? '#ffc83d' : '#8a6a1a') : '#5ff0ff';
      r(-8, 5, 16, 5, '#2b2f45'); for (let i = 0; i < 4; i++) r(-7 + i * 4, 5, 2, 5, '#444a68');                     // treads
      r(-6, 10 + bob, 12, 14, body); r(-6, 10 + bob, 12, 2, dark); r(-6, 22 + bob, 12, 2, lite); r(-2, 15 + bob, 4, 4, dark); r(-1, 16 + bob, 2, 2, eye);
      const sw = work ? Math.round(sin(t * 10 + ph) * 3) : 0;
      if (wave) { r(6, 20 + bob + Math.round(sin(t * 8) * 2), 3, 10, body); r(-9, 12 + bob, 3, 8, body); }
      else if (work) { r(6, 14 + bob, 3, 8, body); r(-9, 14 + bob, 3, 8, body); r(8 + sw, 12 + bob, 2, 6, '#c9cfe0'); if (Math.floor(t * 12 + ph) % 3 === 0) r(9 + sw, 18 + bob, 2, 2, '#ffe066'); }
      else { r(6, 12 + bob, 3, 8, body); r(-9, 12 + bob, 3, 8, body); }
      const hy = 24 + bob; r(-7, hy, 14, 11, lite); r(-7, hy + 10, 14, 1, dark); r(-5, hy + 3, 10, 5, '#10162e'); r(-4, hy + 4, 3, 3, eye); r(1, hy + 4, 3, 3, eye);
      r(-1, hy + 11, 2, 4, '#9aa3b8'); r(-2, hy + 14, 4, 3, wave ? (Math.floor(t * 5) % 2 ? '#ff5d6c' : '#6a2a30') : sleep ? '#3a4a6a' : '#5be37d');
      if (lvl >= 4) r(-7, hy + 8, 14, 1, '#f5c542');
    }
    if (lvl >= 6 && work) { c.strokeStyle = `rgba(255,220,100,${.35 + .25 * sin(t * 4)})`; c.lineWidth = 2; c.beginPath(); c.ellipse(ax, ay + 1, 15, 6, 0, 0, PI2); c.stroke(); }
  }

  /* project banner on a pole at the back corner of every room (so you can tell the fields / sectors apart) */
  function banner(c, k, t, style, ox = .15, oy = .15) {
    const D = DIVS[k], [bx, by] = iso(D.ox + ox, D.oy + oy, 0), px = Math.round(bx), py = Math.round(by), s = textSprite(String(D.label), '#ffffff', shade(D.color, -.75)), w = s.w + 10, topY = py - 56, fl = Math.round(sin(t * 2 + D.ox) * 1);
    R(c, px - 1, topY - 2, 3, 58, style === 'space' ? '#b9c0dc' : '#7a5230'); R(c, px - 2, topY - 4, 5, 3, style === 'space' ? '#5ff0ff' : '#c99a62');
    if (style === 'space') { c.globalAlpha = .88; R(c, px + 3, topY, w, 15, shade(D.color, -.55)); c.globalAlpha = 1; c.strokeStyle = D.color; c.lineWidth = 1; c.strokeRect(px + 3.5, topY + .5, w - 1, 14); R(c, px + 3, topY + 14, w, 1, `rgba(95,240,255,${.5 + .3 * sin(t * 5)})`); }
    else { R(c, px + 3, topY, w, 15, D.color); R(c, px + 3, topY, w, 1, shade(D.color, .35)); R(c, px + 3, topY + 14 + fl, w, 1, shade(D.color, -.35)); poly(c, [[px + 3, topY + 15], [px + 3 + w, topY + 15], [px + 3 + w - 4, topY + 18 + fl], [px + 3 + w - 8, topY + 15]], shade(D.color, -.2)); }
    c.drawImage(s.cv, px + 8, topY + 4);
  }

  /* ======================================================================
     OFFICE: the default look + a few perks that unlock with the company level
     ====================================================================== */
  const catState = { x: 7.5, y: 4, tx: 7.5, ty: 12, flip: 1 };
  /* Furnishings: the office version of crops and modules. Work gets things delivered to the project's room; a delivery is
     unpacked, assembled and finally switched on. Free floor tiles, walls first (tiles used by the room's own decor are skipped). */
  const OFFICE_SPOTS = [[2, 0], [4, 0], [1, 6], [2, 6], [3, 6], [5, 6], [0, 1], [0, 4], [6, 3], [4, 2], [1, 3], [4, 5], [6, 1], [1, 5], [1, 2], [4, 3]];
  const spotCache = {};
  const officeSpots = k => spotCache[k] || (spotCache[k] = (() => { const D = DIVS[k], taken = new Set(DECOR.filter(o => o.room === k).map(o => (o.x - D.ox) + ',' + (o.y - D.oy))); return OFFICE_SPOTS.filter(([x, y]) => !taken.has(x + ',' + y)); })());
  RPGV.officeSpot = (key, land, cell) => { const i = land ? land.plots.findIndex(p => p.c === cell) : -1, s = i >= 0 && DIVS[key] ? officeSpots(key)[i] : null; return s ? iso(DIVS[key].ox + s[0] + .5, DIVS[key].oy + s[1] + .5, 0) : null; };
  function furnishing(c, x, y, k, stage, t, ph) {
    const [bx, by] = iso(x + .5, y + .5, 0), px = Math.round(bx), py = Math.round(by), on = stage >= 3, C = h => on ? h : shade(h, -.28), blink = n => Math.floor(t * n + ph) % 2 === 0;
    shadow(c, px, py + 2, 13, 6, .22);
    if (stage < 2) {                                                  // a delivery: small parcel, then a tall half-open box
      const h = stage ? 17 : 9, s = stage ? .58 : .44, o = (1 - s) / 2; box(c, x + o, y + o, s, s, 0, h, '#e0b070', '#c08a4c', '#a06f3a');
      R(c, px - 1, py - h - 5, 2, 10, '#f6e7c4'); R(c, px - 8, py - Math.round(h / 2) + 1, 5, 3, '#f6e7c4'); if (stage) { R(c, px - 6, py - h - 9, 5, 5, '#c08a4c'); R(c, px + 2, py - h - 8, 5, 4, '#a06f3a'); }
      return;
    }
    let top = 26;
    switch (k) {
      case 0: box(c, x + .2, y + .2, .6, .6, 0, 24, C('#c2c8dc'), C('#9298b2'), C('#7a809a')); for (let i = 0; i < 3; i++) { R(c, px - 13, py - 1 - i * 7, 6, 1, '#4a4f6a'); R(c, px - 11, py - 3 - i * 7, 3, 1, on ? '#ffffff' : '#b0b5c8'); } top = 24; break;
      case 1: ell(c, px, py, 6, 3, '#3a3f5a'); R(c, px - 1, py - 36, 2, 36, '#9aa0b8'); poly(c, [[px - 9, py - 34], [px + 9, py - 34], [px + 5, py - 46], [px - 5, py - 46]], on ? '#ffe9a8' : '#8f8870', '#5a5340');
        if (on) { c.globalAlpha = .16 + .04 * sin(t * 2 + ph); ell(c, px, py - 32, 24, 15, '#ffe9a8'); ell(c, px, py + 2, 20, 9, '#ffe9a8'); c.globalAlpha = 1; } top = 46; break;
      case 2: R(c, px - 14, py - 8, 2, 8, '#6a6f8a'); R(c, px + 9, py + 4, 2, 8, '#6a6f8a'); box(c, x + .1, y + .42, .8, .16, 8, 26, C('#dfe3ee'), C('#ffffff'), C('#c9cede'));
        line(c, [px - 12, py - 28], [px + 1, py - 21], '#e05a5a', 1.5); line(c, [px - 12, py - 22], [px + 6, py - 13], '#4aa3df', 1.5); if (on) { line(c, [px - 10, py - 15], [px + 4, py - 8], '#5bbf6a', 1.5); R(c, px + 4, py - 20 + (blink(2) ? 0 : 1), 3, 3, '#f2c14e'); } top = 34; break;
      case 3: box(c, x + .2, y + .2, .6, .6, 0, 34, C('#434968'), C('#2e3350'), C('#23273f')); for (let i = 0; i < 5; i++) { R(c, px - 15, py - 2 - i * 6, 11, 1, '#171a2c'); R(c, px - 14 + (i % 2) * 6, py - 5 - i * 6, 2, 2, on ? (Math.floor(t * (3 + i) + ph) % 3 ? '#5be37d' : '#1d5a36') : '#26304a'); R(c, px - 7, py - 2 - i * 6 - 1, 2, 1, on && i % 2 ? '#ffc83d' : '#26304a'); } top = 34; break;
      case 4: box(c, x + .2, y + .2, .6, .6, 0, 36, C('#e0555c'), C('#bf3b43'), C('#9c2d35')); poly(c, [[px - 16, py - 27], [px - 5, py - 21], [px - 5, py - 8], [px - 16, py - 14]], on ? '#c9f3ff' : '#55687a');
        if (on) { for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) R(c, px - 14 + j * 5, py - 23 + i * 5 + j * 2, 3, 3, ['#ffc83d', '#5be37d', '#5cc8ff', '#ff7ab8', '#b57bff', '#ff8a3d'][i * 2 + j]); R(c, px + 7, py - 14, 3, 2, blink(3) ? '#5be37d' : '#ffffff'); } top = 36; break;
      case 5: box(c, x + .2, y + .2, .6, .6, 0, 32, C('#7a4fd6'), C('#5d38ae'), C('#48298c')); poly(c, [[px - 16, py - 25], [px - 4, py - 19], [px - 4, py - 9], [px - 16, py - 15]], on ? ['#5ff0ff', '#ff7ab8', '#ffe066', '#5be37d'][Math.floor(t * 2 + ph) % 4] : '#1a1030', '#120a24');
        if (on) { R(c, px - 12 + Math.round(sin(t * 5 + ph) * 3), py - 18, 2, 2, '#120a24'); R(c, px - 8, py - 15 + Math.round(cos(t * 4 + ph) * 2), 2, 2, '#ffffff'); } R(c, px - 11, py - 4, 2, 4, '#ff5d6c'); R(c, px - 6, py - 2, 2, 2, '#ffc83d'); top = 32; break;
      case 6: box(c, x + .15, y + .15, .7, .7, 0, 10, C('#4a4f6e'), C('#353a56'), C('#292d46')); box(c, x + .17, y + .17, .66, .66, 10, 17, 'rgba(150,235,255,.5)', 'rgba(70,170,230,.62)', 'rgba(50,140,205,.62)');
        R(c, px - 15, py - 11, 4, 2, '#3fae6a'); R(c, px + 9, py - 12, 3, 3, '#3fae6a'); { const sw = on ? Math.round(sin(t * 1.4 + ph) * 5) : 0; R(c, px - 9 + sw, py - 13, 4, 2, '#ff8a3d'); R(c, px - 10 + sw + (sw > 0 ? -1 : 4), py - 14, 1, 4, '#ff8a3d'); R(c, px + 8 - sw, py - 16, 3, 2, '#ffe066'); }
        if (on) for (let i = 0; i < 3; i++) { const f = (t * .6 + i / 3 + ph) % 1; R(c, px - 3 + i * 3, py - 10 - Math.round(f * 12), 1, 1, `rgba(255,255,255,${1 - f})`); } top = 27; break;
      default: { box(c, x + .26, y + .26, .48, .48, 0, 13, C('#efecf8'), C('#c5bfdc'), C('#a39dc0')); const g = on ? '#ffd23f' : '#b8922e', g2 = on ? '#fff3a0' : '#d0aa48';
        R(c, px - 4, py - 19, 8, 2, g); R(c, px - 1, py - 23, 2, 4, g); R(c, px - 6, py - 34, 12, 11, g); R(c, px - 6, py - 34, 12, 2, g2); R(c, px - 4, py - 31, 2, 6, g2); R(c, px - 9, py - 33, 3, 2, g); R(c, px - 9, py - 33, 2, 6, g); R(c, px + 6, py - 33, 3, 2, g); R(c, px + 7, py - 33, 2, 6, g);
        if (on) { c.globalAlpha = .14 + .06 * sin(t * 3 + ph); ell(c, px, py - 28, 16, 14, '#ffd23f'); c.globalAlpha = 1; } top = 36; }
    }
    if (on && Math.floor(t * 2 + ph) % 4 === 0) { R(c, px + 8, py - top - 5, 1, 5, '#ffffff'); R(c, px + 6, py - top - 3, 5, 1, '#ffffff'); }            // "ready" twinkle
  }
  window.SKINS.office = {
    custom: false,
    items(c, t, items, solo) {
      const L = RPGV.level(), now = RPGV.now();
      for (const k of rooms()) {                                       // each project's furnishings, earned by its own work
        const land = landFor(k); if (!land) continue; const D = DIVS[k], spots = officeSpots(k);
        land.plots.slice(0, spots.length).forEach((p, i) => { const [rx, ry] = spots[i], x = D.ox + rx, y = D.oy + ry; items.push({ d: x + y + 1, f: () => furnishing(c, x, y, p.k, RC.stageOf(p, now), t, (p.c * 1.7) % 6) }); });
      }
      for (const a of AGENTS) {                                        // character levels show in the office too
        const rc = RPGV.char(a.sid), lvl = rc ? rc.level : 1, dd = a.desk[0] + a.desk[1]; if (lvl < 4 || a.sleeping) continue;
        items.push({ d: dd + 1.1, f: () => { const [fx, fy] = iso(a.desk[0] + .88, a.desk[1] + .12, 17), x = Math.round(fx), y = Math.round(fy); R(c, x, y - 11, 1, 11, '#c9cfe0'); R(c, x + 1, y - 11 + Math.round(sin(t * 3 + a.phase) * .6), 6, 4, lvl >= 8 ? '#ffd23f' : a.look.shirt); } });      // desk pennant
        if (lvl >= 6 && a.state === 'working') items.push({ d: dd + 2.9, f: () => { c.strokeStyle = `rgba(255,220,100,${.35 + .25 * sin(t * 4)})`; c.lineWidth = 2; c.beginPath(); c.ellipse(a.ax, a.ay + 1, 15, 6, 0, 0, PI2); c.stroke(); } });
        if (lvl >= 10) items.push({ d: dd + 3.1, f: () => { for (let i = 0; i < 5; i++) { const f = (t * .5 + i / 5 + a.phase) % 1; R(c, a.ax + Math.round(sin(i * 2.1 + a.phase) * 12), a.ay - 6 - Math.round(f * 44), 2, 2, `rgba(255,226,120,${.9 * (1 - f)})`); } } });
      }
      if (L >= 2) for (const k of rooms()) { const D = DIVS[k]; [[3, 0], [5, 0], [0, 5], [4, 6]].forEach(([rx, ry], i) => { const o = { x: D.ox + rx, y: D.oy + ry, room: k, ph: i }; items.push({ d: o.x + o.y + 1, f: () => DRAW_DECOR.plant(c, o, t) }); }); }
      if (L >= 8) for (const a of AGENTS) if (!a.head) items.push({ d: a.desk[0] + a.desk[1] + 1.05, f: () => { const [gx, gy] = a.desk; c.strokeStyle = '#f5c542'; c.lineWidth = 1.5; c.beginPath(); let p = iso(gx + .05, gy + .05, 16); c.moveTo(p[0], p[1]); p = iso(gx + .05, gy + .95, 16); c.lineTo(p[0], p[1]); p = iso(gx + .95, gy + .95, 16); c.lineTo(p[0], p[1]); p = iso(gx + .95, gy + .05, 16); c.lineTo(p[0], p[1]); c.stroke(); } });
      if (solo) return;
      if (L >= 3) for (const k of DKEYS) { const D = DIVS[k]; items.push({ d: D.ox + D.oy + 6.8, f: () => { const [x, y] = iso(D.ox + 6.4, D.oy + .4, 0); box(c, D.ox + 5.9, D.oy + .15, .7, .5, 0, 18, '#e9e6f5', '#bdb7d8', '#9a94bb'); R(c, Math.round(x) - 5, Math.round(y) - 18, 4, 3, '#2b2f55'); R(c, Math.round(x) + 1, Math.round(y) - 16, 2, 2, '#ff5d6c'); const s = Math.floor(t * 3) % 3; R(c, Math.round(x) - 1 + s, Math.round(y) - 24 - s * 2, 1, 2, 'rgba(255,255,255,.55)'); } }); }
      if (L >= 6) {
        const dx = catState.tx - catState.x, dy = catState.ty - catState.y, d = Math.hypot(dx, dy);
        if (d < .15) { const spots = [[7.5, 2], [7.5, 12], [2, 7.5], [13, 7.5], [8, 8]]; const p = spots[Math.floor(Math.random() * spots.length)]; catState.tx = p[0] + (Math.random() - .5); catState.ty = p[1] + (Math.random() - .5); }
        else { catState.x += dx / d * .012; catState.y += dy / d * .012; catState.flip = dx > dy ? 1 : -1; }
        items.push({ d: catState.x + catState.y + 1, f: () => { const [x, y] = iso(catState.x, catState.y, 0), px = Math.round(x), py = Math.round(y), s = Math.round(sin(t * 6) * 1);
          shadow(c, px, py + 1, 7, 3, .25); R(c, px - 5, py - 7 + s, 9, 5, '#e8913a'); R(c, px + 3 * catState.flip, py - 10 + s, 4, 4, '#e8913a'); R(c, px + (catState.flip > 0 ? 3 : 3 * catState.flip), py - 12 + s, 1, 2, '#c4702a'); R(c, px - 6 * catState.flip, py - 8 + s, 2, 1, '#c4702a'); R(c, px - 4, py - 2, 2, 2, '#c4702a'); R(c, px + 1, py - 2, 2, 2, '#c4702a'); } });
      }
    },
    post(c, t) {
      const L = RPGV.level();
      if (L >= 5) {                                                   // neon sign hanging over the north hallway
        const [bx, by] = iso(8, 3.2, 78), x = Math.round(bx), y = Math.round(by), on = .78 + .22 * sin(t * 3);
        line(c, [x - 36, y - 11], [x - 36, y - 30], '#3a2f5a', 1); line(c, [x + 36, y - 11], [x + 36, y - 30], '#3a2f5a', 1);
        R(c, x - 47, y - 12, 94, 24, '#1a0a1d'); c.strokeStyle = `rgba(255,120,190,${on})`; c.lineWidth = 2; c.strokeRect(x - 46, y - 11, 92, 22);
        c.save(); c.shadowColor = '#ff4fa3'; c.shadowBlur = 12; drawText(c, 'PIXEL OFFICE', x - 36, y - 4, `rgba(255,150,205,${on})`, 1, '#4a0f2e'); c.restore();
      }
      if (L >= 10) {                                                  // party lights strung over the hallways
        for (const [a, b] of [[[7.1, 0.4], [7.1, 7]], [[8.9, 0.4], [8.9, 7]], [[0.4, 7.1], [7, 7.1]], [[9, 7.1], [15.6, 7.1]], [[0.4, 8.9], [7, 8.9]], [[9, 8.9], [15.6, 8.9]]]) {
          const A = iso(a[0], a[1], 44), B = iso(b[0], b[1], 44); c.strokeStyle = 'rgba(30,24,50,.7)'; c.lineWidth = 1; c.beginPath();
          for (let i = 0; i <= 16; i++) { const f = i / 16, x = A[0] + (B[0] - A[0]) * f, y = A[1] + (B[1] - A[1]) * f + sin(f * Math.PI) * 10; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
          for (let i = 1; i < 16; i += 1) { const f = i / 16, x = A[0] + (B[0] - A[0]) * f, y = A[1] + (B[1] - A[1]) * f + sin(f * Math.PI) * 10, col = ['#ff5d6c', '#ffc83d', '#5be37d', '#5cc8ff', '#b57bff'][i % 5], on = Math.sin(t * 3 + i) > -.3;
            c.fillStyle = on ? col : '#3a3358'; c.fillRect(Math.round(x) - 2, Math.round(y), 4, 4); if (on) { c.globalAlpha = .25; c.fillRect(Math.round(x) - 4, Math.round(y) - 2, 8, 8); c.globalAlpha = 1; } }
        }
      }
    }
  };

  /* ======================================================================
     FARM
     ====================================================================== */
  const hayDark = '#b8963f';
  function cropSprite(c, x, y, k, stage, t, ph) {
    const [bx, by] = iso(x + .5, y + .5, 0), px = Math.round(bx), py = Math.round(by), sw = sin(t * 1.6 + ph) * (stage >= 2 ? 1.2 : .4);
    const hh = [3, 9, 16, 22][stage], G = ['#5fbf4a', '#4aa63c'];
    ell(c, px, py + 1, 11, 5, 'rgba(0,0,0,.18)');
    if (stage === 0) { ell(c, px, py - 1, 6, 3, '#5a3719'); R(c, px - 1, py - 4, 2, 3, '#7bd05a'); return; }
    const stalk = (ox, oy, h, col, w = 2) => { R(c, px + ox + Math.round(sw * (h / 20)), py + oy - h, w, h, col); };
    switch (k) {
      case 0: for (let i = -2; i <= 2; i++) { stalk(i * 4, (i & 1) * 2, hh * .85, stage === 3 ? '#e8c04a' : G[0], 1); if (stage >= 2) R(c, px + i * 4 + Math.round(sw * .8) - 1, py + (i & 1) * 2 - hh * .85 - 3, 3, 4, stage === 3 ? '#f4d878' : '#8bd05a'); } break;
      case 1: for (let i = -1; i <= 1; i++) { stalk(i * 5, 0, hh * .55, G[i & 1], 2); R(c, px + i * 5 - 2, py - hh * .55 - 2, 5, 3, G[(i + 1) & 1]); } if (stage === 3) for (let i = -1; i <= 1; i++) { R(c, px + i * 5 - 1, py - 3, 3, 3, '#ff8a2a'); R(c, px + i * 5, py - 1, 1, 2, '#e06a10'); } break;
      case 2: for (let i = -1; i <= 1; i++) { stalk(i * 6, (i & 1) * 2, hh, G[0], 2); R(c, px + i * 6 - 3 + Math.round(sw), py + (i & 1) * 2 - hh * .6, 3, 1, G[1]); R(c, px + i * 6 + 2 + Math.round(sw), py + (i & 1) * 2 - hh * .4, 3, 1, G[1]); if (stage === 3) R(c, px + i * 6 + 1, py + (i & 1) * 2 - hh * .55, 3, 6, '#f2d23a'); } break;
      case 3: ell(c, px, py - hh * .35, 10, hh * .4 + 2, G[1]); ell(c, px - 2, py - hh * .42, 7, hh * .3 + 1, G[0]); if (stage >= 2) for (const [dx, dy] of [[-5, 0], [4, -3], [0, 3], [6, 2], [-2, -5]]) R(c, px + dx, py - hh * .35 + dy, 3, 3, stage === 3 ? '#e8392f' : '#9ad05a'); break;
      case 4: R(c, px - 9, py - 2, 18, 1, G[1]); ell(c, px - 6, py - 4, 4, 2, G[0]); { const r = stage === 3 ? 8 : stage === 2 ? 5 : 3; ell(c, px + 2, py - r * .55, r, r * .72, stage >= 3 ? '#f28a1d' : '#7bbf4a'); if (stage === 3) { line(c, [px + 2, py - r * 1.2], [px + 2, py - 1], '#c86a10', 1); line(c, [px - 2, py - r * 1.1], [px - 2, py - 1], '#c86a10', 1); line(c, [px + 6, py - r * 1.1], [px + 6, py - 1], '#c86a10', 1); R(c, px + 1, py - r * 1.35, 2, 3, '#4a7a2a'); } } break;
      case 5: stalk(0, 0, hh * 1.15, G[1], 2); R(c, px - 5, py - hh * .5, 4, 2, G[0]); R(c, px + 2, py - hh * .7, 4, 2, G[0]); { const hx = px + Math.round(sw * 1.1), hy = py - hh * 1.15 - 2; if (stage === 3) { for (let i = 0; i < 10; i++) { const a = i / 10 * PI2; R(c, Math.round(hx + cos(a) * 6) - 1, Math.round(hy + sin(a) * 6) - 1, 3, 3, '#ffd23f'); } ell(c, hx, hy, 3.5, 3.5, '#6b3f1d'); } else ell(c, hx, hy, 3, 3, '#a9d65a'); } break;
      case 6: ell(c, px, py - 4, 9, 4, G[1]); ell(c, px - 2, py - 5, 6, 3, G[0]); if (stage >= 2) for (const [dx, dy] of [[-5, 0], [4, 1], [0, 2], [6, -1]]) R(c, px + dx, py - 4 + dy, 2, 3, stage === 3 ? '#ff3b5c' : '#e8e08a'); break;
      default: R(c, px - 1, py - hh * .6, 3, hh * .6, '#7a5230'); ell(c, px, py - hh * .75, 9 + stage, 6 + stage * .6, G[1]); ell(c, px - 2, py - hh * .8, 6, 4, G[0]); if (stage >= 2) for (const [dx, dy] of [[-4, 0], [4, -2], [0, 3], [6, 2]]) { R(c, px + dx, py - hh * .75 + dy, 3, 3, '#ffd23f'); if (stage === 3 && Math.floor(t * 3 + dx) % 4 === 0) R(c, px + dx + 1, py - hh * .75 + dy - 3, 1, 2, '#fff7b0'); }
    }
  }

  function fence(c, a, b, gaps) {                        // posts + two rails between tile-corner points a→b
    const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])), dx = (b[0] - a[0]) / n, dy = (b[1] - a[1]) / n;
    for (let i = 0; i <= n; i++) { const x = a[0] + dx * i, y = a[1] + dy * i; if (gaps && gaps.includes(i)) continue; const p0 = iso(x, y, 0), p1 = iso(x, y, 11); line(c, p0, p1, '#8d6139', 2); R(c, Math.round(p1[0]) - 1, Math.round(p1[1]) - 1, 3, 2, '#c99a62');
      if (i < n && !(gaps && (gaps.includes(i) || gaps.includes(i + 1)))) for (const z of [4, 8]) line(c, iso(x, y, z), iso(x + dx, y + dy, z), '#b98650', 1.5); }
  }

  function farmStatic(c, solo) {
    const N = solo ? RW : NT;
    poly(c, [iso(0, N, 0), iso(N, N, 0), iso(N, N, -SLAB), iso(0, N, -SLAB)], '#82552d', '#3f2814'); poly(c, [iso(N, 0, 0), iso(N, N, 0), iso(N, N, -SLAB), iso(N, 0, -SLAB)], '#5d3a1d', '#3f2814');
    poly(c, [iso(0, N, 0), iso(N, N, 0), iso(N, N, -3), iso(0, N, -3)], '#4f9a3d'); poly(c, [iso(N, 0, 0), iso(N, N, 0), iso(N, N, -3), iso(N, 0, -3)], '#3f7f31');
    for (let i = 0; i < N * 2; i++) { const x = rnd(i, 21) * N, z = -5 - rnd(i, 22) * (SLAB - 6); const p = iso(x, N, z); R(c, Math.round(p[0]), Math.round(p[1]), 3 + (i % 3), 2, '#5d3a1d'); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const rk = roomAt(x, y), chk = (x + y) & 1;
      if (rk) { const g = chk ? '#62b04c' : '#5aa745'; tile(c, x, y, 0, g, shade(g, -.1)); if (rnd(x * 16 + y, 4) > .72) { const p = iso(x + rnd(x, y) * .8 + .1, y + rnd(y, x) * .8 + .1, 0); R(c, Math.round(p[0]), Math.round(p[1]), 1, 2, '#3f8a31'); } }
      else { const g = chk ? '#cdaa6e' : '#c3a064'; tile(c, x, y, 0, g, shade(g, -.08)); if (rnd(x * 16 + y, 5) > .6) { const p = iso(x + .5, y + .5, 0); R(c, Math.round(p[0]) + (x % 3), Math.round(p[1]), 2, 1, '#9a7d4a'); } }
    }
    for (const k of rooms()) {
      const D = DIVS[k];
      RC.CELLS.forEach(([rx, ry]) => { const x = D.ox + rx, y = D.oy + ry; tile(c, x, y, 0, '#7a4f2b', '#5a3719'); for (let i = 1; i <= 3; i++) line(c, iso(x + i * .25, y + .1, 0), iso(x + i * .25, y + .9, 0), '#5f3b1b', 1); });
      fence(c, [D.ox, D.oy], [D.ox + 7, D.oy]); fence(c, [D.ox, D.oy], [D.ox, D.oy + 7]);
    }
    if (!solo) {
      for (let y = 7; y <= 8; y++) for (let x = 7; x <= 8; x++) tile(c, x, y, 0, ((x + y) & 1) ? '#b9b1a8' : '#aaa299', '#8c857c');
      tile(c, 2, 7, 0, '#4f9ad8', '#2f6aa0'); tile(c, 3, 7, 0, '#5aa6e2', '#2f6aa0'); tile(c, 2, 8, 0, '#4f9ad8', '#2f6aa0'); tile(c, 3, 8, 0, '#5aa6e2', '#2f6aa0');
    }
  }

  const chickens = Array.from({ length: 5 }, (_, i) => ({ x: 7 + rnd(i, 31) * 2, y: 7 + rnd(i, 32) * 2, tx: 8, ty: 8, ph: i }));
  function farmBack(c, t) { paintSky(t, 'farm'); sky(c, t, 'farm'); }
  function farmWorld(c, t) { if (!soloKey()) { for (let i = 0; i < 4; i++) { const [x, y] = iso(2.5 + (i % 2) * .9, 7.5 + (i >> 1) * .9, 0); c.strokeStyle = `rgba(255,255,255,${.25 + .15 * sin(t * 2 + i)})`; c.lineWidth = 1; c.beginPath(); c.ellipse(x + sin(t + i) * 3, y, 5 + (t * 3 + i * 2) % 4, 2, 0, 0, PI2); c.stroke(); } } }

  function tree(c, x, y, t, s = 1) { const [bx, by] = iso(x, y, 0), px = Math.round(bx), py = Math.round(by), sw = Math.round(sin(t * 1.2 + x) * 1); shadow(c, px, py + 1, 14 * s, 6 * s, .22); R(c, px - 2, py - 14 * s, 4, 14 * s, '#6f4a2a'); ell(c, px + sw, py - 24 * s, 15 * s, 11 * s, '#3f8f3a'); ell(c, px - 4 + sw, py - 27 * s, 10 * s, 7 * s, '#58b04a'); ell(c, px + 6 + sw, py - 22 * s, 8 * s, 6 * s, '#3a8234'); }
  function windmill(c, x, y, t) { const [bx, by] = iso(x, y, 0), px = Math.round(bx), py = Math.round(by); shadow(c, px, py + 1, 22, 9, .25); box(c, x - .5, y - .5, 1, 1, 0, 40, '#efe4cf', '#d4c7ad', '#b9ab90'); poly(c, [iso(x - .6, y - .6, 40), iso(x + .6, y - .6, 40), iso(x + .6, y + .6, 40), iso(x - .6, y + .6, 40)], '#b5524a', '#7a2e2a'); const hx = px, hy = py - 50; for (let i = 0; i < 4; i++) { const a = t * 1.2 + i * PI2 / 4; line(c, [hx, hy], [hx + cos(a) * 28, hy + sin(a) * 28], '#7a5230', 3); line(c, [hx + cos(a) * 8, hy + sin(a) * 8], [hx + cos(a) * 28 + cos(a + 1.5) * 6, hy + sin(a) * 28 + sin(a + 1.5) * 6], '#f3ead2', 6); } R(c, hx - 2, hy - 2, 5, 5, '#5a3a22'); }
  function barn(c, x, y) { const [bx, by] = iso(x + 1, y + .8, 0); shadow(c, Math.round(bx), Math.round(by) + 2, 30, 11, .25); box(c, x, y, 2, 1.6, 0, 26, '#b5372f', '#c9463c', '#8f2b25'); poly(c, [iso(x - .1, y - .1, 26), iso(x + 2.1, y - .1, 26), iso(x + 1.95, y + 1.8, 34), iso(x + .05, y + 1.8, 34)], '#7a4a2a', '#4a2c18'); const d = iso(x + 1, y + 1.6, 0); R(c, Math.round(d[0]) - 6, Math.round(d[1]) - 16, 12, 16, '#f3e6d0'); line(c, [d[0] - 6, d[1] - 16], [d[0] + 6, d[1]], '#b5372f', 1.5); line(c, [d[0] + 6, d[1] - 16], [d[0] - 6, d[1]], '#b5372f', 1.5); }
  function greenhouse(c, x, y, t, night) { const [bx, by] = iso(x + 1, y + .8, 0); shadow(c, Math.round(bx), Math.round(by) + 2, 28, 10, .22); box(c, x, y, 2, 1.5, 0, 14, `rgba(190,235,230,${.55 + night * .3})`, `rgba(170,225,220,.55)`, `rgba(140,205,200,.55)`); poly(c, [iso(x, y, 14), iso(x + 2, y, 14), iso(x + 2, y + 1.5, 14), iso(x, y + 1.5, 14)], `rgba(210,245,240,${.6 + night * .25})`, '#7fb5ae'); for (let i = 0; i < 4; i++) { const p = iso(x + .3 + i * .45, y + .8, 0); R(c, Math.round(p[0]) - 1, Math.round(p[1]) - 8, 3, 8, '#4fbf5a'); R(c, Math.round(p[0]) - 2, Math.round(p[1]) - 10, 5, 3, night > .5 && i % 2 ? '#ffb84a' : '#e8392f'); } }
  function well(c, x, y) { const [bx, by] = iso(x, y, 0); shadow(c, Math.round(bx), Math.round(by) + 1, 12, 5, .25); box(c, x - .45, y - .45, .9, .9, 0, 9, '#9c9a96', '#7c7a77', '#6a6866'); poly(c, [iso(x - .3, y - .3, 9), iso(x + .3, y - .3, 9), iso(x + .3, y + .3, 9), iso(x - .3, y + .3, 9)], '#2f6aa0'); line(c, iso(x - .4, y - .4, 9), iso(x - .4, y - .4, 24), '#7a5230', 2); line(c, iso(x + .4, y + .4, 9), iso(x + .4, y + .4, 24), '#7a5230', 2); poly(c, [iso(x - .55, y - .55, 24), iso(x + .55, y - .55, 24), iso(x + .55, y + .55, 24), iso(x - .55, y + .55, 24)], '#b5524a', '#7a2e2a'); }
  function scarecrow(c, x, y, t) { const [bx, by] = iso(x, y, 0), px = Math.round(bx), py = Math.round(by), sw = Math.round(sin(t * 1.5) * 1); R(c, px - 1, py - 26, 2, 26, '#7a5230'); R(c, px - 9 + sw, py - 20, 18, 2, '#7a5230'); R(c, px - 4, py - 22, 8, 8, '#d9a441'); R(c, px - 3, py - 32, 6, 6, '#f0d49a'); R(c, px - 6, py - 29, 12, 2, '#6b4423'); R(c, px - 3, py - 35, 6, 4, '#6b4423'); R(c, px - 2, py - 30, 1, 1, '#222'); R(c, px + 1, py - 30, 1, 1, '#222'); }
  function hive(c, x, y, t) { const [bx, by] = iso(x, y, 0), px = Math.round(bx), py = Math.round(by); shadow(c, px, py + 1, 8, 3, .22); R(c, px - 6, py - 4, 12, 4, '#8a5a2e'); R(c, px - 5, py - 9, 10, 5, '#f2c84a'); R(c, px - 5, py - 12, 10, 3, '#8a5a2e'); R(c, px - 1, py - 7, 2, 2, '#3a2410'); for (let i = 0; i < 3; i++) { const a = t * 3 + i * 2.1; R(c, Math.round(px + cos(a) * 14), Math.round(py - 12 + sin(a * 1.3) * 7), 2, 2, i & 1 ? '#ffd23f' : '#3a2410'); } }
  function chicken(c, ch, t) { const dx = ch.tx - ch.x, dy = ch.ty - ch.y, d = Math.hypot(dx, dy); if (d < .1) { ch.tx = 6.5 + Math.random() * 3; ch.ty = 6.5 + Math.random() * 3; } else { ch.x += dx / d * .008; ch.y += dy / d * .008; } const [bx, by] = iso(ch.x, ch.y, 0), px = Math.round(bx), py = Math.round(by), hop = Math.abs(sin(t * 5 + ch.ph)) > .9 ? 1 : 0; shadow(c, px, py + 1, 5, 2, .2); R(c, px - 3, py - 6 - hop, 6, 5, '#f4f1ea'); R(c, px + (dx > 0 ? 3 : -5), py - 9 - hop, 3, 4, '#f4f1ea'); R(c, px + (dx > 0 ? 6 : -7), py - 8 - hop, 2, 1, '#f2a33a'); R(c, px + (dx > 0 ? 4 : -4), py - 11 - hop, 1, 2, '#e8392f'); R(c, px - 1, py - 1, 1, 2, '#f2a33a'); R(c, px + 1, py - 1, 1, 2, '#f2a33a'); }

  function farmDesk(c, a, t) {
    const [gx, gy] = a.desk, D = DIVS[a.div], head = a.head, rc = RPGV.char(a.sid), lvl = rc ? rc.level : 1;
    box(c, gx + .06, gy + .06, .88, .88, 0, 6, '#6b4423', '#8d5f33', '#6f4a28'); poly(c, [iso(gx + .14, gy + .14, 6), iso(gx + .86, gy + .14, 6), iso(gx + .86, gy + .86, 6), iso(gx + .14, gy + .86, 6)], '#5a3719');
    const stage = a.state === 'working' ? Math.min(3, 1 + (Math.floor(t * 1.5 + a.phase) % 3)) : Math.min(3, Math.floor((lvl - 1) / 2) + (a.state === 'waiting' ? 1 : 0));
    for (let i = 0; i < 4; i++) { const [px, py] = iso(gx + .3 + (i & 1) * .4, gy + .3 + (i >> 1) * .4, 6), h = 2 + stage * 3 + (i === 3 ? 2 : 0), sw = Math.round(sin(t * 2 + i + a.phase) * (stage > 1 ? 1 : 0)); R(c, Math.round(px) + sw, Math.round(py) - h, 2, h, '#4fbf5a'); if (stage >= 3) R(c, Math.round(px) + sw - 1, Math.round(py) - h - 2, 4, 3, ['#e8392f', '#ffd23f', '#ff8a2a', '#c86ae0'][i]); }
    const s = iso(gx + .9, gy + .1, 0), sx = Math.round(s[0]), sy = Math.round(s[1]); R(c, sx - 1, sy - 22, 2, 22, '#7a5230'); R(c, sx - 9, sy - 30, 18, 8, head ? '#f5c542' : '#e8d3a3'); R(c, sx - 9, sy - 30, 18, 1, '#fff2c0'); R(c, sx - 7, sy - 27, 14, 1, '#8d6139'); R(c, sx - 5, sy - 25, 10, 1, '#8d6139');
    const wc = iso(gx + .08, gy + .9, 0); R(c, Math.round(wc[0]) - 4, Math.round(wc[1]) - 6, 7, 6, '#7fa3c4'); R(c, Math.round(wc[0]) + 3, Math.round(wc[1]) - 7, 4, 1, '#7fa3c4'); R(c, Math.round(wc[0]) - 4, Math.round(wc[1]) - 7, 7, 1, '#5d83a6');
    if (a.state === 'working' && Math.floor(t * 6 + a.phase) % 3 === 0) { const w = iso(gx + .5, gy + .5, 6); R(c, Math.round(w[0]) + 4, Math.round(w[1]) - 10, 1, 3, '#8fd0ff'); }
    if (isNight(t)) { ell(c, sx, sy - 24, 3, 3, '#ffd77a'); }
  }

  function flowers(c, k, t) {                      // a few wildflowers on the grass so a brand-new farm is not bare
    const D = DIVS[k], cells = new Set(RC.CELLS.map(([a, b]) => a + ',' + b));
    for (let i = 0; i < 9; i++) { const rx = 2 + Math.floor(rnd(i, 90 + D.ox) * 5), ry = 1 + Math.floor(rnd(i, 91 + D.oy) * 5); if (cells.has(rx + ',' + ry) || (rx === 2 || rx === 5) && (ry === 1 || ry === 4)) continue;
      const [bx, by] = iso(D.ox + rx + .2 + rnd(i, 92) * .6, D.oy + ry + .2 + rnd(i, 93) * .6, 0), px = Math.round(bx), py = Math.round(by), col = ['#ff6fa5', '#ffd23f', '#ffffff', '#b57bff'][i % 4], sw = Math.round(sin(t * 2 + i));
      R(c, px, py - 5, 1, 5, '#3f8a31'); R(c, px - 1 + sw, py - 7, 3, 3, col); R(c, px + sw, py - 6, 1, 1, '#ffd23f'); }
  }
  function farmItems(c, t, items, solo) {
    const L = RPGV.level(), n = nightFactor(t);
    for (const k of rooms()) items.push({ d: DIVS[k].ox + DIVS[k].oy + 3, f: () => flowers(c, k, t) });
    for (const k of rooms()) { const land = landFor(k); if (!land) continue; const now = RPGV.now();
      land.plots.forEach(p => { const [x, y] = cellXY(k, p.c); items.push({ d: x + y + .6, f: () => cropSprite(c, x, y, p.k, RC.stageOf(p, now), t, p.c) }); }); }
    const addAt = (d, f) => items.push({ d, f });
    for (const k of rooms()) addAt(DIVS[k].ox + DIVS[k].oy - .5, () => banner(c, k, t, 'farm'));
    if (!solo) {
      [[7.3, .3], [8.7, .3], [.4, 7.3], [.4, 8.8], [15.4, 7.3], [15.4, 8.8], [7.3, 15.4], [8.7, 15.4], [6.6, 6.7], [9.4, 9.3]].forEach(([x, y], i) => addAt(x + y + .5, () => tree(c, x, y, t, .9 + rnd(i, 2) * .3)));
      if (L >= 3) { addAt(8 + 8 + .5, () => well(c, 8, 8)); addAt(11, () => scarecrow(c, 5.4, 7.6, t)); }
      if (L >= 4) chickens.forEach(ch => addAt(ch.x + ch.y + .5, () => chicken(c, ch, t)));
      if (L >= 5) addAt(7.6 + 1.6, () => windmill(c, 7.6, 1.6, t));
      if (L >= 6) addAt(7 + 12, () => barn(c, 7, 11.6));
      if (L >= 7) addAt(12.5 + 7.2, () => greenhouse(c, 12.6, 7.1, t, n));
      if (L >= 8) [[1.2, 7.2], [1.8, 8.6], [14.2, 8.3]].forEach(([x, y]) => addAt(x + y + .4, () => hive(c, x, y, t)));
    } else { addAt(6.4 + 6.4, () => tree(c, 6.4, 6.4, t, 1)); if (L >= 3) addAt(5.5 + 3.5, () => scarecrow(c, 5.5, 3.5, t)); if (L >= 4) chickens.slice(0, 3).forEach(ch => addAt(6 + 4, () => { const k = { ...ch, x: 4 + rnd(ch.ph, 40) * 3, y: 3 + rnd(ch.ph, 41) * 3 }; chicken(c, k, t); })); }
  }
  function farmPost(c, t) {
    const n = nightFactor(t); atmosphere(c, t, 'farm');
    if (n > .4) { c.globalCompositeOperation = 'lighter'; for (const a of AGENTS) { const p = iso(a.desk[0] + .9, a.desk[1] + .1, 24), g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], 46); g.addColorStop(0, `rgba(255,200,110,${.5 * n})`); g.addColorStop(1, 'rgba(255,200,110,0)'); c.fillStyle = g; c.fillRect(p[0] - 46, p[1] - 46, 92, 92); }
      if (RPGV.level() >= 10) for (let i = 0; i < 26; i++) { const x = (rnd(i, 50) * W0 + sin(t * .5 + i) * 30 + W0) % W0, y = H0 * .3 + rnd(i, 51) * H0 * .55 + cos(t * .7 + i) * 14, a = (.5 + .5 * sin(t * 2 + i * 1.7)) * n; c.fillStyle = `rgba(220,255,120,${a})`; c.fillRect(Math.round(x), Math.round(y), 2, 2); }
      c.globalCompositeOperation = 'source-over'; }
  }

  window.SKINS.farm = { custom: true, label: 'Farm', static: farmStatic, back: farmBack, world: farmWorld, desk: farmDesk, avatar: (c, ax, ay, a, t, pose) => person(c, ax, ay, a, t, pose, 'farmer'), items: farmItems, post: farmPost, plate: 'FARM' };

  /* ======================================================================
     SPACE STATION  (hex sectors, domes, robots; inspired by the colony look of bot-crossing, drawn from scratch)
     ====================================================================== */
  const HEXR = 4.9, HEXA = Math.PI / 6;
  const hexTiles = (cx, cy, R, z = 0) => Array.from({ length: 6 }, (_, i) => iso(cx + R * cos(HEXA + i * PI2 / 6), cy + R * sin(HEXA + i * PI2 / 6), z));
  const roomCenter = k => [DIVS[k].ox + 3.5, DIVS[k].oy + 3.5];
  const rocks = Array.from({ length: 11 }, (_, i) => ({ y: 30 + rnd(i, 60) * (H0 - 60), s: 10 + rnd(i, 61) * 30, sp: 2 + rnd(i, 62) * 6, r: .1 + rnd(i, 63) * .4, x0: rnd(i, 64) * (W0 + 300), v: Array.from({ length: 8 }, (_, j) => .7 + rnd(i * 9 + j, 65) * .5) }));
  function rock(c, x, y, s, rot, v) {
    const pts = v.map((r, j) => [x + cos(rot + j * PI2 / v.length) * s * r, y + sin(rot + j * PI2 / v.length) * s * r * .8]);
    poly(c, pts, '#6e5445', '#3a2a22'); poly(c, pts.slice(0, 4).concat([[x, y]]), '#8a6c58'); poly(c, pts.slice(4).concat([[x, y]]), '#4f3a2f');
    ell(c, x - s * .2, y - s * .1, s * .18, s * .12, '#3a2a22');
  }
  function spaceBack(c, t) {
    paintSky(t, 'space'); const n = nightFactor(t);
    for (let i = 0; i < 90; i++) { const x = rnd(i, 70) * W0, y = rnd(i, 71) * H0, tw = .4 + .6 * sin(t * 1.5 + i); c.fillStyle = `rgba(255,255,255,${(.25 + .5 * tw) * (.35 + n * .65)})`; c.fillRect(Math.round(x), Math.round(y), i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1); }
    for (const r of rocks) rock(c, (r.x0 + t * r.sp) % (W0 + 300) - 150, r.y + sin(t * .3 + r.x0) * 6, r.s, t * r.r, r.v);
    if (RPGV.level() >= 10) { c.globalCompositeOperation = 'lighter'; for (let b = 0; b < 3; b++) { c.beginPath(); for (let x = 0; x <= W0; x += 24) { const y = 40 + b * 22 + sin(x * .01 + t * .5 + b) * 18; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.strokeStyle = ['rgba(90,255,170,.16)', 'rgba(120,160,255,.14)', 'rgba(200,120,255,.12)'][b]; c.lineWidth = 14; c.stroke(); } c.globalCompositeOperation = 'source-over'; }
  }
  function spaceStatic(c, solo) {
    const list = rooms();
    for (const k of list) {
      const D = DIVS[k], [cx, cy] = roomCenter(k), top = hexTiles(cx, cy, HEXR, 0), bot = hexTiles(cx, cy, HEXR, -11), inner = hexTiles(cx, cy, HEXR - .45, 0);
      const sides = []; for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; sides.push({ q: [top[i], top[j], bot[j], bot[i]], d: top[i][1] + top[j][1] }); }
      sides.sort((a, b) => a.d - b.d).forEach((s, idx) => poly(c, s.q, idx > 3 ? '#4a4f70' : '#3b3f5c', '#252842'));
      poly(c, top, '#5b6186', shade(D.color, -.1));
      c.save(); c.beginPath(); c.moveTo(inner[0][0], inner[0][1]); inner.slice(1).forEach(p => c.lineTo(p[0], p[1])); c.closePath(); c.clip(); c.fillStyle = '#6a7198'; c.fillRect(0, 0, W0, H0);
      c.strokeStyle = 'rgba(255,255,255,.1)'; c.lineWidth = 1; const r = .8, dx = r * 1.5, dy = r * Math.sqrt(3);
      for (let gx = cx - 6, col = 0; gx < cx + 6; gx += dx, col++) for (let gy = cy - 6 + (col & 1) * dy / 2; gy < cy + 6; gy += dy) { const hp = hexTiles(gx, gy, r * .92, 0); c.beginPath(); hp.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.stroke(); }
      c.restore();
      c.strokeStyle = D.color; c.lineWidth = 3; c.beginPath(); top.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.stroke();
      c.strokeStyle = shade(D.color, -.5); c.lineWidth = 1; c.beginPath(); inner.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.stroke();
      RC.CELLS.forEach(([rx, ry]) => { const x = D.ox + rx, y = D.oy + ry; poly(c, [iso(x + .08, y + .08, 0), iso(x + .92, y + .08, 0), iso(x + .92, y + .92, 0), iso(x + .08, y + .92, 0)], '#505678', '#98a0c8'); for (const [ux, uy] of [[.14, .14], [.86, .14], [.86, .86], [.14, .86]]) { const p = iso(x + ux, y + uy, 0); R(c, Math.round(p[0]), Math.round(p[1]), 1, 1, '#ffd77a'); } });
    }
    if (!solo) {                                             // corridors along the old hallways + the hub pad
      const tube = (x0, y0, x1, y1) => { const w = .34; const A = [x0 - (y1 === y0 ? 0 : w), y0 - (x1 === x0 ? 0 : w)], z = 5; box(c, Math.min(x0, x1) - (x1 === x0 ? w : 0), Math.min(y0, y1) - (y1 === y0 ? w : 0), Math.abs(x1 - x0) + (x1 === x0 ? 2 * w : 0), Math.abs(y1 - y0) + (y1 === y0 ? 2 * w : 0), 0, z, '#d6dbef', '#aab1d1', '#8f97bb'); };
      tube(8, 3.5, 8, 7.1); tube(8, 8.9, 8, 12.5); tube(3.5, 8, 7.1, 8); tube(8.9, 8, 12.5, 8);
      const hp = hexTiles(8, 8, 1.45, 0); poly(c, hp, '#4a4f70', '#98a0c8'); const hp2 = hexTiles(8, 8, 1.05, 0); poly(c, hp2, '#2b2f4c', '#ffd77a');
    }
  }
  function dome(c, cx, cy, rx, h, body, glow, t) {
    const ry = rx * .5; ell(c, cx, cy + 2, rx + 2, ry + 1, 'rgba(0,0,0,.25)'); ell(c, cx, cy, rx + 1, ry, '#3a3f5e');
    c.beginPath(); c.moveTo(cx - rx, cy); c.bezierCurveTo(cx - rx, cy - h * 1.33, cx + rx, cy - h * 1.33, cx + rx, cy); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI); c.closePath();
    const g = c.createLinearGradient(cx - rx, cy - h, cx + rx, cy); g.addColorStop(0, shade(body, .45)); g.addColorStop(.55, body); g.addColorStop(1, shade(body, -.4)); c.fillStyle = g; c.fill(); c.strokeStyle = shade(body, -.5); c.lineWidth = 1; c.stroke();
    if (glow) { c.fillStyle = glow; c.beginPath(); c.ellipse(cx, cy - h * .45, rx * .5, h * .3, 0, 0, PI2); c.fill(); }
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2; c.beginPath(); c.ellipse(cx, cy - h * .5, rx * .78, h * .72, 0, Math.PI * 1.1, Math.PI * 1.45); c.stroke();
  }
  function spaceDesk(c, a, t) {
    const [gx, gy] = a.desk, D = DIVS[a.div], [bx, by] = iso(gx + .5, gy + .5, 0), cx = Math.round(bx), cy = Math.round(by) - 2, head = a.head, rc = RPGV.char(a.sid), lvl = rc ? rc.level : 1;
    const glow = a.state === 'working' ? `rgba(95,240,255,${.55 + .25 * sin(t * 6 + a.phase)})` : a.state === 'waiting' ? `rgba(255,200,61,${.4 + .4 * sin(t * 6)})` : 'rgba(90,100,150,.5)';
    dome(c, cx, cy, head ? 24 : 20, head ? 30 : 24, '#dfe8ff', glow, t);
    if (head) { c.strokeStyle = '#f5c542'; c.lineWidth = 2; c.beginPath(); c.ellipse(cx, cy, 25, 12.5, 0, 0, Math.PI); c.stroke(); }
    R(c, cx - 3, cy - 2, 6, 6, '#23273f'); R(c, cx - 2, cy - 5, 4, 3, '#23273f');
    if (lvl >= 3) { line(c, [cx + 14, cy - 18], [cx + 14, cy - 38], '#b9c0dc', 2); R(c, cx + 12, cy - 41, 5, 4, a.state === 'waiting' ? '#ff5d6c' : (Math.floor(t * 2 + a.phase) % 2 ? '#5ff0ff' : '#1d5a66')); }
    if (lvl >= 5) { poly(c, [[cx - 32, cy - 6], [cx - 22, cy - 10], [cx - 22, cy - 2], [cx - 32, cy + 2]], '#2f5fd0', '#9fc0ff'); }
    if (a.state === 'working' && Math.floor(t * 5 + a.phase) % 4 === 0) R(c, cx + 18, cy - 10 - Math.floor(t * 8) % 6, 2, 2, '#ffe066');
  }
  function module(c, x, y, k, stage, t, ph) {
    const [bx, by] = iso(x + .5, y + .5, 0), px = Math.round(bx), py = Math.round(by), f = [.22, .5, .8, 1][stage], sw = sin(t * 3 + ph);
    ell(c, px, py + 1, 14, 6, 'rgba(0,0,0,.22)');
    switch (k) {
      case 0: line(c, [px, py], [px, py - 16 * f - 4], '#b9c0dc', 2); { const w = 15 * f + 4; poly(c, [[px - w, py - 12 * f - 2], [px, py - 22 * f - 3], [px + w, py - 12 * f - 2], [px, py - 2 * f - 1]], `rgb(${46 + 20 * sw},${96 + 20 * sw},208)`, '#9fc0ff'); line(c, [px - w / 2, py - 17 * f - 2], [px + w / 2, py - 7 * f - 1], 'rgba(255,255,255,.4)', 1); } break;
      case 1: dome(c, px, py, 12 * f + 4, 16 * f + 3, '#dfe8ff', stage === 3 ? 'rgba(255,225,140,.8)' : null, t); break;
      case 2: line(c, [px, py], [px, py - 34 * f], '#c9cfe6', 2); for (let i = 1; i < 4 * f + 1; i++) line(c, [px - 5, py - i * 8], [px + 5, py - i * 8 + 4], '#98a0c8', 1); if (stage >= 2) { c.strokeStyle = '#e9edfb'; c.lineWidth = 2; c.beginPath(); c.ellipse(px + 5, py - 34 * f, 8, 4, t * .8, 0, Math.PI); c.stroke(); } R(c, px - 1, py - 36 * f - 3, 3, 3, Math.floor(t * 2 + ph) % 2 ? '#ff5d6c' : '#6a2a30'); break;
      case 3: box(c, x + .15, y + .15, .7, .7, 0, 16 * f + 2, '#e9edf8', '#c3c9df', '#a2a9c6'); if (stage >= 2) { poly(c, [iso(x + .1, y + .1, 16 * f + 2), iso(x + .9, y + .1, 16 * f + 2), iso(x + .9, y + .9, 16 * f + 2), iso(x + .1, y + .9, 16 * f + 2)], '#f28a1d', '#a45a10'); R(c, px - 5, py - 8 * f - 2, 10, 3, '#5ff0ff'); line(c, [px + 4, py - 16 * f - 4], [px + 4 + cos(t * 2) * 5, py - 16 * f - 8], '#d8def2', 1); } break;
      case 4: c.fillStyle = 'rgba(170,235,220,.55)'; c.fillRect(px - 11, py - 18 * f - 2, 22, 18 * f + 2); c.strokeStyle = '#7fb5ae'; c.strokeRect(px - 11, py - 18 * f - 2, 22, 18 * f + 2); if (stage >= 1) for (let i = 0; i < 4; i++) R(c, px - 8 + i * 5, py - 9 * f - 2, 3, 9 * f, '#4fbf5a'); if (stage >= 2) { c.globalCompositeOperation = 'lighter'; ell(c, px, py - 12 * f, 12, 6, 'rgba(200,100,255,.25)'); c.globalCompositeOperation = 'source-over'; } break;
      case 5: c.fillStyle = '#9aa3c2'; c.fillRect(px - 8, py - 20 * f - 2, 16, 20 * f + 2); R(c, px - 8, py - 20 * f - 2, 16, 3, '#c9cfe6'); if (stage >= 2) { const pl = .6 + .4 * sin(t * 4 + ph); c.globalCompositeOperation = 'lighter'; ell(c, px, py - 11 * f, 7 * pl + 3, 7 * pl + 3, 'rgba(90,240,255,.55)'); c.globalCompositeOperation = 'source-over'; R(c, px - 2, py - 14 * f, 4, 6, '#aef7ff'); } break;
      case 6: dome(c, px, py, 12, 15 * f + 3, '#e9e1d0', null, t); if (stage >= 2) { R(c, px - 1, py - 14 * f - 2, 2, 12 * f, '#23273f'); line(c, [px, py - 12 * f], [px + cos(t * .6) * 10, py - 12 * f - 8], '#bfc6e0', 3); } break;
      default: dome(c, px, py, 18 * f + 4, 26 * f + 4, '#f4e7b8', stage === 3 ? 'rgba(255,230,150,.85)' : null, t); if (stage >= 2) { c.strokeStyle = '#f5c542'; c.lineWidth = 2; c.beginPath(); c.ellipse(px, py, 18 * f + 4, 9 * f + 2, 0, 0, Math.PI); c.stroke(); }
    }
    if (stage < 3) { c.strokeStyle = 'rgba(255,200,60,.8)'; c.lineWidth = 1; c.strokeRect(px - 12, py - 26 * f - 6, 24, 26 * f + 8); if (Math.floor(t * 4 + ph) % 2) R(c, px + 10, py - 26 * f - 8, 2, 2, '#ff8a3d'); }
  }
  const rover = { x: 3.5, y: 8, dir: 1 }, drones = Array.from({ length: 4 }, (_, i) => ({ a: i * 1.6, r: 1.4 + i * .25 }));
  function spaceItems(c, t, items, solo) {
    const L = RPGV.level(), n = nightFactor(t), now = RPGV.now();
    for (const k of rooms()) { const land = landFor(k); if (!land) continue; land.plots.forEach(p => { const [x, y] = cellXY(k, p.c); items.push({ d: x + y + .6, f: () => module(c, x, y, p.k, RC.stageOf(p, now), t, p.c) }); }); }
    for (const k of rooms()) items.push({ d: DIVS[k].ox + DIVS[k].oy + 6.3, f: () => banner(c, k, t, 'space', .9, 6.1) });
    if (solo) return;
    if (L >= 3) { rover.x += rover.dir * .012; if (rover.x > 12.4 || rover.x < 3.5) rover.dir *= -1; items.push({ d: rover.x + rover.y + .5, f: () => { const [bx, by] = iso(rover.x, rover.y, 0), px = Math.round(bx), py = Math.round(by); shadow(c, px, py + 1, 9, 4, .25); R(c, px - 7, py - 6, 14, 4, '#e8edfb'); R(c, px - 4, py - 10, 8, 4, '#aab1d1'); R(c, px - 3, py - 9, 6, 2, '#5ff0ff'); for (const dx of [-6, 0, 5]) { R(c, px + dx, py - 3, 3, 3, '#23273f'); } line(c, [px + 4, py - 10], [px + 8, py - 16 + Math.round(sin(t * 3) * 2)], '#c9cfe6', 1); } }); }
    if (L >= 4) drones.forEach(d => { d.a += .012; items.push({ d: 16 + 2, f: () => { const [bx, by] = iso(8 + cos(d.a) * d.r, 8 + sin(d.a) * d.r, 0), px = Math.round(bx), py = Math.round(by) - 34 - Math.round(sin(t * 3 + d.a) * 3); ell(c, px, py + 36, 6, 2, 'rgba(0,0,0,.2)'); R(c, px - 4, py, 8, 3, '#e8edfb'); R(c, px - 7, py - 2, 4, 1, '#98a0c8'); R(c, px + 3, py - 2, 4, 1, '#98a0c8'); R(c, px - 1, py + 3, 2, 1, Math.floor(t * 6 + d.a) % 2 ? '#5ff0ff' : '#1d5a66'); } }); });
    if (L >= 8) items.push({ d: 8 + 8 + .4, f: () => { const [bx, by] = iso(8, 8, 0), px = Math.round(bx), py = Math.round(by), ph = (t / 40) % 1, up = ph > .85 ? (ph - .85) / .15 * 160 : 0, al = 1 - up / 160; c.globalAlpha = Math.max(0, al); ell(c, px, py + 1, 12, 5, 'rgba(0,0,0,.25)'); R(c, px - 4, py - 22 - up, 8, 18, '#f4f6ff'); poly(c, [[px - 4, py - 22 - up], [px + 4, py - 22 - up], [px, py - 30 - up]], '#ff5d6c'); R(c, px - 7, py - 8 - up, 3, 6, '#c9cfe6'); R(c, px + 4, py - 8 - up, 3, 6, '#c9cfe6'); R(c, px - 1, py - 16 - up, 2, 3, '#5ff0ff'); if (up > 0) { c.globalCompositeOperation = 'lighter'; ell(c, px, py - up + 2, 5, 12, 'rgba(255,170,60,.6)'); c.globalCompositeOperation = 'source-over'; } c.globalAlpha = 1; } });
  }
  function spacePost(c, t) {
    const n = nightFactor(t), w = weather(t); atmosphere(c, t, 'space');
    if (w === 'rain') { for (let i = 0; i < 7; i++) { const ph = (t * .35 + rnd(i, 80)) % 1, x = rnd(i, 81) * W0 + ph * -240 + 200, y = ph * H0 * 1.2 - 40; c.globalCompositeOperation = 'lighter'; const g = c.createLinearGradient(x, y, x + 70, y - 38); g.addColorStop(0, 'rgba(255,230,170,.9)'); g.addColorStop(1, 'rgba(255,170,90,0)'); c.strokeStyle = g; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 70, y - 38); c.stroke(); c.globalCompositeOperation = 'source-over'; } }
    if (w === 'cloud') { c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(215,140,90,.16)'; c.fillRect(0, 0, W0, H0); c.globalCompositeOperation = 'source-over'; }
    if (n > .3) { c.globalCompositeOperation = 'lighter'; for (const a of AGENTS) { const p = iso(a.desk[0] + .5, a.desk[1] + .5, 18), g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], 50); g.addColorStop(0, `rgba(120,230,255,${.4 * n})`); g.addColorStop(1, 'rgba(120,230,255,0)'); c.fillStyle = g; c.fillRect(p[0] - 50, p[1] - 50, 100, 100); } c.globalCompositeOperation = 'source-over'; }
  }
  window.SKINS.space = { custom: true, label: 'Space', static: spaceStatic, back: spaceBack, world() {}, desk: spaceDesk, avatar: (c, ax, ay, a, t, pose) => person(c, ax, ay, a, t, pose, 'bot'), items: spaceItems, post: spacePost };

  /* ======================================================================
     switching skins
     ====================================================================== */
  window.setSkin = name => {
    if (!window.SKINS[name]) name = 'office';
    window.SKINID = name; try { localStorage.setItem('po.skin', name); } catch { /* ignore */ }
    document.body.dataset.skin = name; lastSky = ''; const st = document.getElementById('stage');
    if (st) { if (name === 'office') st.style.background = ''; else paintSky(performance.now() / 1000, name); }
    for (const id of ['wxSel', 'tmSel']) { const el = document.getElementById(id); if (el) el.hidden = name === 'office'; }
    const sel = document.getElementById('skinSel'); if (sel) sel.value = name;
    if (typeof buildStatic === 'function') buildStatic();
  };
  window.setWorld = (kind, v) => { WX[kind] = v; const sel = document.getElementById(kind === 'weather' ? 'wxSel' : 'tmSel'); if (sel) sel.value = v; try { localStorage.setItem('po.' + kind, v); } catch { /* ignore */ } lastSky = ''; if (kind === 'weather') WX.until = 0; };
  window.WORLD = WX;
  const saved = (() => { try { return localStorage.getItem('po.skin'); } catch { return null; } })();
  if (!location.protocol.startsWith('http')) RPGV.demo();
  { const pv = Number(new URLSearchParams(location.search).get('preview')); if (pv >= 1 && pv <= 30) RPGV.preview = { level: pv }; }
  window.setSkin(window.SKINS[saved] ? saved : 'office');
})();
