#!/usr/bin/env node
'use strict';
/* =====================================================================
   PIXEL OFFICE — bridge server (zero dependencies)

   Browser (index.html) <──SSE/REST──> this server <──spawns──> `claude -p`

   • Each desk is a headless Claude Code run (`claude -p … --output-format stream-json`)
     that uses YOUR existing Claude Code login (your subscription). No API key.
   • Every task starts in *plan mode*. The finished plan becomes an approval card.
       Approve  → resume the same session with edit permissions and execute
       Revise   → resume in plan mode with your note
       Reject   → stand the agent down
   • If an execution run is blocked on a tool (e.g. Bash), you get an "Allow …" card;
     approving resumes the session with exactly that tool allowed.
   • Binds to 127.0.0.1 only and rejects foreign Host/Origin headers.
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { createObserver, mask } = require('./observer');
const brain = require('./brain');
const { Rpg } = require('./rpg');
const repos = require('./repos');
const rpg = new Rpg();

const PORT = Number(process.env.PORT) || 8787;
const HOST = '127.0.0.1';
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const ROOT = __dirname;
const WORKSPACE = path.join(ROOT, 'workspace');
const TOKEN_BUDGET = Number(process.env.TOKEN_BUDGET) || 50e6;

const agents = new Map();      // id -> agent runtime
const decisions = new Map();   // id -> decision
const clients = new Set();     // SSE responses
const observer = createObserver({ ignore: [path.join(__dirname, 'workspace')] });
let office = { sessions: [], subs: [], tokens: 0, perms: [] }, officeKey = '';
let seq = 0, ticket = 200;

/* ---------- helpers ---------- */
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const emit = ev => { const s = `data: ${JSON.stringify(ev)}\n\n`; for (const r of clients) r.write(s); };
const say = (ag, level, msg) => emit({ type: 'log', agent: ag.id, level, msg: clip(oneLine(msg), 300) });
const setState = (ag, state, subtask) => {
  ag.state = state; if (subtask != null) ag.subtask = subtask;
  emit({ type: 'agent', agent: ag.id, state, subtask: ag.subtask, task: ag.task, ticket: ag.ticket });
};

let authCache = { at: 0, loggedIn: null };
function checkAuth() {
  return new Promise(resolve => {
    if (Date.now() - authCache.at < 15000) return resolve(authCache.loggedIn);
    execFile(CLAUDE, ['auth', 'status'], { timeout: 8000 }, (err, out) => {
      let ok = null;
      try { ok = !!JSON.parse(out).loggedIn; } catch { ok = err ? null : false; }
      authCache = { at: Date.now(), loggedIn: ok }; resolve(ok);
    });
  });
}

function sysPrompt(ag) {
  return `You are ${ag.name} (${ag.role}) in the "${ag.div}" division of a small AI-run company called Pixel Office. ` +
    `You work only inside the current directory. Be concise and concrete. When asked for a plan, give a short numbered plan ` +
    `(what you will do, which files you will touch) and nothing else: no preamble, and do not mention plan mode, plan files or approvals. A human operator approves your plans.`;
}

function toolPattern(d) {
  const i = d.tool_input || {};
  if (d.tool_name === 'Bash' && i.command) return `Bash(${i.command})`;
  if (d.tool_name === 'WebFetch' && i.url) { try { return `WebFetch(domain:${new URL(i.url).hostname})`; } catch { /* fall through */ } }
  return d.tool_name;
}
const toolDetail = d => { const i = d.tool_input || {}; return i.command || i.url || i.file_path || i.query || JSON.stringify(i); };

/* ---------- decisions ---------- */
function makeDecision(ag, kind, title, full, extra = {}) {
  const d = { id: 'D' + (++seq), agent: ag.id, div: ag.div, kind, title: clip(oneLine(title), 90), detail: clip(oneLine(full), 300),
    full: String(full).slice(0, 8000), prio: kind === 'tool' ? 1 : 2, blocks: 1, ticket: ag.ticket, created: Date.now(), ...extra };
  decisions.set(d.id, d); ag.decision = d.id;
  setState(ag, 'waiting', 'Waiting for approval: ' + d.title);
  emit({ type: 'decision', decision: d });
  say(ag, 'WARN', `needs approval: ${d.title}`);
}

