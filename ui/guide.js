/* =====================================================================
   PIXEL OFFICE — Guide tab: a live setup checklist, a guided tour and the manual.
   Everything a new user needs without leaving the app. The checklist reads /api/setup from the bridge.
   ===================================================================== */
(() => {
  'use strict';
  const q = s => document.querySelector(s), app = q('.app'), nav = q('#gNav'), main = q('#gMain');
  const E = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const served = location.protocol.startsWith('http');
  const cmd = c => `<div class="g-cmd"><code>${E(c)}</code><button data-copy="${E(c)}">COPY</button></div>`;
  const go = (tab, label) => `<button class="ctl" data-go="${tab}">${label}</button>`;

  const SECTIONS = [
    ['setup', 'Setup checklist', () => `<p>What is connected on this computer right now. Anything marked <span style="color:var(--amber)">!</span> is optional or needs one command.</p><ul class="g-check" id="gCheck"><li><span class="opt">…</span><div>Checking…</div><span></span></li></ul>`],
    ['start', 'Quick start', () => `
      <ol><li>Start the bridge in the project folder: ${cmd('node server.js')}</li>
      <li>Open <code>http://localhost:8787</code>. Your open AI coding sessions walk in by themselves. Nothing is launched and nothing is changed.</li>
      <li>Work as usual in Claude Code. Watch the office, answer approvals from the console on the right, and click a character to chat with that session.</li></ol>
      <p>${`<button class="ctl" id="gTour">▶ TAKE THE 1-MINUTE TOUR</button>`} &nbsp; It points at each part of the screen in turn.</p>
      <p>No sessions open? You still see a demo with sample data, so you can try every skin. To keep the office running without a terminal, see <b>Run in the background</b> below.</p>`],
    ['read', 'Reading the office', () => `
      <div class="g-grid">
        <div><b>Rooms are projects</b>Every folder you have a session in gets a room (a field on the Farm, a sector in Space). Four are shown at a time; the <b>1 · 2</b> buttons page through the rest.</div>
        <div><b>Desks are sessions</b>One character per session. Helpers spawned by a session (subagents) sit next to it, slightly smaller.</div>
        <div><b>Working</b>Typing at the desk, monitor lit. The room shows running lights around its edge.</div>
        <div><b>Needs you</b>Waving, with a <b>!</b>. The whole room pulses amber and shows a NEEDS YOU sign so you spot it from far away.</div>
        <div><b>Idle</b>Sitting back, waiting for your next prompt.</div>
        <div><b>Sleeping</b>Faded: the session was used in the last 24 hours but is not open now.</div>
      </div>
      <h4>Finding your way</h4>
      <ul><li><b>Project dropdown</b> (▦ All projects): open one project by itself, as if you walked into its room.</li>
      <li><b>⬡ MAP</b> (<kbd>M</kbd>): every project on one screen as hex sectors. Click one to open it, click HQ to see all.</li>
      <li><b>⛶ Focus</b> (<kbd>F</kbd>): hides the console and the log so the world fills the window.</li>
      <li><b>− FIT +</b>: zoom. Hover a character for details, click it for its full card.</li></ul>`],
    ['approve', 'Approving from the office', () => `
      <p>When Claude Code asks "Allow this tool?", the question can show up as a card in the <b>Decision Console</b>. Approve, deny, or "always allow" from there. The prompt in the terminal keeps working too: whichever you answer first wins.</p>
      <p>This is opt-in. Install the hook once:</p>${cmd('node install-hook.js')}
      <p>Remove it any time:</p>${cmd('node install-hook.js --uninstall')}
      <p>Safety: if no office page is open, or the bridge is not running, the hook steps aside at once and the terminal asks as usual. It can never approve anything by itself.</p>`],
    ['chat', 'Chatting with a session', () => `
      <p>Click a character, then use the chat box in its card. You see the latest messages of that session and can send a prompt without switching windows. The reply is added to the same conversation, using your Claude subscription through the <code>claude</code> command (no API key).</p>
      <p>If the session is also open in a terminal, you are asked to confirm first, because two writers in one conversation can be confusing. Sessions from other tools (Codex, Gemini, Grok) are read-only here.</p>`],
    ['brain', 'Second Brain', () => `
      <p>${go('brain', '◈ OPEN SECOND BRAIN')} &nbsp; Point it at any folder of markdown notes: an Obsidian vault, a docs folder, a graphify output. You get a file tree, search, rendered notes with working <code>[[wikilinks]]</code>, backlinks, and a link graph. If the folder has <code>graphify-out/graph.json</code>, a second graph tab appears.</p>
      <p>It only reads. The folder you pick is remembered in <code>~/.pixel-office/config.json</code> on this computer, never in the project.</p>`],
    ['repos', 'Repos', () => `
      <p>${go('repos', '⎇ OPEN REPOS')} &nbsp; Lists your GitHub and GitLab repositories with recent commits and open pull requests. A repo that matches a project in the office gets an <b>IN OFFICE</b> badge; click it to jump to that room.</p>
      <p>Pixel Office stores no tokens. It uses the command-line tool you are already signed in to:</p>${cmd('gh auth login')}${cmd('glab auth login')}`],
    ['skins', 'Skins, weather and levels', () => `
      <p>The skin dropdown changes how the same data is drawn: <b>Office</b>, <b>Farm</b> (each project is a field, work plants crops that grow in real time) or <b>Space</b> (a hex colony with domes and modules). Farm and Space have day, night and weather; set them to follow the real clock or pick one.</p>
      <p>Real work earns XP: tool calls, finished turns, tokens, approvals you answer, a daily streak, and harvests. The company, each project and each session level up separately. New levels unlock perks in every skin (a coffee machine, a windmill, an observatory…).</p>
      <p>Click <b>★ LV</b> to see progress, what the next level unlocks, and a slider that previews any level without changing your save.</p>`],
    ['insights', 'Insights', () => `
      <p>${go('insights', '◔ OPEN INSIGHTS')} &nbsp; Shows where the time went: how long sessions worked, how long they sat <b>waiting on you</b>, tokens, tool calls and approvals, by hour, by day and by project.</p>
      <p>It only counts while the bridge runs, so it is most useful when the bridge runs as a background service.</p>`],
    ['service', 'Run in the background', () => `
      <p>You do not need to keep a terminal open. Install Pixel Office as a small per-user service: it starts now, starts again at every login, and restarts if it crashes. No admin rights needed.</p>
      <h4>Install</h4>${cmd('node service.js install')}
      <p>Add desktop notifications for when a session needs you and no office tab is open (macOS and Linux):</p>${cmd('node service.js install --notify')}
      <p>Use another port:</p>${cmd('node service.js install --port 8790')}
      <h4>Check, restart, read the log</h4>${cmd('node service.js status')}${cmd('node service.js restart')}${cmd('node service.js logs')}
      <h4>Remove</h4>${cmd('node service.js uninstall')}
      <p>That stops the bridge and deletes the service file. Your data in <code>~/.pixel-office</code> is kept; delete that folder too if you want no trace.</p>
      <h4>What it creates</h4>
      <ul><li><b>macOS:</b> <code>~/Library/LaunchAgents/com.pixeloffice.bridge.plist</code> (launchd)</li>
      <li><b>Linux:</b> <code>~/.config/systemd/user/pixel-office.service</code>. To keep it running after you log out: <code>loginctl enable-linger "$USER"</code></li>
      <li><b>Windows:</b> a <code>PixelOffice</code> task that runs at logon, started hidden (not tested as widely as the other two)</li>
      <li><b>Log:</b> <code>~/.pixel-office/logs/bridge.log</code>, emptied automatically when it passes 2 MB</li></ul>
      <h4>Make it feel like an app</h4>
      <ul><li><b>Chrome / Edge:</b> menu → Cast, save and share → <i>Install page as app</i>. You get a window without browser bars and an icon in the Dock or taskbar.</li>
      <li><b>Safari:</b> File → <i>Add to Dock</i>.</li></ul>
      <p>After moving or renaming the project folder, or updating Node, run <code>node service.js install</code> again so the service points at the right place.</p>`],
    ['others', 'Other AI tools', () => `
      <p>Besides Claude Code, the office reads sessions from <b>Codex</b> (<code>~/.codex</code>), <b>Gemini CLI</b> (<code>~/.gemini</code>), <b>Grok Build</b> (<code>~/.grok</code>) and the <b>Grok Bot</b> desktop app, if they are installed. They appear in the same rooms with a small prefix (CX, GM, GK). These are read-only: you can see status and recent messages, but approvals and chat work with Claude Code only.</p>`],
    ['privacy', 'Privacy and safety', () => `
      <ul><li>The bridge listens on <code>127.0.0.1</code> only. Other devices on your network cannot reach it.</li>
      <li>It reads the session files your AI tools already write on this computer. It sends them nowhere. The only outside calls are to GitHub or GitLab, and only when you open the Repos tab.</li>
      <li>Secrets that appear in transcripts (API keys, tokens, passwords in URLs) are masked before they reach the page.</li>
      <li>Your settings, progress and statistics live in <code>~/.pixel-office</code>, outside the project folder, so they can never be committed by accident.</li>
      <li>Nothing can be approved without you clicking a button.</li></ul>`],
    ['keys', 'Shortcuts', () => `
      <ul><li><kbd>M</kbd> colony map &nbsp; <kbd>F</kbd> focus mode &nbsp; <kbd>Esc</kbd> close a card or the map</li>
      <li><kbd>/</kbd> jump to the command line (spawn mode)</li>
      <li><code>?preview=10</code> at the end of the address shows the world at level 10</li>
      <li><code>?mode=spawn</code> turns on the original mode where the office starts its own agents</li></ul>`],
    ['trouble', 'Troubleshooting', () => `
      <div class="g-grid">
        <div><b>"DEMO · SIMULATED" stays on</b>You opened the file directly. Open <code>http://localhost:8787</code> instead, with the bridge running.</div>
        <div><b>The office is empty</b>No AI session is open, and none was used in the last 24 hours. Start <code>claude</code> in any project.</div>
        <div><b>No approval cards</b>The hook is not installed (see the checklist), or the session started before you installed it. Restart that session.</div>
        <div><b>"Port 8787 is already in use"</b>It is already running, probably as the background service. Just open the page, or run <code>node service.js stop</code>.</div>
        <div><b>Chat says not logged in</b>Run <code>claude</code> once in a terminal and sign in. The service uses the same login.</div>
        <div><b>Service cannot find claude or gh</b>Run <code>node service.js install</code> again from a terminal where those commands work; it remembers that PATH.</div>
      </div>`],
    ['remove', 'Removing everything', () => `
      <ol><li>Remove the background service: ${cmd('node service.js uninstall')}</li>
      <li>Remove the approvals hook: ${cmd('node install-hook.js --uninstall')}</li>
      <li>Delete your local data (vault choice, progress, statistics, logs): ${cmd('rm -rf ~/.pixel-office')}</li>
      <li>Delete the project folder.</li></ol>
      <p>After that nothing of Pixel Office is left on the computer. Your AI tools and their sessions are untouched.</p>`]
  ];

  /* ---------- live checklist ---------- */
  function row(state, title, detail, action) { const m = { ok: ['ok', '✔'], no: ['no', '!'], opt: ['opt', '○'] }[state]; return `<li><span class="${m[0]}">${m[1]}</span><div><b>${title}</b><small>${detail}</small></div><span>${action || ''}</span></li>`; }
  async function checklist() {
    const el = q('#gCheck'); if (!el) return;
    if (!served) { el.innerHTML = row('no', 'The bridge is not running', 'You opened the file directly, so this is the demo. Run <code>node server.js</code> and open <code>http://localhost:8787</code>.'); return; }
    let s; try { const r = await fetch('/api/setup'); if (!r.ok) throw 0; s = await r.json(); } catch { el.innerHTML = row('no', 'Could not reach the bridge', 'Is <code>node server.js</code> still running?'); return; }
    const names = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', grok: 'Grok Build', grokbot: 'Grok Bot' }, prov = Object.entries(s.providers).map(([k, n]) => `${n} ${names[k] || k}`).join(', ');
    const up = s.uptime < 3600 ? Math.round(s.uptime / 60) + ' min' : Math.round(s.uptime / 3600) + ' h';
    el.innerHTML = [
      row('ok', `Bridge running · v${E(s.version)}`, `Port ${s.port}, up ${up}, Node ${E(s.node)}, ${s.service.managed ? 'as a background service' : 'from a terminal'}.`),
      s.loggedIn === true ? row('ok', 'Claude Code is signed in', 'Chat and spawn mode use your subscription.') : row('no', 'Claude Code is not signed in', 'Watching sessions still works. To chat from the office, run <code>claude</code> in a terminal and sign in.'),
      s.sessions ? row('ok', `${s.sessions} session${s.sessions > 1 ? 's' : ''} found`, E(prov) + '.', go('office', 'SEE THEM')) : row('opt', 'No sessions right now', 'Start <code>claude</code> (or Codex, Gemini, Grok) in any project and it walks in.'),
      s.hookInstalled ? row('ok', 'Approvals from the office are on', 'Permission prompts appear in the Decision Console. The terminal prompt still works.') : row('no', 'Approvals from the office are off', 'Optional. Run <code>node install-hook.js</code>, then restart your sessions.'),
      s.service.installed ? row('ok', 'Background service installed', s.service.managed ? 'It starts at login and needs no terminal.' : 'Installed, but this bridge was started by hand.') : row('opt', 'Not running as a background service', 'Optional. <code>node service.js install</code> keeps it running without a terminal.', `<button class="ctl" data-sec="service">HOW</button>`),
      s.service.notify ? row('ok', 'Desktop notifications from the service are on', 'You are told when a session needs you and no office tab is open.') : row('opt', 'Notifications', 'Use the 🔔 button above for browser notifications, or install the service with <code>--notify</code>.'),
      s.brain ? row('ok', 'Second Brain is connected', 'A notes folder is set.', go('brain', 'OPEN')) : row('opt', 'Second Brain is not set', 'Optional. Pick a folder of markdown notes.', go('brain', 'SET UP')),
      s.github || s.gitlab ? row('ok', `Repos: ${[s.github && 'GitHub', s.gitlab && 'GitLab'].filter(Boolean).join(' and ')} connected`, 'Through the command-line tool you are signed in to.', go('repos', 'OPEN')) : row('opt', 'Repos are not connected', 'Optional. Sign in with <code>gh auth login</code> or <code>glab auth login</code>.')
    ].join('');
  }

  /* ---------- guided tour ---------- */
  const TOUR = [
    ['#mtabs', 'Tabs', 'Office is the live view. Second Brain shows your notes, Repos your GitHub and GitLab, Insights where the time went, and Guide is this manual.'],
    ['#stageWrap', 'The world', 'Each room is a project and each character is a session. Hover one for details, click it for its card and chat.'],
    ['#projSel', 'One project at a time', 'Pick a project here to open only its room.'],
    ['#skinSel', 'Skins', 'Office, Farm or Space. Same data, different world. Farm and Space also have weather and day and night.'],
    ['#mapBtn', 'Colony map and focus', 'MAP shows every project on one screen. The button next to it hides the side panels so the world fills the window.'],
    ['.console', 'Decision Console', 'Questions from your sessions land here: approve, deny or always allow, without going back to the terminal.'],
    ['.logp', 'Activity log', 'A running log of what every session is doing.'],
    ['#lvBtn', 'Levels and perks', 'Real work earns XP. Click here to see progress, the next perks, and to preview any level.'],
    ['#ntfBtn', 'Notifications', 'Turn this on to be told when a session needs you while you are in another window.']
  ];
  let tourI = -1, ring = null, card = null;
  function endTour() { tourI = -1; if (ring) ring.remove(); if (card) card.remove(); ring = card = null; removeEventListener('resize', placeTour); }
  function placeTour() {
    const [sel, title, text] = TOUR[tourI], el = q(sel); if (!el || !el.getClientRects().length) return stepTour(1);
    const r = el.getBoundingClientRect(), pad = 4; Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    card.innerHTML = `<b>${tourI + 1}. ${title.toUpperCase()}</b>${text}<div><small>${tourI + 1} / ${TOUR.length}</small><button class="ctl" data-t="end">SKIP</button>${tourI ? '<button class="ctl" data-t="-1">BACK</button>' : ''}<button class="ctl" data-t="1">${tourI === TOUR.length - 1 ? 'DONE' : 'NEXT'}</button></div>`;
    const cw = card.offsetWidth, chh = card.offsetHeight, below = r.bottom + chh + 16 < innerHeight, above = r.top - chh - 16 > 0;
    card.style.left = Math.max(10, Math.min(innerWidth - cw - 10, r.left + r.width / 2 - cw / 2)) + 'px';
    card.style.top = (below ? r.bottom + 12 : above ? r.top - chh - 12 : Math.max(10, innerHeight - chh - 20)) + 'px';
  }
  function stepTour(d) { tourI += d; if (tourI < 0) tourI = 0; if (tourI >= TOUR.length) return endTour(); placeTour(); }
  function startTour() {
    q('#mtabs [data-mt="office"]').click(); if (window.POWORLD) { POWORLD.setMap(false); POWORLD.setFocus(false); }
    ring = document.createElement('div'); ring.className = 'g-ring'; card = document.createElement('div'); card.className = 'g-tour'; document.body.append(ring, card);
    card.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; b.dataset.t === 'end' ? endTour() : stepTour(+b.dataset.t); });
    addEventListener('resize', placeTour); tourI = -1; setTimeout(() => stepTour(1), 60);
  }
  addEventListener('keydown', e => { if (tourI >= 0) { if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowRight' || e.key === 'Enter') stepTour(1); else if (e.key === 'ArrowLeft') stepTour(-1); } });

  /* ---------- page ---------- */
  let built = false;
  function build() {
    built = true;
    nav.innerHTML = SECTIONS.map(([id, t], i) => `<button data-sec="${id}"${i ? '' : ' class="on"'}>${t}</button>`).join('');
    main.innerHTML = SECTIONS.map(([id, t, body]) => `<section id="g-${id}"><h2>${t.toUpperCase()}</h2>${body()}</section>`).join('');
    main.addEventListener('scroll', () => { let cur = SECTIONS[0][0]; for (const [id] of SECTIONS) { const s = q('#g-' + id); if (s.offsetTop - main.scrollTop < 80) cur = id; } nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.sec === cur)); });
  }
  q('#guide').addEventListener('click', e => {
    const sec = e.target.closest('[data-sec]'), copy = e.target.closest('[data-copy]'), to = e.target.closest('[data-go]');
    if (sec) q('#g-' + sec.dataset.sec).scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (copy) { const done = () => { copy.textContent = 'COPIED'; setTimeout(() => copy.textContent = 'COPY', 1200); }; navigator.clipboard ? navigator.clipboard.writeText(copy.dataset.copy).then(done, () => { copy.textContent = 'SELECT IT'; }) : (copy.textContent = 'SELECT IT'); }
    else if (to) q(`#mtabs [data-mt="${to.dataset.go}"]`).click();
    else if (e.target.id === 'gTour') startTour();
  });
  q('#mtabs').addEventListener('click', e => {
    const b = e.target.closest('[data-mt]'); if (!b) return; const on = b.dataset.mt === 'guide';
    app.classList.toggle('on-guide', on); if (!on) return;
    if (!built) build(); checklist(); try { localStorage.setItem('po.guide', '1'); } catch { /* private mode */ } q('#mtabs [data-mt="guide"]').classList.remove('new');
  });
  /* first visit: a gentle nudge on the tab */
  try { if (!localStorage.getItem('po.guide')) q('#mtabs [data-mt="guide"]').classList.add('new'); } catch { /* private mode */ }
  window.POGUIDE = { startTour };
})();
