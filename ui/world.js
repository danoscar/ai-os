/* =====================================================================
   PIXEL OFFICE — world extras (work in every skin):
     1. COLONY MAP   every project on one screen as hex sectors; click a sector to walk into it
     2. SECTOR ALERTS a room that needs you pulses amber, a busy room shows running lights
     3. FOCUS MODE   hide the console and the log so the world fills the window
     4. NOTIFICATIONS browser notifications when a session needs you or finishes (opt-in)
   Loaded after the main script and skins.js: it uses their globals (AGENTS, DIVS, DKEYS, iso, poly, shade, …).
   ===================================================================== */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), sin = Math.sin, cos = Math.cos, PI = Math.PI;
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } } };
  const observing = () => typeof OBS !== 'undefined' && OBS && lastOffice;
  const hashOf = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h ^ (h >>> 15)) >>> 0; };
  const PAL = ['#b57bff', '#ff7ab8', '#5be37d', '#5cc8ff', '#ffc83d', '#ff8a5c', '#7be0d0', '#c9d36a'];
  const ST = { working: '#5be37d', waiting: '#ffc83d', idle: '#a79fd6', sleeping: '#5a5488' };

  /* every project, whether or not it is on the current page of the office */
  function projects() {
    if (observing()) {
      const by = new Map();
      for (const it of [...lastOffice.sessions, ...lastOffice.subs]) { let p = by.get(it.root); if (!p) by.set(it.root, p = { root: it.root, name: it.project, items: [] }); p.items.push({ name: it.name, status: it.sleeping ? 'sleeping' : it.status, sub: it.kind === 'sub', provider: it.provider || 'claude' }); }
      const order = obsOrder.filter(r => by.has(r)); for (const r of by.keys()) if (!order.includes(r)) order.push(r);
      return order.map(r => by.get(r));
    }
    return DKEYS.map(k => ({ root: 'demo:' + k, name: DIVS[k].label, color: DIVS[k].color, items: AGENTS.filter(a => a.div === k).map(a => ({ name: a.name, status: a.state === 'working' ? 'working' : a.state === 'waiting' ? 'waiting' : 'idle', sub: false, provider: 'claude' })) }));
  }
  const stateOf = p => p.items.some(i => i.status === 'waiting') ? 'waiting' : p.items.some(i => i.status === 'working') ? 'working' : p.items.some(i => i.status === 'idle') ? 'idle' : 'sleeping';

  /* ================= 1. COLONY MAP ================= */
  const cv = $('#mapCv'), tipEl = $('#mapTip'), mapBtn = $('#mapBtn'), SQ = .58;
  let mapOn = false, hover = null, tiles = [], raf = 0, cw = 0, ch = 0;
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  function spiral(n) {                                   // axial hex coordinates: centre first, then ring by ring
    const out = [[0, 0]]; for (let k = 1; out.length < n; k++) { let q = k, r = -k; for (let d = 0; d < 6 && out.length < n; d++) for (let s = 0; s < k && out.length < n; s++) { out.push([q, r]); q += DIRS[(d + 1) % 6][0]; r += DIRS[(d + 1) % 6][1]; } }
    return out;
  }
  function layout() {
    const ps = projects(), cells = spiral(ps.length + 1), unit = cells.map(([q, r]) => [1.72 * q, Math.sqrt(3) * 1.5 * (r + q / 2) * SQ]);
    const xs = unit.map(u => u[0]), ys = unit.map(u => u[1]), w = Math.max(...xs) - Math.min(...xs) + 2.5, h = Math.max(...ys) - Math.min(...ys) + 2.7;
    const S = Math.max(26, Math.min(118, cw / w, ch / h)), mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
    tiles = unit.map((u, i) => ({ x: cw / 2 + (u[0] - mx) * S, y: ch / 2 + (u[1] - my) * S - S * .12, S, hq: i === 0, p: i ? ps[i - 1] : null })).sort((a, b) => a.y - b.y);
  }
  const hexPts = (x, y, S, k = 1) => Array.from({ length: 6 }, (_, i) => [x + S * k * cos(i * PI / 3), y + S * k * sin(i * PI / 3) * SQ]);
  const path = (c, pts) => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); };
  const fillP = (c, pts, col) => { path(c, pts); c.fillStyle = col; c.fill(); };
  const boxIso = (c, x, y, w, d, h, col) => {            // a small isometric block standing on (x, y)
    const a = [x - w, y], b = [x, y + d], e = [x + w, y], f = [x, y - d];
    fillP(c, [a, b, [b[0], b[1] - h], [a[0], a[1] - h]], shade(col, -.28)); fillP(c, [b, e, [e[0], e[1] - h], [b[0], b[1] - h]], shade(col, -.45));
    fillP(c, [[a[0], a[1] - h], [b[0], b[1] - h], [e[0], e[1] - h], [f[0], f[1] - h]], col);
  };
  function pip(c, x, y, s, st, t, ph, sub) {             // a tiny person
    const col = ST[st], hop = st === 'waiting' ? Math.abs(sin(t * 6 + ph)) * s * .9 : st === 'working' ? Math.abs(sin(t * 9 + ph)) * s * .3 : 0, k = sub ? .75 : 1;
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x, y + s * .15, s * .7 * k, s * .25 * k, 0, 0, PI * 2); c.fill();
    c.globalAlpha = st === 'sleeping' ? .75 : 1; c.fillStyle = col; c.fillRect(Math.round(x - s * .5 * k), Math.round(y - s * 1.5 * k - hop), Math.ceil(s * k), Math.ceil(s * 1.5 * k));
    c.fillStyle = shade(col, .35); c.fillRect(Math.round(x - s * .4 * k), Math.round(y - s * 2.4 * k - hop), Math.ceil(s * .8 * k), Math.ceil(s * .85 * k)); c.globalAlpha = 1;
  }
  function plate(c, text, x, y, px, fg, bg, bold = true) {
    c.font = `${bold ? 700 : 400} ${px}px ${getComputedStyle(document.body).fontFamily}`; const w = Math.ceil(c.measureText(text).width) + 10;
    c.fillStyle = bg; c.fillRect(Math.round(x - w / 2), Math.round(y), w, px + 6); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(text, Math.round(x), Math.round(y) + 3); return w;
  }
  function drawTile(c, tl, t) {
    const skin = window.SKINID || 'office', S = tl.S, st = tl.hq ? 'idle' : stateOf(tl.p), hov = hover === tl, lift = hov ? S * .07 : 0, x = tl.x, y = tl.y - lift;
    const col = tl.hq ? '#ffc83d' : tl.p.color || PAL[hashOf(tl.p.root) % PAL.length], ph = tl.hq ? 0 : hashOf(tl.p.root) % 7, depth = S * .2, top = hexPts(x, y, S * .97), dim = st === 'sleeping';
    const base = skin === 'farm' ? '#6fc24c' : skin === 'space' ? '#4a5078' : shade(col, -.42), side = skin === 'farm' ? '#7a4f2c' : skin === 'space' ? '#262a48' : shade(col, -.68);
    c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(tl.x, tl.y + depth + S * .1, S * .95, S * .5, 0, 0, PI * 2); c.fill();
    for (let i = 0; i < 3; i++) fillP(c, [top[i], top[i + 1], [top[i + 1][0], top[i + 1][1] + depth], [top[i][0], top[i][1] + depth]], shade(side, [-.25, 0, .18][i]));
    fillP(c, top, base);
    if (skin === 'farm') {                                // tilled field + crops + a small barn
      fillP(c, hexPts(x, y, S * .97, .78), '#8b5a34'); if (!tl.hq) { path(c, hexPts(x, y, S * .97, .78)); c.strokeStyle = col; c.lineWidth = Math.max(1.5, S * .028); c.stroke(); }
      const land = window.RPGV && !tl.hq ? RPGV.land(tl.p.root) : null, crops = tl.hq ? 0 : Math.min(18, land ? land.plots.length : tl.p.items.length * 2), cc = ['#f4d35e', '#7bd66a', '#ff8a5c', '#c58bff', '#ff6f91'][ph % 5];
      c.strokeStyle = 'rgba(60,34,16,.55)'; c.lineWidth = Math.max(1, S * .02); for (let r = -2; r <= 2; r++) { c.beginPath(); c.moveTo(x - S * .55, y + r * S * .13 + S * .06); c.lineTo(x + S * .55, y + r * S * .13 - S * .06); c.stroke(); }
      for (let i = 0; i < crops; i++) { const r = (i % 5) - 2, u = (Math.floor(i / 5) - 1.5) * .24 + r * .03, px = x + u * S, py = y + r * S * .13 - u * S * .11 + S * .02, sw = sin(t * 2 + i) * S * .01; c.fillStyle = '#3f9a3a'; c.fillRect(px + sw, py - S * .09, Math.max(2, S * .035), S * .09); c.fillStyle = cc; c.fillRect(px - S * .02 + sw, py - S * .13, Math.max(3, S * .075), Math.max(3, S * .06)); }
      if (tl.hq) { boxIso(c, x, y + S * .02, S * .3, S * .16, S * .3, '#c8434a'); fillP(c, [[x - S * .34, y - S * .28], [x, y - S * .5], [x + S * .34, y - S * .28], [x, y - S * .1]], '#8f2c33'); c.fillStyle = '#f3e3c0'; c.fillRect(x - S * .05, y - S * .1, S * .1, S * .16); }
    } else if (skin === 'space') {                        // landing plate + glass dome
      path(c, hexPts(x, y, S * .97, .82)); c.strokeStyle = shade(col, -.1); c.lineWidth = Math.max(1.5, S * .03); c.stroke();
      const glow = dim ? .12 : .3 + .15 * sin(t * 2 + ph), rx = S * (tl.hq ? .5 : .42);
      c.fillStyle = shade(col, -.5); c.beginPath(); c.ellipse(x, y, rx, rx * SQ, 0, 0, PI * 2); c.fill();
      const g = c.createRadialGradient(x - rx * .3, y - rx * .9, rx * .1, x, y - rx * .3, rx * 1.2); g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(.35, shade(col, .2)); g.addColorStop(1, shade(col, -.45));
      c.globalAlpha = .9; c.fillStyle = g; c.beginPath(); c.ellipse(x, y, rx, rx * 1.05, 0, PI, 0); c.ellipse(x, y, rx, rx * SQ, 0, 0, PI); c.fill(); c.globalAlpha = 1;
      c.strokeStyle = `rgba(160,245,255,${glow + .3})`; c.lineWidth = Math.max(1, S * .02); c.beginPath(); c.ellipse(x, y, rx, rx * SQ, 0, 0, PI); c.stroke();
      if (tl.hq) { c.fillStyle = '#cfd6ee'; c.fillRect(x - S * .02, y - rx * 1.5, S * .04, rx * .5); c.fillStyle = Math.floor(t * 2) % 2 ? '#ff5d6c' : '#6a2a30'; c.fillRect(x - S * .04, y - rx * 1.58, S * .08, S * .08); }
    } else {                                              // carpet + a little tower whose windows are the sessions
      fillP(c, hexPts(x, y, S * .97, .8), shade(col, -.18)); path(c, hexPts(x, y, S * .97, .8)); c.strokeStyle = shade(col, .25); c.lineWidth = Math.max(1, S * .02); c.stroke();
      const n = tl.hq ? 8 : tl.p.items.length, floors = Math.max(2, Math.min(5, Math.ceil(n / 2))), bw = S * .27, bd = S * .15, bh = S * (.2 + floors * .13), by = y + S * .05;
      boxIso(c, x, by, bw, bd, bh, tl.hq ? '#e8c46a' : shade(col, -.05));
      for (let f = 0; f < floors; f++) for (let wv = 0; wv < 2; wv++) { const it = tl.hq ? { status: 'working' } : tl.p.items[f * 2 + wv], lit = it && (it.status === 'working' ? (Math.floor(t * 3 + f + wv) % 5 !== 0) : it.status === 'waiting' ? Math.floor(t * 4) % 2 === 0 : false);
        const wx = x - bw * (.78 - wv * .42), wy = by - bh + S * .07 + f * S * .13 + (bd * (1 - (.78 - wv * .42))) - bd; c.fillStyle = !it ? 'rgba(0,0,0,.35)' : lit ? (it.status === 'waiting' ? '#ffc83d' : '#fff3b0') : it.status === 'idle' ? '#5a6aa8' : '#2a2c52'; c.fillRect(Math.round(wx), Math.round(wy + S * .1), Math.max(3, S * .07), Math.max(3, S * .07)); }
    }
    /* state on the tile itself */
    if (st === 'waiting') { const a = .55 + .45 * sin(t * 6); path(c, top); c.strokeStyle = `rgba(255,200,61,${a})`; c.lineWidth = Math.max(3, S * .05); c.stroke(); }
    else if (st === 'working') { path(c, top); c.setLineDash([S * .14, S * .1]); c.lineDashOffset = -t * S * .35; c.strokeStyle = ST.working; c.lineWidth = Math.max(2, S * .028); c.stroke(); c.setLineDash([]); for (let i = 0; i < 4; i++) { const f = (t * .5 + i / 4 + ph) % 1; c.fillStyle = `rgba(255,255,255,${.7 * (1 - f)})`; c.fillRect(x + sin(i * 2.4 + ph) * S * .3, y - S * .25 - f * S * .5, Math.max(2, S * .03), Math.max(2, S * .03)); } }
    if (hov) { path(c, top); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
    if (dim) { c.globalAlpha = .34; fillP(c, top, '#0b0820'); c.globalAlpha = 1; }
    /* the people */
    if (!tl.hq) { const its = tl.p.items.slice().sort((a, b) => ['waiting', 'working', 'idle', 'sleeping'].indexOf(a.status) - ['waiting', 'working', 'idle', 'sleeping'].indexOf(b.status)), n = Math.min(its.length, 9), ps = Math.max(4, S * .085), gap = ps * 1.7, x0 = x - (n - 1) * gap / 2;
      for (let i = 0; i < n; i++) pip(c, x0 + i * gap, y + S * .4 + (i % 2) * ps * .25, ps, its[i].status, t, i + ph, its[i].sub);
      if (its.length > n) { c.fillStyle = '#fff'; c.font = `700 ${Math.max(9, S * .11)}px monospace`; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText('+' + (its.length - n), x0 + n * gap - ps * .4, y + S * .44); } }
    if (st === 'waiting') { const by = y - S * .78 - Math.abs(sin(t * 4)) * S * .08, r = S * .13; c.fillStyle = '#ffc83d'; c.beginPath(); c.moveTo(x, by + r * 1.7); c.lineTo(x - r * .5, by + r * .8); c.lineTo(x + r * .5, by + r * .8); c.fill(); c.fillRect(x - r, by - r, r * 2, r * 2); c.fillStyle = '#2a1d00'; c.fillRect(x - r * .18, by - r * .65, r * .36, r * .8); c.fillRect(x - r * .18, by + r * .35, r * .36, r * .32); }
  }
  function drawLabel(c, tl) {
    const S = tl.S, depth = S * .2, st = tl.hq ? 'idle' : stateOf(tl.p), col = tl.hq ? '#ffc83d' : tl.p.color || PAL[hashOf(tl.p.root) % PAL.length];
    const px = Math.max(10, Math.min(15, S * .135)), ly = tl.y + depth + S * .56, name = tl.hq ? 'HQ' + (window.RPGV && RPGV.company() ? ' · LV ' + RPGV.level() : '') : tl.p.name;
    plate(c, name.length > 22 ? name.slice(0, 21) + '…' : name, tl.x, ly, px, '#fff', tl.hq ? 'rgba(90,64,6,.92)' : shade(col, -.72));
    if (!tl.hq) { const cnt = k => tl.p.items.filter(i => i.status === k).length, bits = [cnt('waiting') && cnt('waiting') + ' need you', cnt('working') && cnt('working') + ' working', cnt('idle') && cnt('idle') + ' idle', cnt('sleeping') && cnt('sleeping') + ' asleep'].filter(Boolean), land = window.RPGV && RPGV.land(tl.p.root);
      plate(c, (land ? 'L' + land.level + ' · ' : '') + bits.join(' · '), tl.x, ly + px + 7, Math.max(9, px - 2), st === 'waiting' ? '#ffd77a' : '#d6d0f5', 'rgba(14,10,34,.82)', false); }
    else plate(c, observing() ? 'click: show all projects' : 'demo data', tl.x, ly + px + 7, Math.max(9, px - 2), '#d6d0f5', 'rgba(14,10,34,.82)', false);
  }
  function drawMap(now) {
    raf = mapOn ? requestAnimationFrame(drawMap) : 0; if (!mapOn) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    cw = w; ch = h; const c = cv.getContext('2d'), t = now / 1000, skin = window.SKINID || 'office'; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, h); const bg = skin === 'farm' ? ['#7ec8ff', '#d9f1ff'] : skin === 'space' ? ['#0a0720', '#2a1640'] : ['#120d2c', '#1d1745']; g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]); c.fillStyle = g; c.fillRect(0, 0, w, h);
    if (skin === 'space') for (let i = 0; i < 90; i++) { const a = .3 + .5 * Math.abs(sin(t * 1.5 + i)); c.fillStyle = `rgba(255,255,255,${a})`; c.fillRect((i * 197.3) % w, (i * 113.7) % h, i % 9 ? 1 : 2, i % 9 ? 1 : 2); }
    else if (skin === 'office') { c.fillStyle = 'rgba(120,105,200,.16)'; for (let gx = 12; gx < w; gx += 24) for (let gy = 12; gy < h; gy += 24) c.fillRect(gx, gy, 1, 1); }
    const hk = hover && (hover.hq ? 'hq' : hover.p.root); layout(); hover = hk ? tiles.find(tl => (tl.hq ? 'hq' : tl.p.root) === hk) || null : null;
    const hq = tiles.find(tl => tl.hq); c.lineWidth = 2;
    for (const tl of tiles) if (!tl.hq) { const st = stateOf(tl.p); c.strokeStyle = st === 'waiting' ? 'rgba(255,200,61,.55)' : st === 'working' ? 'rgba(91,227,125,.45)' : skin === 'farm' ? 'rgba(90,60,30,.3)' : 'rgba(150,140,220,.22)'; c.setLineDash([6, 6]); c.lineDashOffset = st === 'working' ? -t * 24 : 0; c.beginPath(); c.moveTo(hq.x, hq.y); c.lineTo(tl.x, tl.y); c.stroke(); }
    c.setLineDash([]); for (const tl of tiles) drawTile(c, tl, t); for (const tl of tiles) drawLabel(c, tl);
    const ps = tiles.filter(tl => !tl.hq).map(tl => tl.p), n = k => ps.reduce((a, p) => a + p.items.filter(i => i.status === k).length, 0);
    c.textAlign = 'left'; c.textBaseline = 'top'; c.font = `700 11px ${getComputedStyle(document.body).fontFamily}`; const head = `COLONY MAP · ${ps.length} PROJECTS · ${n('working')} WORKING · ${n('waiting')} NEED YOU · ${n('idle')} IDLE`, hw = c.measureText(head).width;
    c.fillStyle = 'rgba(14,10,34,.82)'; c.fillRect(10, 10, hw + 16, 22); c.fillStyle = n('waiting') ? '#ffd77a' : '#ece8ff'; c.fillText(head, 18, 16);
  }
  const tileAt = (mx, my) => { let best = null; for (const tl of tiles) { const dx = (mx - tl.x) / tl.S, dy = (my - tl.y) / (tl.S * SQ); if (dx * dx + dy * dy < .86 && (!best || tl.y > best.y)) best = tl; } return best; };
  const E = s => String(s ?? '').replace(/[&<>"]/g, ch2 => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch2]));
  cv.addEventListener('mousemove', e => {
    const r = cv.getBoundingClientRect(); hover = tileAt(e.clientX - r.left, e.clientY - r.top);
    if (!hover) { tipEl.classList.remove('on'); return; }
    const p = hover.p, col = hover.hq ? '#ffc83d' : p.color || PAL[hashOf(p.root) % PAL.length];
    tipEl.style.setProperty('--c', col);
    tipEl.innerHTML = hover.hq ? `<b>Headquarters</b><br>${observing() ? 'Click to show every project in the office.' : 'Demo data. Start the bridge to see your own sessions.'}`
      : `<b>${E(p.name)}</b><br>${p.items.slice(0, 8).map(i => `<span style="color:${ST[i.status]}">■</span> ${E(i.name)} <small style="opacity:.7">${i.status === 'waiting' ? 'needs you' : i.status}${i.sub ? ' · helper' : ''}</small>`).join('<br>')}${p.items.length > 8 ? `<br><small>+${p.items.length - 8} more</small>` : ''}<br><small style="opacity:.7">Click to open this project.</small>`;
    tipEl.classList.add('on'); const tw = tipEl.offsetWidth, th = tipEl.offsetHeight; tipEl.style.left = Math.max(6, Math.min(r.width - tw - 6, e.clientX - r.left + 14)) + 'px'; tipEl.style.top = Math.max(6, Math.min(r.height - th - 6, e.clientY - r.top + 14)) + 'px';
  });
  cv.addEventListener('mouseleave', () => { hover = null; tipEl.classList.remove('on'); });
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect(), tl = tileAt(e.clientX - r.left, e.clientY - r.top); if (!tl) return;
    if (observing()) obsSetSolo(tl.hq ? null : tl.p.root);
    setMap(false); setTimeout(() => { if (typeof fitZoom === 'function') fitZoom(); }, 0);
  });
  function setMap(v) {
    mapOn = v; cv.hidden = !v; mapBtn.setAttribute('aria-pressed', String(v)); tipEl.classList.remove('on'); store.set('po.map', v ? '1' : null);
    if (v && !raf) raf = requestAnimationFrame(drawMap);
  }
  mapBtn.addEventListener('click', () => setMap(!mapOn));
  if (store.get('po.map') === '1') setMap(true);

  /* ================= 2. SECTOR ALERTS (inside the world, every skin) ================= */
  window.sectorFX = (c, t, phase) => {
    const solo = soloKey(), keys = solo ? [solo] : DKEYS, round = window.SKINID === 'space';
    for (const k of keys) {
      const ag = AGENTS.filter(a => a.div === k && !a.sleeping && !a.done); if (!ag.length) continue;
      const wait = ag.filter(a => a.state === 'waiting').length, work = ag.filter(a => a.state === 'working').length; if (!wait && !work) continue;
      const D = DIVS[k], S = 7, pts = [iso(D.ox, D.oy), iso(D.ox + S, D.oy), iso(D.ox + S, D.oy + S), iso(D.ox, D.oy + S)], [mx, my] = iso(D.ox + S / 2, D.oy + S / 2);
      const along = f => { if (round) { const a = f * PI * 2; return [mx + cos(a) * S * 23.5, my + sin(a) * S * 11.8]; } const i = Math.floor(f * 4) % 4, u = f * 4 - Math.floor(f * 4), p = pts[i], q = pts[(i + 1) % 4]; return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]; };
      const trace = () => { c.beginPath(); if (round) c.ellipse(mx, my, S * 23.5, S * 11.8, 0, 0, PI * 2); else { pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); } };
      if (phase === 0) {
        if (wait) { const a = .5 + .5 * sin(t * 5); trace(); c.fillStyle = `rgba(255,200,61,${.05 + .07 * a})`; c.fill(); c.strokeStyle = `rgba(255,200,61,${.45 + .5 * a})`; c.lineWidth = 3; c.stroke(); }
        else { const n = 10 + work * 4; for (let i = 0; i < n; i++) { const [x, y] = along((i / n + t * .04) % 1), tw = .45 + .55 * Math.abs(sin(t * 3 + i)); c.fillStyle = shade(D.color, .25); c.globalAlpha = tw; c.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 3); c.globalAlpha = 1; } }
      } else if (wait) {
        const [bx, by0] = iso(D.ox + S / 2, D.oy + S / 2, 150), by = by0 - Math.abs(sin(t * 4)) * 6, s = textSprite(wait > 1 ? wait + ' NEED YOU' : 'NEEDS YOU', '#2a1d00'), w = s.w + 12, x0 = Math.round(bx - w / 2);
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x0 + 2, Math.round(by) + 2, w, 15); c.fillStyle = Math.floor(t * 3) % 2 ? '#ffc83d' : '#ffe08a'; c.fillRect(x0, Math.round(by), w, 15);
        c.beginPath(); c.moveTo(bx - 5, by + 15); c.lineTo(bx + 5, by + 15); c.lineTo(bx, by + 22); c.fill(); c.drawImage(s.cv, x0 + 6, Math.round(by) + 4);
      }
    }
  };

  /* ================= 3. FOCUS MODE ================= */
  const app = $('.app'), focusBtn = $('#focusBtn');
  function setFocus(v) { app.classList.toggle('focus', v); focusBtn.setAttribute('aria-pressed', String(v)); store.set('po.focus', v ? '1' : null); setTimeout(() => { if (typeof fitZoom === 'function') fitZoom(); }, 30); }
  focusBtn.addEventListener('click', () => setFocus(!app.classList.contains('focus')));
  if (store.get('po.focus') === '1') setFocus(true);
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '') || e.target.isContentEditable) return;
    if (!/on-(brain|repos|insights|guide)/.test(app.className)) { if (e.key === 'm' || e.key === 'M') setMap(!mapOn); else if (e.key === 'f' || e.key === 'F') setFocus(!app.classList.contains('focus')); else if (e.key === 'Escape' && mapOn) setMap(false); }
  });

  /* ================= 4. BROWSER NOTIFICATIONS (opt-in, only while this tab is not in front) ================= */
  const nBtn = $('#ntfBtn'), canNotify = 'Notification' in window, seen = new Map();
  let nOn = canNotify && store.get('po.notify') === '1' && Notification.permission === 'granted';
  const paintN = () => { nBtn.textContent = nOn ? '🔔 ON' : '🔔 OFF'; nBtn.setAttribute('aria-pressed', String(nOn)); if (!canNotify) { nBtn.disabled = true; nBtn.title = 'This browser has no notifications'; } };
  nBtn.addEventListener('click', async () => {
    if (nOn) { nOn = false; store.set('po.notify', null); return paintN(); }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    nOn = perm === 'granted'; store.set('po.notify', nOn ? '1' : null); paintN();
    if (nOn) new Notification('Pixel Office', { body: 'You will be told when a session needs you or finishes.', tag: 'po-test' }); else if (window.toast) toast('Notifications are blocked for this page in your browser settings');
  });
  paintN();
  setInterval(() => {
    if (!observing()) return; const now = Date.now(), present = new Set();
    for (const it of lastOffice.sessions) {
      present.add(it.id); const p = seen.get(it.id) || { status: it.status, since: now, fresh: true };
      if (it.status === 'working' && p.status !== 'working') p.since = now;
      if (nOn && !p.fresh && document.hidden) {
        let n = null;
        if (it.status === 'waiting' && p.status !== 'waiting') n = [`${it.project} needs you`, `${it.name || 'A session'} is waiting${it.waitingFor ? ': ' + it.waitingFor : ''}`];
        else if (p.status === 'working' && it.status === 'idle' && now - p.since > 90000) n = [`${it.project} finished`, `${it.name || 'A session'} is done after ${Math.round((now - p.since) / 60000)} min`];
        if (n) { const nt = new Notification(n[0], { body: n[1], tag: 'po-' + it.id }); nt.onclick = () => { window.focus(); if (typeof obsSetSolo === 'function') obsSetSolo(it.root); nt.close(); }; }
      }
      p.status = it.status; p.fresh = false; seen.set(it.id, p);
    }
    for (const id of [...seen.keys()]) if (!present.has(id)) seen.delete(id);
  }, 1500);

  window.POWORLD = { setMap, setFocus, projects };
})();