function decide(id, action, note) {
  const d = decisions.get(id); if (!d) return { status: 404, error: 'unknown decision' };
  const ag = agents.get(d.agent);
  decisions.delete(id); ag.decision = null; emit({ type: 'decision_done', id, action });
  note = clip(oneLine(note), 600);
  if (action === 'reject') {
    say(ag, 'ERR', 'request rejected — task cancelled'); ag.session = null;
    setState(ag, 'idle', 'Stood down — request rejected'); return { ok: true };
  }
  if (action === 'approve') {
    say(ag, 'OK', 'approval received — executing');
    if (d.kind === 'plan') run(ag, 'The plan is approved. Execute it now. When finished, summarise what you did in a few lines.', 'acceptEdits', 'Executing approved plan');
    else { d.tools.forEach(t => ag.allowed.add(t)); run(ag, `Permission granted for: ${d.tools.join(', ')}. Continue the task.`, 'acceptEdits', 'Continuing with approved permission'); }
    return { ok: true };
  }
  if (action === 'revise') {
    say(ag, 'INFO', `revision requested — ${note || 'no note'}`);
    if (d.kind === 'plan') run(ag, `Revise the plan. Operator feedback: ${note || 'please improve it'}`, 'plan', 'Revising plan');
    else run(ag, `I did not grant that permission. ${note || 'Find another way to do it.'}`, 'acceptEdits', 'Finding another way');
    return { ok: true };
  }
  return { status: 400, error: 'bad action' };
}

/* ---------- running Claude Code ---------- */
function run(ag, prompt, mode, subtask) {
  fs.mkdirSync(ag.cwd, { recursive: true });
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode, '--model', ag.model,
    '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'project',
    '--tools', 'Read,Glob,Grep,Write,Edit,Bash,WebFetch,WebSearch', '--append-system-prompt', sysPrompt(ag)];
  // (--tools / --setting-sources keep each run small: ~5k tokens instead of ~40k with every user plugin loaded)
  if (ag.session) args.push('--resume', ag.session);
  if (ag.allowed.size) args.push('--allowedTools', ...ag.allowed);
  // Subscription only: never hand an API key to the child, or it would bill the API instead.
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  const proc = spawn(CLAUDE, args, { cwd: ag.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  ag.proc = proc; ag.mode = mode;
  setState(ag, 'working', subtask);
  say(ag, 'INFO', `${mode === 'plan' ? 'planning' : 'running'}: ${clip(oneLine(prompt), 120)}`);

  let buf = '', errBuf = '', gotResult = false;
  proc.stdin.on('error', () => {}); proc.stdin.end(prompt);
  proc.stderr.on('data', c => { errBuf = (errBuf + c).slice(-800); });
  proc.stdout.on('data', c => {
    buf += c; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.session_id) ag.session = o.session_id;
      if (o.type === 'assistant') onAssistant(ag, o);
      else if (o.type === 'result') { gotResult = true; onResult(ag, o, mode); }
    }
  });
  proc.on('error', e => { gotResult = true; fail(ag, e.code === 'ENOENT' ? `cannot find "${CLAUDE}" — is Claude Code installed?` : e.message); });
  proc.on('close', code => {
    if (ag.proc !== proc) return; ag.proc = null;
    if (!gotResult) fail(ag, `claude exited (${code}) ${oneLine(errBuf)}`);
  });
}

function fail(ag, msg) {
  say(ag, 'ERR', msg);
  if (/authenticat|log ?in|oauth/i.test(msg)) { authCache.at = 0; say(ag, 'WARN', 'Claude Code is not logged in — run `claude auth login` in a terminal, then retry.'); }
  setState(ag, 'idle', 'Stopped — see log');
}

function onAssistant(ag, o) {
  for (const b of (o.message && o.message.content) || []) {
    if (b.type === 'text' && b.text.trim()) say(ag, 'INFO', b.text);
    else if (b.type === 'tool_use') {
      const i = b.input || {}, what = i.command || i.file_path || i.path || i.pattern || i.url || i.query || '';
      say(ag, 'TASK', `${b.name}${what ? ': ' + what : ''}`);
      setState(ag, 'working', `${b.name}${what ? ': ' + clip(oneLine(what), 70) : ''}`);
    }
  }
}

