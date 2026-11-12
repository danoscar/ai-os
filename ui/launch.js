/* =====================================================================
   PIXEL OFFICE — quick prompts and new sessions.
     • chips in a session's card: one click sends a saved prompt to that session
     • ⚡ PROMPT   send one prompt to several sessions at once, and edit the prompt library
     • ＋ SESSION  open a terminal in a known project running Claude Code (or Codex / Gemini / Grok)
   The library lives on this computer (~/.pixel-office/config.json); see launch.js for the safety rules.
   ===================================================================== */
(() => {
  'use strict';
  const q = s => document.querySelector(s), served = location.protocol.startsWith('http');
  const E = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const post = async (u, b) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; };
  const get = async u => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; };
  const observing = () => typeof OBS !== 'undefined' && OBS && lastOffice;
  const modal = q('#lnModal'), body = q('#lnBody'), title = q('#lnTitle'), sub = q('#lnSub');
  let lib = [], libVer = 0, projects = [], tools = [], terminal = 'Terminal', mode = '', draft = [], inbox = false;

  async function loadLib() { if (!served) return; try { lib = (await get('/api/prompts')).prompts; libVer++; } catch { /* bridge away: keep what we have */ } }
  async function loadProjects() { try { const d = await get('/api/projects'); projects = d.projects; tools = d.tools; terminal = d.terminal; inbox = !!d.inbox; } catch { projects = []; } }
  const forRoot = root => lib.filter(p => !p.scope || p.scope === root);
  const chips = (root, attr) => forRoot(root).map(p => `<button class="qchip${p.scope ? ' own' : ''}" ${attr}="${E(p.id)}" title="${E(p.text)}">${E(p.label)}</button>`).join('');
  const sessionOf = id => observing() ? lastOffice.sessions.find(s => s.id === id) : null;

  /* ---------- chips in the session card ---------- */
  let chipKey = '';
  setInterval(() => {
    const box = q('#mQp'); if (!box) return;
    const id = typeof modalAgent !== 'undefined' ? modalAgent : null, s = id && sessionOf(id), ok = s && (!s.provider || s.provider === 'claude') && s.kind === 'main';
    const key = ok ? id + '|' + libVer : ''; if (key === chipKey) return; chipKey = key;
    box.innerHTML = ok ? chips(s.root, 'data-qp') + '<button class="qchip edit" data-qpm="1" title="Add, change or remove quick prompts">⚙ EDIT</button>' + (s.sleeping ? '<button class="qchip own" data-qpr="1" title="This session is not running. Reopen it in a terminal window (claude --resume)">▶ OPEN IN TERMINAL</button>' : '') : '';
  }, 400);
  document.addEventListener('click', e => {
    const c = e.target.closest('#mQp [data-qp]'), m = e.target.closest('#mQp [data-qpm]'), rs = e.target.closest('#mQp [data-qpr]');
    if (m) return open('manage');
    if (rs) { const id = modalAgent; rs.disabled = true; rs.textContent = 'Opening…'; post('/api/session/resume', { id }).then(r => { rs.textContent = '✔ opened in ' + r.terminal; if (typeof logLine === 'function') logLine('AUDIT', 'operator', 'reopened a sleeping session in a terminal'); }, err => { rs.textContent = '✖ ' + err.message; rs.disabled = false; }); return; }
    if (!c) return; const p = lib.find(x => x.id === c.dataset.qp), inp = q('#mChatIn'), btn = q('#mChatSend'); if (!p) return;
    if (e.altKey || inp.disabled) { if (!inp.disabled) { inp.value = p.text; inp.focus(); } return; }          // Alt-click: put it in the box to edit first
    inp.value = p.text; btn.click();
  });

  /* ---------- dialogs ---------- */
  function open(m, arg) {
    if (!served) { if (typeof logLine === 'function') logLine('WARN', 'system', 'This needs the bridge: run "node server.js" and open http://localhost:8787'); return; }
    mode = m; modal.classList.add('on'); modal.setAttribute('aria-hidden', 'false');
    body.innerHTML = '<p class="ln-note">Loading…</p>';
    Promise.all([loadLib(), loadProjects()]).then(() => { if (mode !== m) return; if (m === 'manage') { draft = lib.map(p => ({ ...p })); renderManage(); } else if (m === 'send') renderSend(); else renderStart(arg); });
  }
  function close() { modal.classList.remove('on'); modal.setAttribute('aria-hidden', 'true'); mode = ''; }
  q('#lnClose').addEventListener('click', close);
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && mode) close(); });
  modal.addEventListener('keydown', e => e.stopPropagation());                                                 // typing here must not trigger M / F shortcuts
  q('#qpBtn').addEventListener('click', () => open('send'));
  q('#nsBtn').addEventListener('click', () => open('start'));

  /* ---- send one prompt to several sessions ---- */
  function renderSend() {
    title.textContent = 'Quick prompt'; sub.textContent = 'Send one prompt to one or more Claude Code sessions.';
    const solo = typeof obsSolo !== 'undefined' ? obsSolo : null, list = observing() ? lastOffice.sessions.filter(s => (!s.provider || s.provider === 'claude') && s.kind === 'main') : [];
    const by = new Map(); for (const s of list) (by.get(s.root) || by.set(s.root, []).get(s.root)).push(s);
    const can = s => s.sleeping || s.status === 'idle' || inbox;
    body.innerHTML = `
      <div class="ln-chips" id="lnChips">${chips(solo, 'data-fill')}<button class="qchip edit" id="lnManage">⚙ EDIT PROMPTS</button></div>
      <textarea id="lnText" rows="4" placeholder="Pick a prompt above or write one…" aria-label="Prompt"></textarea>
      <h4>Send to <small><button class="ctl" id="lnIdle">ALL IDLE</button> <button class="ctl" id="lnNone">NONE</button></small></h4>
      <div class="ln-targets" id="lnTargets">${list.length ? [...by.entries()].map(([root, ss]) => `<div class="ln-proj"><b>${E(ss[0].project)}</b>${ss.map(s => `<label class="${can(s) ? '' : 'off'}"><input type="checkbox" value="${E(s.id)}" ${can(s) ? '' : 'disabled'} ${can(s) && solo === root ? 'checked' : ''}> ${E(s.name || s.id)} <small>${s.sleeping ? 'not running, will be resumed' : s.status === 'idle' ? 'idle' : (s.status === 'waiting' ? 'waiting on you' : 'working') + (inbox ? ', delivered at its next step' : '')}</small><span data-res="${E(s.id)}"></span></label>`).join('')}</div>`).join('') : '<p class="ln-note">No Claude Code sessions are in the office right now.</p>'}</div>
      <p class="ln-note">A session that is open in a terminal continues the same conversation in the background; its window may not show the new messages until you reopen it. ${inbox ? 'A busy session gets the message at its next step.' : 'Busy sessions cannot be messaged until you run <code>node install-hook.js --inbox</code>.'}</p>
      <div class="ln-foot"><span id="lnMsg"></span><button class="ctl big" id="lnSend">SEND</button></div>`;
    const count = () => { const n = body.querySelectorAll('#lnTargets input:checked').length; q('#lnSend').textContent = n ? `SEND TO ${n} SESSION${n > 1 ? 'S' : ''}` : 'SEND'; q('#lnSend').disabled = !n; };
    count(); body.onchange = count;
    body.onclick = async e => {
      const f = e.target.closest('[data-fill]');
      if (f) { const p = lib.find(x => x.id === f.dataset.fill); if (p) { q('#lnText').value = p.text; q('#lnText').focus(); } return; }
      if (e.target.id === 'lnManage') return open('manage');
      if (e.target.id === 'lnIdle' || e.target.id === 'lnNone') { body.querySelectorAll('#lnTargets input:not(:disabled)').forEach(i => i.checked = e.target.id === 'lnIdle'); return count(); }
      if (e.target.id !== 'lnSend') return;
      const text = q('#lnText').value.trim(), ids = [...body.querySelectorAll('#lnTargets input:checked')].map(i => i.value), msg = q('#lnMsg');
      if (!text) { msg.textContent = 'Write or pick a prompt first.'; return; }
      q('#lnSend').disabled = true; let ok = 0;
      for (const id of ids) {
        const res = body.querySelector(`[data-res="${CSS.escape(id)}"]`);
        try { const r = await post('/api/chat/send', { id, text, ack: true }); ok++; res.textContent = r.queued ? '⏳ queued' : '✔ sent'; res.className = 'ok'; const s = sessionOf(id); if (typeof logLine === 'function') logLine('AUDIT', 'operator', `quick prompt to ${s ? s.name : id}: ${text.slice(0, 80)}`); }
        catch (err) { res.textContent = '✖ ' + err.message; res.className = 'bad'; }
      }
      msg.textContent = `Sent to ${ok} of ${ids.length}. Replies appear in each session's card.`; q('#lnSend').disabled = false;
    };
  }

  /* ---- edit the library ---- */
  function renderManage() {
    title.textContent = 'Quick prompts'; sub.textContent = 'Saved on this computer only. They appear as buttons in every session card.';
    const opts = sc => `<option value="">All projects</option>${projects.map(p => `<option value="${E(p.root)}"${p.root === sc ? ' selected' : ''}>Only ${E(p.name)}</option>`).join('')}${sc && !projects.some(p => p.root === sc) ? `<option value="${E(sc)}" selected>Only ${E(sc.split(/[\\/]/).filter(Boolean).pop())} (closed)</option>` : ''}`;
    body.innerHTML = `<div class="ln-rows">${draft.map((p, i) => `<div class="ln-row" data-i="${i}"><input data-f="label" maxlength="28" value="${E(p.label)}" placeholder="Button label" aria-label="Label"><select data-f="scope" class="psel" aria-label="Where it shows">${opts(p.scope)}</select><button class="ctl" data-del="${i}" title="Remove">✕</button><textarea data-f="text" rows="2" maxlength="4000" placeholder="The prompt that is sent" aria-label="Prompt text">${E(p.text)}</textarea></div>`).join('') || '<p class="ln-note">No prompts yet.</p>'}</div>
      <div class="ln-foot"><button class="ctl" id="lnAdd">＋ ADD</button><button class="ctl" id="lnReset">RESET TO DEFAULTS</button><span id="lnMsg"></span><button class="ctl big" id="lnSave">SAVE</button></div>`;
    body.onchange = null;
    body.oninput = e => { const r = e.target.closest('[data-i]'); if (r && e.target.dataset.f) draft[+r.dataset.i][e.target.dataset.f] = e.target.value; };
    body.onclick = async e => {
      const d = e.target.closest('[data-del]');
      if (d) { draft.splice(+d.dataset.del, 1); return renderManage(); }
      if (e.target.id === 'lnAdd') { draft.push({ id: '', label: '', text: '', scope: (typeof obsSolo !== 'undefined' && obsSolo) || '' }); renderManage(); const ins = body.querySelectorAll('[data-f="label"]'); ins[ins.length - 1].focus(); return; }
      if (e.target.id === 'lnReset') { try { lib = (await post('/api/prompts', { reset: true })).prompts; libVer++; draft = lib.map(p => ({ ...p })); renderManage(); q('#lnMsg').textContent = 'Back to the defaults.'; } catch (err) { q('#lnMsg').textContent = err.message; } return; }
      if (e.target.id === 'lnSave') { try { lib = (await post('/api/prompts', { prompts: draft })).prompts; libVer++; draft = lib.map(p => ({ ...p })); renderManage(); q('#lnMsg').textContent = `Saved ${lib.length} prompt${lib.length === 1 ? '' : 's'}.`; } catch (err) { q('#lnMsg').textContent = err.message; } }
    };
  }

  /* ---- start a new session in a terminal ---- */
  function renderStart(preRoot) {
    title.textContent = 'New session'; sub.textContent = `Opens ${terminal} in the project folder and starts the tool there.`;
    const solo = preRoot || (typeof obsSolo !== 'undefined' ? obsSolo : null);
    if (!projects.length) { body.innerHTML = '<p class="ln-note">The office does not know any project yet. Start one session by hand in a project folder (run <code>claude</code> there) and it will be listed here from then on.</p>'; body.onclick = null; return; }
    body.innerHTML = `
      <div class="ln-grid"><label>Project<select id="lnProj" class="psel">${projects.map(p => `<option value="${E(p.root)}"${p.root === solo ? ' selected' : ''}>${E(p.name)}${p.live ? ` · ${p.live} open` : p.sessions ? ' · asleep' : ''}</option>`).join('')}</select></label>
      <label>Tool<select id="lnTool" class="psel">${tools.map(t => `<option value="${t.id}">${E(t.name)}</option>`).join('')}</select></label></div>
      <p class="ln-path" id="lnPath"></p>
      <h4>First prompt <small>optional</small></h4>
      <div class="ln-chips" id="lnChips"></div>
      <textarea id="lnText" rows="3" placeholder="Leave empty to just open the tool…" aria-label="First prompt"></textarea>
      <p class="ln-note" id="lnToolNote"></p>
      <div class="ln-foot"><span id="lnMsg"></span><button class="ctl big" id="lnStart">START SESSION</button></div>`;
    const sync = () => { const root = q('#lnProj').value, t = tools.find(x => x.id === q('#lnTool').value); q('#lnPath').textContent = root; q('#lnChips').innerHTML = chips(root, 'data-fill'); q('#lnText').disabled = !t.prompt; q('#lnToolNote').textContent = t.prompt ? 'The new session appears in the office a few seconds after it starts.' : `${t.name} is opened without a first prompt; type it in the terminal.`; };
    sync(); body.oninput = null; body.onchange = e => { if (e.target.id === 'lnProj' || e.target.id === 'lnTool') sync(); };
    body.onclick = async e => {
      const f = e.target.closest('[data-fill]');
      if (f) { const p = lib.find(x => x.id === f.dataset.fill); if (p && !q('#lnText').disabled) { q('#lnText').value = p.text; q('#lnText').focus(); } return; }
      if (e.target.id !== 'lnStart') return; const msg = q('#lnMsg'), root = q('#lnProj').value, tool = q('#lnTool').value;
      e.target.disabled = true; msg.textContent = 'Opening a terminal…';
      try {
        const r = await post('/api/session/start', { root, tool, prompt: q('#lnText').value });
        msg.textContent = `Opened in ${r.terminal}. It will walk into the office in a few seconds.`;
        if (typeof logLine === 'function') logLine('AUDIT', 'operator', `new ${tool} session started in ${projects.find(p => p.root === root).name}`);
        setTimeout(() => { if (mode === 'start') close(); }, 1800);
      } catch (err) { msg.textContent = err.message; }
      e.target.disabled = false;
    };
  }

  loadLib();
  window.POLAUNCH = { open, startIn: root => open('start', root) };
})();
