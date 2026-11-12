/* =====================================================================
   PIXEL OFFICE — Repos tab: your GitHub / GitLab repositories, cross-linked with the projects open in the office.
   The server talks to the `gh` / `glab` CLIs you are already logged into; this page never sees a token.
   ===================================================================== */
(() => {
  'use strict';
  const q = s => document.querySelector(s);
  const E = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const get = async u => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; } return j; };
  const ago = iso => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); if (!iso || isNaN(s)) return ''; return s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : s < 86400 * 60 ? Math.round(s / 86400) + 'd ago' : Math.round(s / 2592000) + 'mo ago'; };
  const LANG = { JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5', HTML: '#e34c26', CSS: '#563d7c', Go: '#00add8', Rust: '#dea584', Java: '#b07219', Swift: '#f05138', Kotlin: '#a97bff', Dart: '#00b4ab', Shell: '#89e051', 'C#': '#178600', PHP: '#4f5d95', Ruby: '#701516' };
  let prov = 'github', owner = '', data = null, st = null, open = new Set(), served = location.protocol.startsWith('http'), loaded = false;

  async function load(force) {
    const body = q('#rBody');
    if (!served) { body.innerHTML = '<div class="r-empty">The Repos tab needs the bridge.<br>Start <code>node server.js</code> and open <code>http://localhost:8787</code>.</div>'; return; }
    body.innerHTML = '<div class="r-empty">Loading…</div>';
    try { if (!st || force) st = await get('/api/repos/status'); } catch (e) { body.innerHTML = `<div class="r-empty">Could not reach the bridge: ${E(e.message)}</div>`; return; }
    const s = st[prov]; q('#rUser').textContent = s.connected ? `● ${s.user} (via ${s.via})` : '';
    if (!s.connected) { body.innerHTML = `<div class="r-empty"><b>${prov === 'github' ? 'GitHub' : 'GitLab'} is not connected.</b><br>${E(s.hint)}<br><br>Pixel Office stores no tokens: it uses the CLI you are logged into (or an environment variable).${prov === 'gitlab' ? `<br>GitLab host: <code>${E(st.gitlabHost)}</code>` : ''}</div>`; q('#rOwner').hidden = true; return; }
    try { data = await get(`/api/repos/list?provider=${prov}&owner=${encodeURIComponent(owner)}`); } catch (e) { body.innerHTML = `<div class="r-empty">${E(e.message)}</div>`; return; }
    const ow = q('#rOwner'); if (data.owners && data.owners.length > 1) { ow.hidden = false; ow.innerHTML = data.owners.map(o => `<option value="${E(o)}"${o === (owner || data.user) ? ' selected' : ''}>${E(o)}</option>`).join(''); } else ow.hidden = true;
    render();
  }

  function render() {
    if (!data) return; const body = q('#rBody'), f = q('#rSearch').value.trim().toLowerCase(), sort = q('#rSort').value, forks = q('#rForks').checked, arch = q('#rArch').checked, onlyOffice = q('#rOffice').checked;
    let list = data.repos.filter(r => (forks || !r.fork) && (arch || !r.archived) && (!onlyOffice || r.local.length) && (!f || (r.fullName + ' ' + r.description + ' ' + r.language).toLowerCase().includes(f)));
    list.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'stars' ? b.stars - a.stars : Date.parse(b.pushedAt) - Date.parse(a.pushedAt));
    body.innerHTML = list.length ? list.map(r => `<div class="r-card" data-r="${E(r.fullName)}">
      <div class="r-top"><b><a href="${E(r.url)}" target="_blank" rel="noopener noreferrer">${E(r.fullName)}</a></b>${r.private ? '<span class="r-badge priv">PRIVATE</span>' : ''}${r.fork ? '<span class="r-badge">FORK</span>' : ''}${r.archived ? '<span class="r-badge">ARCHIVED</span>' : ''}${r.local.map(l => `<span class="r-badge off" data-root="${E(l.root)}" title="Open ${E(l.project)} in the office">IN OFFICE · ${E(l.project)}</span>`).join('')}${r.local.length ? `<span class="r-badge off" data-start="${E(r.local[0].root)}" title="Open a terminal in ${E(r.local[0].project)} and start a new session">＋ SESSION</span>` : ''}</div>
      ${r.description ? `<div class="r-desc">${E(r.description)}</div>` : ''}
      <div class="r-meta">${r.language ? `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${LANG[r.language] || '#8a86b8'};margin-right:4px"></i>${E(r.language)}</span>` : ''}<span>★ ${r.stars}</span>${r.defaultBranch ? `<span>⎇ ${E(r.defaultBranch)}</span>` : ''}<span>pushed ${ago(r.pushedAt)}</span><span class="sp"></span><button data-det="${E(r.fullName)}">${open.has(r.fullName) ? '▾ hide details' : '▸ commits & PRs'}</button></div>
      <div class="r-det-slot" data-slot="${E(r.fullName)}"></div></div>`).join('') : '<div class="r-empty">No repositories match.</div>';
    open.forEach(n => fillDetail(n));
  }
  async function fillDetail(name) {
    const slot = q(`[data-slot="${CSS.escape(name)}"]`); if (!slot) return; slot.innerHTML = '<div class="r-det"><div>Loading…</div></div>';
    try { const d = await get(`/api/repos/detail?provider=${prov}&repo=${encodeURIComponent(name)}`);
      slot.innerHTML = `<div class="r-det"><div><h5>RECENT COMMITS</h5>${d.commits.map(c => `<div><code>${E(c.sha)}</code> ${E(c.message)} <span style="color:var(--dim)">· ${E(c.author)} ${ago(c.at)}</span></div>`).join('') || '<div style="color:var(--dim)">none</div>'}</div>
        <div><h5>OPEN ${prov === 'gitlab' ? 'MERGE REQUESTS' : 'PULL REQUESTS'}</h5>${d.prs.map(p => `<div>#${p.number} <a href="${E(p.url)}" target="_blank" rel="noopener noreferrer" style="color:#8fd0ff">${E(p.title)}</a> <span style="color:var(--dim)">· ${E(p.author || '')} ${ago(p.at)}</span></div>`).join('') || '<div style="color:var(--dim)">none open</div>'}</div></div>`;
    } catch (e) { slot.innerHTML = `<div class="r-det"><div style="color:#ff9aa5">${E(e.message)}</div></div>`; }
  }

  q('#rBody').addEventListener('click', e => {
    const ns = e.target.closest('[data-start]'); if (ns) { if (window.POLAUNCH) POLAUNCH.startIn(ns.dataset.start); return; }
    const d = e.target.closest('[data-det]'), o = e.target.closest('[data-root]');
    if (d) { const n = d.dataset.det; if (open.has(n)) open.delete(n); else open.add(n); render(); }
    if (o) {                                              // jump to that project's room in the office
      document.querySelector('[data-mt=office]').click();
      setTimeout(() => { if (typeof obsSetSolo === 'function' && typeof OBS !== 'undefined' && OBS) { obsSetSolo(o.dataset.root); const sel = document.getElementById('projSel'); if (sel) sel.value = o.dataset.root; } }, 80);
    }
  });
  q('#rProv').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; prov = b.dataset.p; owner = ''; document.querySelectorAll('#rProv button').forEach(x => x.classList.toggle('on', x === b)); load(); });
  q('#rOwner').addEventListener('change', e => { owner = e.target.value; load(); });
  for (const id of ['#rSearch', '#rSort', '#rForks', '#rArch', '#rOffice']) q(id).addEventListener(id === '#rSearch' ? 'input' : 'change', render);
  q('#rReload').addEventListener('click', () => load(true));
  q('#mtabs').addEventListener('click', e => { const b = e.target.closest('[data-mt]'); if (!b) return; document.querySelector('.app').classList.toggle('on-repos', b.dataset.mt === 'repos'); if (b.dataset.mt === 'repos' && !loaded) { loaded = true; load(); } });
})();