function onResult(ag, o, mode) {
  const u = o.usage || {};
  const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
  emit({ type: 'usage', agent: ag.id, tokens, cost: o.total_cost_usd || 0 });
  if (o.is_error) return fail(ag, o.result || 'run failed');
  const denials = o.permission_denials || [];
  const exit = denials.find(d => d.tool_name === 'ExitPlanMode');
  const blocked = denials.filter(d => d.tool_name !== 'ExitPlanMode');
  if (mode === 'plan') {
    const plan = (exit && exit.tool_input && exit.tool_input.plan) || o.result || '(the agent returned no plan text)';
    return makeDecision(ag, 'plan', 'Plan: ' + ag.task, plan);
  }
  if (blocked.length) {
    const tools = [...new Set(blocked.map(toolPattern))];
    return makeDecision(ag, 'tool', 'Allow ' + tools.map(t => clip(t, 50)).join(', '), blocked.map(toolDetail).join('\n'), { tools });
  }
  say(ag, 'OK', 'task complete: ' + clip(oneLine(o.result), 200));
  emit({ type: 'done', agent: ag.id, result: clip(String(o.result || ''), 2000) });
  ag.session = null;
  setState(ag, 'idle', 'Task complete — standing by');
}

function startTask(body) {
  const id = String(body.agent || '');
  if (!/^[a-z0-9_-]{1,24}$/.test(id)) return { status: 400, error: 'bad agent id' };
  const prompt = String(body.prompt || '').trim().slice(0, 4000);
  if (!prompt) return { status: 400, error: 'empty task' };
  let ag = agents.get(id);
  if (!ag) agents.set(id, ag = { id, state: 'idle', subtask: '', session: null, proc: null, decision: null, allowed: new Set() });
  if (ag.state !== 'idle') return { status: 409, error: `${ag.name || id} is busy (${ag.state})` };
  const m = String(body.model || '').toLowerCase().split(/\s+/)[0];
  Object.assign(ag, {
    name: clip(oneLine(body.name || id), 40), role: clip(oneLine(body.role || ''), 100), div: clip(oneLine(body.div || ''), 20),
    model: ['opus', 'sonnet', 'haiku'].includes(m) ? m : 'sonnet', cwd: path.join(WORKSPACE, id),
    session: null, allowed: new Set(), task: clip(oneLine(prompt), 80), ticket: ++ticket
  });
  emit({ type: 'log', agent: id, level: 'TASK', msg: `task #${ag.ticket} assigned: ${ag.task}` });
  run(ag, prompt, body.auto ? 'acceptEdits' : 'plan', body.auto ? 'Working' : 'Planning');
  return { ok: true, ticket: ag.ticket };
}

function cancel(id) {
  const ag = agents.get(id); if (!ag) return { status: 404, error: 'unknown agent' };
  if (ag.proc) { const p = ag.proc; ag.proc = null; p.kill('SIGTERM'); }
  if (ag.decision) { decisions.delete(ag.decision); emit({ type: 'decision_done', id: ag.decision, action: 'cancel' }); ag.decision = null; }
  ag.session = null; say(ag, 'WARN', 'cancelled by operator'); setState(ag, 'idle', 'Cancelled'); return { ok: true };
}

/* ---------- permission requests from the hook (answer approvals from the office) ---------- */
const perms = new Map(); let permSeq = 0;
const PERM_TTL = 3600e3;
const permView = p => ({ id: p.id, sessionId: p.sessionId, agentId: p.agentId, tool: p.tool, summary: p.summary, full: p.full, created: p.created, suggestions: p.suggestions.length });
const permsList = () => [...perms.values()].filter(p => p.status === 'pending').map(permView);
const summarize = (tool, i) => mask(clip(oneLine(i.command || i.file_path || i.path || i.url || i.query || i.pattern || i.description || JSON.stringify(i)), 160));
let permDirty = false;

