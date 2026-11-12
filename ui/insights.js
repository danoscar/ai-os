/* =====================================================================
   PIXEL OFFICE — Insights tab: where the time went.
   The bridge samples your sessions once a second (stats.js) and this page draws it:
   working time, time sessions spent waiting for YOU, tokens, tool calls, approvals — by hour, day and project.
   ===================================================================== */
(() => {
  'use strict';
  const q = s => document.querySelector(s), app = q('.app'), body = q('#insBody');
  const E = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const C = { work: '#4a8fe6', wait: '#c08416' };                    // validated pair for the dark surface (colour-blind safe)
  const dur = s => { s = Math.round(s || 0); if (s < 60) return s + 's'; const m = Math.round(s / 60); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
  const num = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n || 0);
  const served = location.protocol.startsWith('http');
  let timer = 0, tip = null;

  const legend = `<div class="i-leg"><span><i style="background:${C.work}"></i>Working</span><span><i style="background:${C.wait}"></i>Waiting on you</span></div>`;
  function columns(rows, labelOf, tipOf, nowIdx) {            // stacked columns: working at the bottom, waiting on top, 2px gap
    const max = Math.max(60, ...rows.map(r => r.w + r.n));
    return `<div class="i-chart"><span class="i-y">${dur(max)}</span>${rows.map((r, i) => `<div class="i-col${i === nowIdx ? ' now' : ''}" data-tip="${E(tipOf(r, i))}">${r.w ? `<i style="height:${Math.max(1.5, r.w / max * 100)}%;background:${C.work}"></i>` : ''}${r.n ? `<i style="height:${Math.max(1.5, r.n / max * 100)}%;background:${C.wait}"></i>` : ''}</div>`).join('')}</div>
      <div class="i-x">${rows.map((r, i) => `<span>${labelOf(r, i)}</span>`).join('')}</div>`;
  }
  function table(list, max) {
    if (!list.length) return '<p class="i-note">Nothing recorded yet.</p>';
    return `<table class="i-tbl"><thead><tr><th>Project</th><th>Working</th><th>Waiting on you</th><th>Tokens</th><th>Tools</th><th>Turns</th><th>Approvals</th><th></th></tr></thead><tbody>${list.map(p => `<tr><td>${E(p.name)}</td><td>${dur(p.w)}</td><td>${p.n ? dur(p.n) : '–'}</td><td>${num(p.tok)}</td><td>${num(p.tools)}</td><td>${p.turns}</td><td>${p.appr || '–'}</td>
      <td><div class="i-bar" title="working ${dur(p.w)} · waiting ${dur(p.n)}">${p.w ? `<i style="width:${p.w / max * 100}%;background:${C.work}"></i>` : ''}${p.n ? `<i style="width:${p.n / max * 100}%;background:${C.wait}"></i>` : ''}</div></td></tr>`).join('')}</tbody></table>`;
  }
  function notes(s, t) {
    const out = [], hrs = s.hours.map((h, i) => ({ i, w: h[0], n: h[1] })), busy = hrs.slice().sort((a, b) => b.w - a.w)[0];
    if (busy && busy.w > 60) out.push(`Busiest hour today: <b>${String(busy.i).padStart(2, '0')}:00</b> with ${dur(busy.w)} of work.`);
    if (t.n > 120) { const worst = s.projects.slice().sort((a, b) => b.n - a.n)[0]; out.push(`Sessions spent <b>${dur(t.n)}</b> waiting on you today${worst && worst.n ? `, mostly in <b>${E(worst.name)}</b>` : ''}. Turn on 🔔 notifications or allow more tools up front to cut this.`); }
    else if (t.w > 600) out.push('Almost no time was lost waiting on you today.');
    if (t.appr) out.push(`You answered <b>${t.appr}</b> approval${t.appr > 1 ? 's' : ''} today, after ${dur(t.apprAvg)} on average.`);
    const act = s.days.filter(d => d.w > 60).length; if (act > 1) out.push(`Active on <b>${act}</b> of the last 14 days.`);
    const idle = s.projects.filter(p => p.i > 3600 && p.w < 60); if (idle.length) out.push(`Open but unused for over an hour: <b>${idle.slice(0, 3).map(p => E(p.name)).join(', ')}</b>. Closing idle sessions frees context and attention.`);
    return out.length ? `<ul class="i-note" style="margin:0;padding-left:18px">${out.map(o => `<li>${o}</li>`).join('')}</ul>` : '<p class="i-note">Keep the bridge running for a while and patterns show up here.</p>';
  }
  function render(s) {
    const t = s.days[s.days.length - 1], nowH = new Date().getHours(), pmax = Math.max(1, ...s.projects.map(p => p.w + p.n)), wmax = Math.max(1, ...s.week.map(p => p.w + p.n));
    const wk = s.days.slice(-7).reduce((a, d) => ({ w: a.w + d.w, n: a.n + d.n, tok: a.tok + d.tok }), { w: 0, n: 0, tok: 0 });
    const y = body.scrollTop;
    body.innerHTML = `
      <div class="i-tiles">
        <div class="i-tile"><span>WORKING TODAY</span><b>${dur(t.w)}</b><small>${dur(wk.w)} in the last 7 days</small></div>
        <div class="i-tile"><span>WAITING ON YOU TODAY</span><b>${dur(t.n)}</b><small>${dur(wk.n)} in the last 7 days</small></div>
        <div class="i-tile"><span>TOKENS SEEN TODAY</span><b>${num(t.tok)}</b><small>${num(wk.tok)} in the last 7 days</small></div>
        <div class="i-tile"><span>TOOL CALLS · TURNS</span><b>${num(t.tools)} · ${t.turns}</b><small>peak ${t.peak} session${t.peak === 1 ? '' : 's'} busy at once</small></div>
        <div class="i-tile"><span>APPROVALS TODAY</span><b>${t.appr}</b><small>${t.appr ? 'answered after ' + dur(t.apprAvg) + ' on average' : 'none answered from the office'}</small></div>
      </div>
      <div class="i-card"><h3>WHAT STANDS OUT</h3>${notes(s, t)}</div>
      <div class="i-card"><h3>TODAY BY HOUR <small>agent-time per hour</small></h3>${legend}${columns(s.hours.map(h => ({ w: h[0], n: h[1] })), (r, i) => i % 3 === 0 ? String(i).padStart(2, '0') : '', (r, i) => `${String(i).padStart(2, '0')}:00–${String(i + 1).padStart(2, '0')}:00|Working ${dur(r.w)}|Waiting on you ${dur(r.n)}`, nowH)}</div>
      <div class="i-two">
        <div class="i-card"><h3>PROJECTS TODAY</h3>${table(s.projects, pmax)}</div>
        <div class="i-card"><h3>LAST 14 DAYS</h3>${legend}${columns(s.days, r => +r.day.slice(8), r => `${r.day}|Working ${dur(r.w)}|Waiting on you ${dur(r.n)}|${num(r.tok)} tokens · ${r.tools} tools · ${r.appr} approvals`, s.days.length - 1)}</div>
      </div>
      <div class="i-two">
        <div class="i-card"><h3>PROJECTS, LAST 7 DAYS</h3>${table(s.week, wmax)}</div>
        <div class="i-card"><h3>BY AI TOOL, TODAY</h3>${table(s.providers.map(p => ({ ...p, name: ({ claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', grok: 'Grok Build', grokbot: 'Grok Bot app' })[p.name] || p.name })), Math.max(1, ...s.providers.map(p => p.w + p.n)))}</div>
      </div>
      <p class="i-note">Counted only while the bridge is running (${s.tracked} day${s.tracked === 1 ? '' : 's'} on record, 30 kept), so run it as a background service for complete numbers — see the Guide tab. Time is agent-time: two sessions working for 10 minutes count as 20. Everything stays on this computer in <code>~/.pixel-office/stats.json</code>.</p>`;
    body.scrollTop = y;
  }
  async function load() {
    if (!served) { body.innerHTML = '<div class="i-empty">Insights need the bridge.<br>Start <code>node server.js</code> and open <code>http://localhost:8787</code>.</div>'; return; }
    try { const r = await fetch('/api/stats'); if (!r.ok) throw new Error(r.statusText); render(await r.json()); }
    catch (e) { if (!body.firstChild) body.innerHTML = `<div class="i-empty">Could not reach the bridge: ${E(e.message)}</div>`; }
  }
  /* hover layer: one tooltip for every column */
  body.addEventListener('mousemove', e => {
    const col = e.target.closest('[data-tip]'); if (!tip) { tip = document.createElement('div'); tip.className = 'i-tipb'; document.body.appendChild(tip); }
    if (!col) { tip.style.display = 'none'; return; }
    const [head, ...rest] = col.dataset.tip.split('|'); tip.innerHTML = `<b>${E(head)}</b><br>${rest.map(E).join('<br>')}`; tip.style.display = 'block';
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 14) + 'px'; tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 10) + 'px';
  });
  body.addEventListener('mouseleave', () => { if (tip) tip.style.display = 'none'; });

  q('#mtabs').addEventListener('click', e => {
    const b = e.target.closest('[data-mt]'); if (!b) return; const on = b.dataset.mt === 'insights';
    app.classList.toggle('on-insights', on); clearInterval(timer); if (tip) tip.style.display = 'none';
    if (on) { load(); timer = setInterval(load, 10000); }
  });
})();
