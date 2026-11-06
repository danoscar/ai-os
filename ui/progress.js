/* =====================================================================
   PIXEL OFFICE — progress UI: level button, toasts, the Progress panel, skin / weather / time controls.
   ===================================================================== */
(() => {
  'use strict';
  const q = s => document.querySelector(s), RC = RPGCORE;
  const E = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = n => Math.round(n).toLocaleString('en-US');

  RPGV.plotPos = (root, i) => { const key = (typeof OBS !== 'undefined' && OBS) ? obsRoom[root] : String(root).replace('demo:', ''); if (!key || !DIVS[key]) return null; const [rx, ry] = RC.CELLS[i], D = DIVS[key]; return iso(D.ox + rx + .5, D.oy + ry + .5, 0); };

  /* ---------- level button ---------- */
  function renderBtn() {
    const c = RPGV.company(); if (!c) return;
    q('#lvNum').textContent = '★ LV ' + c.level; q('#lvFill').style.width = Math.round(c.pct * 100) + '%'; q('#lvXp').textContent = `${num(c.xp)} XP`;
    q('#lvBtn').title = `Level ${c.level} · ${num(c.hi - c.xp)} XP to level ${c.level + 1} — click for perks and how to level up`;
    if (q('#progModal').classList.contains('on')) renderPanel();
  }
  RPGV.listeners.push(renderBtn);

  /* ---------- toast ---------- */
  let tt = 0;
  function toast(msg, col) { const el = q('#toast'); el.textContent = msg; el.style.borderColor = col || 'var(--amber)'; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 4200); }

  /* ---------- events from the engine ---------- */
  window.onRpgEvent = ev => {
    const where = (root, cell) => { const p = RPGV.plotPos(root, cell); return p ? { ax: p[0], ay: p[1] + 20 } : null; };
    if (ev.kind === 'levelup') {
      const who = ev.scope === 'company' ? 'COMPANY' : (ev.scope === 'land' ? ev.name + ' land' : ev.name);
      toast(`LEVEL UP!  ${who} → Lv ${ev.level}${ev.title ? ' · ' + ev.title : ''}`, ev.scope === 'company' ? '#ffc83d' : '#5be37d');
      logLine('OK', 'RPG', `level up: ${who} reached Lv ${ev.level}${ev.title ? ' (' + ev.title + ')' : ''}`);
      if (ev.scope === 'company') { const sk = window.SKINID, pk = RC.perksFor(sk, ev.level).find(p => p.lvl === ev.level); if (pk) logLine('OK', 'RPG', `new perk unlocked: ${pk.name}`); }
    } else if (ev.kind === 'plant') { const a = where(ev.root, ev.cell); if (a && window.SKINID !== 'office') burst(a, window.SKINID === 'space' ? 'BUILD' : 'PLANT', '#7bd05a', ['#7bd05a', '#c6f08a', '#8a5a2e']); }
    else if (ev.kind === 'harvest') { const a = where(ev.root, ev.cell); if (a) burst(a, '+' + ev.coins + 'c', '#ffd23f', ['#ffd23f', '#fff3a0', '#ff8a2a']); logLine('INFO', 'RPG', `${window.SKINID === 'space' ? 'shipped' : 'harvested'} ${(window.SKINID === 'space' ? RC.MODULES : RC.CROPS)[ev.k]} on ${ev.name}: +${ev.coins} coins`); }
    else if (ev.kind === 'day') toast(`Daily bonus +${ev.xp} XP · ${ev.streak}-day streak`, '#5cc8ff');
  };

  /* ---------- progress panel ---------- */
  function renderPanel() {
    const st = RPGV.state; if (!st) { q('#pgBody').innerHTML = '<div class="wide" style="color:var(--dim)">No progress yet. Start the bridge (<code>node server.js</code>) and do some work.</div>'; return; }
    const c = st.company, skin = window.SKINID, perks = RC.perksFor(skin, c.level), next = perks.find(p => !p.unlocked);
    const lands = Object.entries(st.lands).sort((a, b) => b[1].xp - a[1].xp).slice(0, 8), chars = Object.values(st.chars).sort((a, b) => b.xp - a.xp).slice(0, 6);
    q('#pgSub').textContent = `${skin === 'office' ? 'Office' : skin === 'farm' ? 'Farm' : 'Space station'} skin · progress is saved on this computer only`;
    q('#pgBody').innerHTML = `
      <div class="wide"><h4>Company</h4><div style="font-size:18px;color:#fff"><b style="color:var(--amber)">Level ${c.level}</b> · ${num(c.xp)} XP <small style="color:var(--dim)">(${num(c.hi - c.xp)} to level ${c.level + 1})</small></div>
        <div class="pg-bar"><i style="width:${Math.round(c.pct * 100)}%"></i></div>
        <div class="pg-stats"><div><b>${c.streak}</b>day streak</div><div><b>${num(c.today.xp || 0)}</b>XP today</div><div><b>${num(c.stats.tools)}</b>tool calls</div><div><b>${num(c.stats.turns)}</b>turns finished</div><div><b>${num(c.stats.harvests)}</b>${skin === 'space' ? 'modules shipped' : 'harvests'}</div><div><b>${num(c.stats.coins)}</b>coins</div></div></div>
      <div><h4>Perks · ${E(skin)}</h4><ul class="pg-list">${perks.map(p => `<li class="${p.unlocked ? '' : 'lock'}"><b>${p.unlocked ? '✔' : '🔒'} L${p.lvl}</b><span>${E(p.name)}</span></li>`).join('')}</ul>${next ? `<p style="color:var(--dim);font-size:11px">Next: <b style="color:var(--amber)">${E(next.name)}</b> at level ${next.lvl}</p>` : '<p style="color:#7be0a0;font-size:11px">Everything unlocked!</p>'}</div>
      <div><h4>How to earn XP</h4><ul class="pg-list">${RC.HOW.map(([a, b]) => `<li><b>${E(a)}</b><span>${E(b)}</span></li>`).join('')}</ul></div>
      <div><h4>Lands (projects)</h4><ul class="pg-list">${lands.length ? lands.map(([, l]) => `<li><b>L${l.level}</b><span>${E(l.name)} · ${l.plots.length} growing · ${l.harvested} done</span></li>`).join('') : '<li class="lock"><span>none yet</span></li>'}</ul></div>
      <div><h4>Characters</h4><ul class="pg-list">${chars.length ? chars.map(x => `<li><b>L${x.level}</b><span>${E(x.title)} · ${E(String(x.name).slice(0, 34))}</span></li>`).join('') : '<li class="lock"><span>none yet</span></li>'}</ul>
        <p style="color:var(--dim);font-size:11px">Character perks: ${RC.CHAR_PERKS.map(([l, n]) => `L${l} ${E(n)}`).join(' · ')}</p></div>
      <div class="wide" style="text-align:right">${location.protocol.startsWith('http') ? '<button class="pg-reset" id="pgReset">RESET PROGRESS…</button>' : ''}</div>`;
  }
  function open() { q('#progModal').classList.add('on'); q('#progModal').setAttribute('aria-hidden', 'false'); renderPanel(); }
  function close() { q('#progModal').classList.remove('on'); q('#progModal').setAttribute('aria-hidden', 'true'); }
  q('#lvBtn').addEventListener('click', open); q('#pgClose').addEventListener('click', close);
  q('#progModal').addEventListener('mousedown', e => { if (e.target === q('#progModal')) close(); });
  q('#pgBody').addEventListener('click', async e => {
    if (e.target.id !== 'pgReset') return;
    if (!confirm('Reset ALL progress (levels, plots, streak)? This cannot be undone.')) return;
    await fetch('/api/rpg/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) }); close();
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  /* ---------- skin / weather / time controls ---------- */
  q('#skinSel').addEventListener('change', e => { setSkin(e.target.value); if (q('#progModal').classList.contains('on')) renderPanel(); });
  q('#wxSel').value = WORLD.weather; q('#tmSel').value = WORLD.time;
  q('#wxSel').addEventListener('change', e => setWorld('weather', e.target.value)); q('#tmSel').addEventListener('change', e => setWorld('time', e.target.value));
  q('#skinSel').value = window.SKINID; renderBtn();
})();