function registerPerm(b) {
  if (!clients.size) return { ok: false, reason: 'no office page open' };            // fail-safe: terminal decides
  const i = (b.tool_input && typeof b.tool_input === 'object') ? b.tool_input : {};
  const p = { id: 'p' + (++permSeq) + '-' + Date.now().toString(36), sessionId: String(b.session_id || ''), agentId: b.agent_id ? String(b.agent_id) : '', tool: clip(String(b.tool_name), 60),
    summary: summarize(String(b.tool_name), i), full: mask(JSON.stringify(i, null, 2).slice(0, 4000)), created: Date.now(),
    suggestions: Array.isArray(b.permission_suggestions) ? b.permission_suggestions.slice(0, 10) : [], status: 'pending', waiters: new Set(), dropAt: 0 };
  perms.set(p.id, p); permDirty = true; return { ok: true, id: p.id };
}
function decideResult(p) { return { status: 'decided', ...p.result }; }
function waitPerm(id, req, res) {
  const p = perms.get(id);
  if (!p) return send(res, 200, { status: 'gone' });
  if (p.status === 'decided') return send(res, 200, decideResult(p));
  p.dropAt = 0;
  const w = { res, timer: setTimeout(() => { p.waiters.delete(w); send(res, 200, { status: 'pending' }); }, 25000) };
  p.waiters.add(w);
  req.on('close', () => { clearTimeout(w.timer); if (p.waiters.delete(w) && !p.waiters.size && p.status === 'pending') p.dropAt = Date.now() + 4000; });   // hook died (answered in terminal) → drop soon
}
function decidePerm(b) {
  const p = perms.get(String(b.id)); if (!p || p.status !== 'pending') return { status: 404, error: 'unknown or already answered' };
  const behavior = b.behavior === 'deny' ? 'deny' : 'allow';
  const sug = Number.isInteger(b.suggestion) ? p.suggestions[b.suggestion] : undefined;
  p.result = { behavior, ...(behavior === 'allow' && sug ? { updatedPermissions: [sug] } : {}), ...(behavior === 'deny' && b.message ? { message: clip(oneLine(b.message), 500) } : {}) };
  p.status = 'decided'; permDirty = true;
  { const sess = (office.sessions || []).find(x => x.sessionId === p.sessionId); const evs = rpg.approval(sess && sess.root); emit({ type: 'rpg', state: rpg.publicState() }); evs.forEach(e => emit({ type: 'rpg_event', ...e })); }
  if (p.chat) {
    const { id, tools, m } = p.chat, c = chats.get(id);
    if (behavior === 'allow' && c && !c.proc) { tools.forEach(t => c.allowed.add(t)); chatRun(id, m, `Permission granted for: ${tools.join(', ')}. Continue.`, c); }
    else emit({ type: 'chat', id, running: false, error: behavior === 'deny' ? 'permission denied — message not completed' : undefined });
  }
  for (const w of p.waiters) { clearTimeout(w.timer); send(w.res, 200, decideResult(p)); } p.waiters.clear();
  setTimeout(() => { perms.delete(p.id); permDirty = true; }, 30000);
  return { ok: true };
}
function sweepPerms() {
  const now = Date.now();
  for (const p of perms.values()) if (p.status === 'pending' && ((p.dropAt && p.dropAt < now) || now - p.created > PERM_TTL)) { perms.delete(p.id); permDirty = true; }
}

function hookInstalled() {
  const os = require('os');
  try { return fs.readdirSync(os.homedir()).filter(n => /^\.claude(-|$)/.test(n)).some(n => { try { return fs.readFileSync(path.join(os.homedir(), n, 'settings.json'), 'utf8').includes('permission-hook.mjs'); } catch { return false; } }); } catch { return false; }
}

/* ---------- chat with an observed session: continue it with `claude -p --resume` (your subscription) ---------- */
const chats = new Map();      // short session id -> { proc, allowed:Set }
const isDirSync = d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };

function chatSend(b) {
  const id = String(b.id || ''), text = String(b.text || '').trim().slice(0, 8000);
  if (!text) return { status: 400, error: 'empty message' };
  const m = observer.lookup(id); if (!m) return { status: 404, error: 'unknown session (it may have been closed)' };
  if (m.provider && m.provider !== 'claude') return { status: 400, error: `chat is only available for Claude Code sessions (this is a ${m.provider} session; its conversation is shown read-only)` };
  if (!m.cwd || !isDirSync(m.cwd)) return { status: 400, error: 'the session folder no longer exists' };
  let c = chats.get(id); if (!c) chats.set(id, c = { proc: null, allowed: new Set() });
  if (c.proc) return { status: 409, error: 'a message is already running for this session' };
  if (m.live && m.status !== 'idle') return { status: 409, error: `this session is ${m.status} in Claude. Wait until it is idle.` };
  if (m.live && !b.ack) return { status: 409, needsAck: true, error: 'This session is open in Claude. Your message continues the same conversation in the background; the Claude window may not refresh until you reopen it.' };
  chatRun(id, m, text, c); return { ok: true };
}

function chatRun(id, m, prompt, c) {
  const args = ['-p', '--resume', m.sessionId, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default'];
  if (c.allowed.size) args.push('--allowedTools', ...c.allowed);
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;      // subscription only
  const proc = spawn(CLAUDE, args, { cwd: m.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  c.proc = proc; emit({ type: 'chat', id, running: true });
  let buf = '', err = '', got = false;
  const finish = (extra = {}) => { if (c.proc === proc) c.proc = null; emit({ type: 'chat', id, running: false, ...extra }); };
  proc.stdin.on('error', () => {}); proc.stdin.end(prompt);
  proc.stderr.on('data', d => { err = (err + d).slice(-600); });
  proc.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== 'result') continue; got = true;
      if (o.is_error) { const msg = String(o.result || 'failed'); return finish({ error: /authenticat|log ?in|oauth/i.test(msg) ? msg + ' — run `claude auth login` in a terminal.' : msg }); }
      const blocked = (o.permission_denials || []).filter(d => d.tool_name !== 'ExitPlanMode');
      if (blocked.length) {
        const tools = [...new Set(blocked.map(toolPattern))];
        const p = { id: 'p' + (++permSeq) + '-' + Date.now().toString(36), sessionId: m.sessionId, agentId: '', tool: clip(blocked.map(d => d.tool_name).join(', '), 60), summary: summarize('', { command: blocked.map(toolDetail).join(' ; ') }),
          full: mask(blocked.map(toolDetail).join('\n').slice(0, 4000)), created: Date.now(), suggestions: [], status: 'pending', waiters: new Set(), dropAt: 0, chat: { id, tools, m } };
        perms.set(p.id, p); permDirty = true; return finish({ waiting: true });
      }
      finish();
    }
  });
  proc.on('error', e => { got = true; finish({ error: e.code === 'ENOENT' ? `cannot find "${CLAUDE}"` : e.message }); });
  proc.on('close', code => { if (!got) finish({ error: `claude exited (${code}) ${oneLine(err)}` }); });
}

function chatCancel(id) { const c = chats.get(String(id)); if (c && c.proc) { const p = c.proc; c.proc = null; p.kill('SIGTERM'); emit({ type: 'chat', id: String(id), running: false, error: 'cancelled' }); } return { ok: true }; }

/* ---------- observing your real Claude Code sessions (read-only) ---------- */
function pollOffice() {
  sweepPerms();
  try { office = { ...observer.read(), perms: permsList() }; } catch (e) { console.error('observer:', e.message); return; }
  const evs = rpg.tick(office, Date.now());
  if (evs.length) { emit({ type: 'rpg', state: rpg.publicState() }); for (const e of evs) emit({ type: 'rpg_event', ...e }); }
  const key = JSON.stringify(office);
  if (key !== officeKey || permDirty) { officeKey = key; permDirty = false; emit({ type: 'office', ...office }); }
}
setInterval(pollOffice, 1000); pollOffice();

/* ---------- HTTP ---------- */
const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
function readJSON(req) {
  return new Promise((res, rej) => {
    let n = 0, s = ''; req.setEncoding('utf8');
    req.on('data', c => { n += c.length; if (n > 65536) { rej(new Error('too large')); req.destroy(); } else s += c; });
    req.on('end', () => { try { res(s ? JSON.parse(s) : {}); } catch { rej(new Error('bad json')); } });
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'bad host' });
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/') {
    return fs.readFile(path.join(ROOT, 'index.html'), (e, b) => {
      if (e) return send(res, 500, { error: 'index.html missing' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b);
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, loggedIn: await checkAuth(), budget: TOKEN_BUDGET, bin: CLAUDE, observer: { sessions: office.sessions.length }, hookInstalled: hookInstalled() });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/brain/')) {
    const q = k => url.searchParams.get(k) || '';
    const r = (v, nf = 'not found') => v && !v.error ? send(res, 200, v) : send(res, (v && v.status) || 404, { error: (v && v.error) || nf });
    switch (url.pathname.slice('/api/brain/'.length)) {
      case 'status': return send(res, 200, brain.status());
      case 'browse': return r(brain.browse(q('dir')));
      case 'tree': return r(brain.tree(), 'no vault configured');
      case 'note': return r(brain.note(q('p')));
      case 'search': return send(res, 200, brain.search(q('q')));
      case 'graph': return r(brain.graph(q('kind')), 'no graph');
      case 'resolve': return send(res, 200, { p: brain.resolveLink(q('from'), q('to')) });
      case 'file': case 'attach': {
        const rel = url.pathname.endsWith('attach') ? brain.findAttachment(q('name')) : q('p'), f = rel && brain.file(rel);
        if (!f) return send(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
        return fs.createReadStream(f.f).pipe(res);
      }
    }
    return send(res, 404, { error: 'not found' });
  }
  if (req.method === 'GET' && url.pathname === '/api/chat/messages') {
    const id = url.searchParams.get('id') || '', m = observer.lookup(id), c = chats.get(id); let msgs = observer.messages(id); if (!msgs && m && m.provider === 'grokbot') msgs = [];
    return msgs ? send(res, 200, { messages: msgs, running: !!(c && c.proc), live: !!(m && m.live), status: m && m.status, provider: (m && m.provider) || 'claude', canChat: !m || !m.provider || m.provider === 'claude' }) : send(res, 404, { error: 'no transcript for that session' });
  }
  const hw = req.method === 'GET' && /^\/api\/hook\/permission\/([\w-]+)\/wait$/.exec(url.pathname);
  if (hw) return waitPerm(hw[1], req, res);
  { const m = req.method === 'GET' && /^\/ui\/([\w.-]+\.js)$/.exec(url.pathname);
    if (m) return fs.readFile(path.join(ROOT, 'ui', m[1]), (e, b) => { if (e) return send(res, 404, { error: 'not found' }); res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); }); }
  if (req.method === 'GET' && url.pathname.startsWith('/api/repos/')) {
    const q = k => url.searchParams.get(k) || '', prov = q('provider') === 'gitlab' ? 'gitlab' : 'github';
    const roots = [...new Map((office.sessions || []).filter(x => x.provider !== 'grokbot' && x.root).map(x => [x.root, { root: x.root, project: x.project }])).values()];
    const out = async f => { try { const v = await f(); return send(res, v && v.status && v.error ? v.status : 200, v); } catch (e) { return send(res, 500, { error: String(e.message || e).slice(0, 200) }); } };
    switch (url.pathname.slice('/api/repos/'.length)) {
      case 'status': return out(() => repos.status());
      case 'list': return out(() => repos.list(prov, q('owner'), roots));
      case 'detail': return out(() => repos.detail(prov, q('repo')));
    }
    return send(res, 404, { error: 'not found' });
  }
  if (req.method === 'GET' && url.pathname === '/api/rpg') return send(res, 200, rpg.publicState());
  if (req.method === 'GET' && url.pathname === '/api/office') return send(res, 200, office);
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello', budget: TOKEN_BUDGET, office, rpg: rpg.publicState(),
      agents: [...agents.values()].map(a => ({ id: a.id, state: a.state, subtask: a.subtask, task: a.task, ticket: a.ticket })),
      decisions: [...decisions.values()] })}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(': ka\n\n'), 20000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    const origin = req.headers.origin;
    if ((origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) || !/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 403, { error: 'forbidden' });
    let body; try { body = await readJSON(req); } catch (e) { return send(res, 400, { error: e.message }); }
    let r;
    if (url.pathname === '/api/task') r = startTask(body);
    else if (url.pathname === '/api/decide') r = decide(String(body.id), String(body.action), body.note);
    else if (url.pathname === '/api/cancel') r = cancel(String(body.agent));
    else if (url.pathname === '/api/hook/permission') r = registerPerm(body);
    else if (url.pathname === '/api/perm/decide') r = decidePerm(body);
    else if (url.pathname === '/api/brain/vault') r = brain.setVault(body.path);
    else if (url.pathname === '/api/rpg/reset') { if (body.confirm !== true) r = { status: 400, error: 'confirm required' }; else { rpg.reset(); emit({ type: 'rpg', state: rpg.publicState() }); r = { ok: true }; } }
    else if (url.pathname === '/api/chat/send') r = chatSend(body);
    else if (url.pathname === '/api/chat/cancel') r = chatCancel(body.id);
    else r = { status: 404, error: 'not found' };
    return send(res, r.status || 200, r);
  }
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, async () => {
  const ok = await checkAuth();
  console.log(`\n  PIXEL OFFICE bridge  →  http://localhost:${PORT}`);
  console.log(`  claude binary        →  ${CLAUDE}`);
  console.log(`  workspace            →  ${WORKSPACE}`);
  console.log(`  claude login         →  ${ok === true ? 'logged in (subscription)' : ok === false ? 'NOT LOGGED IN — run: claude auth login' : 'could not determine (is "claude" installed?)'}\n`);
});
const stop = () => { for (const a of agents.values()) if (a.proc) a.proc.kill('SIGTERM'); rpg.save(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
