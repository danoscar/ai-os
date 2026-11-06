'use strict';
/* =====================================================================
   PIXEL OFFICE — session observer (read-only, zero dependencies)

   Same idea as habblaud: Claude Code keeps its own bookkeeping, so we just read it.
     ~/.claude/sessions/<pid>.json                       who is open + status (busy | idle | waiting)
     ~/.claude/projects/<cwd>/<session>.jsonl            transcript → current activity, model, tokens
     ~/.claude/projects/<cwd>/<session>/subagents/*.jsonl  helper agents spawned by a session

   • Never writes anything. Transcripts can be hundreds of MB, so only the tail is read
     (256 KB on first sight, then just the bytes appended since).
   • Tokens are counted from the moment the server starts ("observed"), not historically.
   • Obvious secrets are masked before anything leaves this module.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAIL = 256 * 1024, MAX_CHUNK = 2 * 1024 * 1024;
const SUB_RECENT_MS = 30 * 60e3;      // finished subagents stay as idle desks this long
const SLEEP_MS = 24 * 3600e3;         // sessions that are not running but were active within a day show as sleeping
const SLEEP_MAX = 12, SLEEP_SCAN_MS = 15000;

const SECRET = [
  [/(Bearer\s+)[A-Za-z0-9._~+\/=-]{12,}/gi, '$1***'],
  [/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '***'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***'],
  [/(:\/\/[^\s:@\/]+:)[^\s@\/]+@/g, '$1***@'],
  [/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|KEY)\s*=\s*)\S+/g, '$1***'],
  [/(\s-p\s*|--password[= ]|-u\s+[^\s:]+:)\S+/g, '$1***']
];
const mask = s => SECRET.reduce((t, [re, rep]) => t.replace(re, rep), s);
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** Config dirs: CLAUDE_CONFIG_DIR, else ~/.claude and any ~/.claude-* that has a sessions/ folder. */
function configDirs() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR.split(path.delimiter);
  const home = os.homedir();
  try {
    return fs.readdirSync(home).filter(n => /^\.claude(-|$)/.test(n)).map(n => path.join(home, n))
      .filter(d => { try { return fs.statSync(path.join(d, 'sessions')).isDirectory(); } catch { return false; } });
  } catch { return []; }
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const encodeCwd = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-');
/** Worktrees (<root>/.claude/worktrees/<name>) belong to the project they branch from. */
const projectRoot = cwd => cwd.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+.*$/, '');
const shortModel = m => { const x = /(opus|sonnet|haiku)[-_ ]?(\d+)?[-_.]?(\d+)?/i.exec(m || ''); return x ? x[1][0].toUpperCase() + x[1].slice(1).toLowerCase() + (x[2] ? ' ' + x[2] + (x[3] ? '.' + x[3] : '') : '') : (m || '?'); };

function describeTool(name, i) {
  i = i || {};
  const what = i.command || i.file_path || i.path || i.pattern || i.url || i.query || i.description || i.prompt || i.skill || '';
  const n = name.startsWith('mcp__') ? name.split('__').slice(2).join('.') : name;
  return mask(clip(what ? `${n}: ${what}` : n, 110));
}

class Tail {
  constructor(file) { this.file = file; this.offset = -1; this.ids = new Set(); this.tokens = 0; this.tools = 0; this.activity = null; this.model = ''; this.ctx = 0; this.prompt = ''; this.lastAt = 0; }
  poll() {
    let st; try { st = fs.statSync(this.file); } catch { return false; }
    this.lastAt = st.mtimeMs;
    const first = this.offset < 0;
    if (!first && st.size === this.offset) return false;
    let from = first ? Math.max(0, st.size - TAIL) : this.offset;
    if (st.size < from) from = Math.max(0, st.size - TAIL);               // truncated / rotated
    if (st.size - from > MAX_CHUNK) from = st.size - MAX_CHUNK;           // skip a huge gap
    const len = st.size - from; if (len <= 0) { this.offset = st.size; return false; }
    const buf = Buffer.alloc(len); let fd;
    try { fd = fs.openSync(this.file, 'r'); fs.readSync(fd, buf, 0, len, from); } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
    let text = buf.toString('utf8'); const cut = text.lastIndexOf('\n');
    if (cut < 0) return false;                                           // no complete line yet
    this.offset = from + Buffer.byteLength(text.slice(0, cut + 1)); text = text.slice(0, cut);
    if (from > 0 && first) text = text.slice(text.indexOf('\n') + 1);    // drop the partial first line
    for (const line of text.split('\n')) this.line(line, !first);
    return true;
  }
  line(l, count) {
    const isA = l.includes('"type":"assistant"'), isU = !isA && l.includes('"type":"user"');
    if (!isA && !isU) return;
    let o; try { o = JSON.parse(l); } catch { return; }
    const m = o.message; if (!m) return;
    if (isA) {
      if (m.model && m.model !== '<synthetic>') this.model = m.model;
      const u = m.usage;
      if (u && m.id && !this.ids.has(m.id)) {
        this.ids.add(m.id); if (this.ids.size > 5000) this.ids.delete(this.ids.values().next().value);
        this.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (count) this.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === 'tool_use') { if (count) this.tools++; this.activity = { id: b.id, text: describeTool(b.name || 'tool', b.input), at: Date.parse(o.timestamp) || Date.now() }; }
        else if (b.type === 'text' && b.text && b.text.trim()) this.activity = { id: m.id + ':t', text: mask(clip(b.text, 110)), at: Date.parse(o.timestamp) || Date.now(), say: true };
      }
    } else if (typeof m.content === 'string' && !m.content.startsWith('<') && !o.isMeta) this.prompt = mask(clip(m.content, 140));
  }
}

function createClaudeObserver(opts = {}) {
  const ignore = (opts.ignore || []).map(d => path.resolve(d));
  const ignored = cwd => ignore.some(d => cwd === d || cwd.startsWith(d + path.sep));
  const tails = new Map();      // transcript file → Tail
  const meta = new Map();       // short id → { sessionId, cwd, file, live, status }  (for chat)
  const seenSessions = new Set();
  const tail = f => { let t = tails.get(f); if (!t) tails.set(f, t = new Tail(f)); return t; };

  function findTranscript(dir, s) {
    const direct = path.join(dir, 'projects', encodeCwd(s.cwd), s.sessionId + '.jsonl');
    if (fs.existsSync(direct)) return direct;
    try {                                                                 // cwd may have changed since the session started
      for (const p of fs.readdirSync(path.join(dir, 'projects'))) { const f = path.join(dir, 'projects', p, s.sessionId + '.jsonl'); if (fs.existsSync(f)) return f; }
    } catch { /* none */ }
    return null;
  }

  function subagents(dir, s, file, now) {
    const sd = file.replace(/\.jsonl$/, '') + path.sep + 'subagents', out = [];
    let names; try { names = fs.readdirSync(sd).filter(n => /^agent-.*\.jsonl$/.test(n)); } catch { return out; }
    for (const n of names) {
      const f = path.join(sd, n); let st; try { st = fs.statSync(f); } catch { continue; }
      const age = now - st.mtimeMs; if (age > SUB_RECENT_MS) continue;
      let meta = {}; try { meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* optional */ }
      const t = tail(f); t.poll();
      const running = age < 20000 && meta.finished !== true;
      out.push({ id: n.replace(/^agent-|\.jsonl$/g, '').slice(0, 10), provider: 'claude', kind: 'sub', parent: s.sessionId.slice(0, 8), name: clip(meta.description || meta.agentType || 'subagent', 40),
        role: meta.agentType || 'subagent', status: running ? 'working' : 'idle', done: !running, activity: t.activity, model: shortModel(t.model), tokens: t.tokens, tools: t.tools, ctx: t.ctx, updatedAt: st.mtimeMs, since: st.mtimeMs });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  }

  /* sessions that are not running (no live process) but were active recently: shown as "sleeping" */
  const sleepCache = new Map(); let sleepAt = 0, sleepList = [];
  const grab = (txt, re) => { const m = re.exec(txt); return m ? m[1] : ''; };
  function sleepInfo(file, st) {
    const c = sleepCache.get(file); if (c && c.mtime === st.mtimeMs) return c;
    let head = '', fd;
    try { fd = fs.openSync(file, 'r'); const b = Buffer.alloc(Math.min(131072, st.size)); fs.readSync(fd, b, 0, b.length, 0); head = b.toString('utf8'); } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
    const t = new Tail(file); t.poll();
    let tailTxt = ''; try { const len = Math.min(65536, st.size); const b = Buffer.alloc(len); const f2 = fs.openSync(file, 'r'); fs.readSync(f2, b, 0, len, st.size - len); fs.closeSync(f2); tailTxt = b.toString('utf8'); } catch { /* ignore */ }
    const unesc = x => { try { return JSON.parse('"' + x + '"'); } catch { return x; } };
    const title = unesc(grab(tailTxt, /"customTitle":"((?:[^"\\]|\\.)*)"/) || grab(head, /"customTitle":"((?:[^"\\]|\\.)*)"/) || grab(tailTxt, /"aiTitle":"((?:[^"\\]|\\.)*)"/) || grab(head, /"aiTitle":"((?:[^"\\]|\\.)*)"/) || grab(tailTxt, /"agentName":"((?:[^"\\]|\\.)*)"/));
    const info = { mtime: st.mtimeMs, cwd: unesc(grab(head, /"cwd":"((?:[^"\\]|\\.)*)"/)), title, tail: t };
    sleepCache.set(file, info); return info;
  }
  function sleepers(live, now) {
    if (now - sleepAt < SLEEP_SCAN_MS) return sleepList;
    sleepAt = now; const out = [];
    for (const dir of configDirs()) {
      let projs; try { projs = fs.readdirSync(path.join(dir, 'projects')); } catch { continue; }
      for (const pr of projs) {
        let files; try { files = fs.readdirSync(path.join(dir, 'projects', pr)).filter(n => /^[0-9a-f-]{36}\.jsonl$/.test(n)); } catch { continue; }
        for (const n of files) {
          const sid = n.slice(0, -6); if (live.has(sid)) continue;
          const f = path.join(dir, 'projects', pr, n); let st; try { st = fs.statSync(f); } catch { continue; }
          if (now - st.mtimeMs > SLEEP_MS || st.size < 2000) continue;
          out.push({ f, sid, st });
        }
      }
    }
    out.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    sleepList = [];
    for (const { f, sid, st } of out) {
      if (sleepList.length >= SLEEP_MAX) break;
      const info = sleepInfo(f, st); if (!info || !info.cwd || ignored(info.cwd)) continue;
      const root = projectRoot(info.cwd), t = info.tail;
      meta.set(sid.slice(0, 8), { provider: 'claude', sessionId: sid, cwd: info.cwd, file: f, live: false, status: 'idle', name: info.title || '' });
      sleepList.push({ id: sid.slice(0, 8), sessionId: sid, provider: 'claude', kind: 'main', sleeping: true, pid: 0, project: path.basename(root) || root, root, name: clip(info.title || t.prompt || 'session ' + sid.slice(0, 8), 60),
        status: 'idle', waitingFor: '', since: st.mtimeMs, startedAt: 0, entrypoint: 'not running', activity: t.activity, prompt: t.prompt, model: shortModel(t.model), ctx: t.ctx, tokens: 0, tools: 0, updatedAt: st.mtimeMs });
    }
    return sleepList;
  }

  function read() {
    const now = Date.now(), sessions = [], subs = []; let tokens = 0;
    for (const dir of configDirs()) {
      let files; try { files = fs.readdirSync(path.join(dir, 'sessions')).filter(n => /^\d+\.json$/.test(n)); } catch { continue; }
      for (const n of files) {
        let s; try { s = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', n), 'utf8')); } catch { continue; }
        if (!s || !s.sessionId || !s.cwd || !alive(s.pid) || ignored(s.cwd)) continue;
        const file = findTranscript(dir, s), t = file ? tail(file) : null;
        if (t) t.poll();
        const root = projectRoot(s.cwd);
        const status = s.status === 'busy' ? 'working' : s.status === 'waiting' ? 'waiting' : s.status === 'idle' || s.status === 'shell' ? 'idle'
          : (t && now - t.lastAt < 20000 ? 'working' : 'idle');
        if (!seenSessions.has(s.sessionId)) seenSessions.add(s.sessionId);
        if (t) tokens += t.tokens;
        const id = s.sessionId.slice(0, 8);
        meta.set(id, { provider: 'claude', sessionId: s.sessionId, cwd: s.cwd, file, live: true, status, name: s.name || '' });
        sessions.push({ id, sessionId: s.sessionId, provider: 'claude', kind: 'main', pid: s.pid, project: path.basename(root) || root, root, name: clip(s.name || (t && t.prompt) || path.basename(s.cwd), 60),
          status, waitingFor: s.waitingFor ? mask(clip(s.waitingFor, 80)) : '', since: s.statusUpdatedAt || s.updatedAt || 0, startedAt: s.startedAt || 0,
          entrypoint: s.entrypoint || s.kind || '', activity: t ? t.activity : null, prompt: t ? t.prompt : '', model: t ? shortModel(t.model) : '?', ctx: t ? t.ctx : 0,
          tokens: t ? t.tokens : 0, tools: t ? t.tools : 0, updatedAt: Math.max(s.updatedAt || 0, t ? t.lastAt : 0) });
        if (file) for (const sub of subagents(dir, s, file, now)) { subs.push({ ...sub, project: path.basename(root) || root, root }); tokens += sub.tokens; }
      }
    }
    const live = new Set(sessions.map(x => x.sessionId));
    for (const sl of sleepers(live, now)) if (!live.has(sl.sessionId)) sessions.push(sl);
    sessions.sort((a, b) => a.root.localeCompare(b.root) || (a.startedAt || a.updatedAt) - (b.startedAt || b.updatedAt));
    return { sessions, subs, tokens };
  }
  /* ---- conversation view (for the chat panel): the tail of the transcript as plain messages ---- */
  function messages(id, limit = 40) {
    const m = meta.get(id); if (!m || !m.file) return null;
    let st; try { st = fs.statSync(m.file); } catch { return null; }
    const len = Math.min(st.size, 600 * 1024); const buf = Buffer.alloc(len); let fd;
    try { fd = fs.openSync(m.file, 'r'); fs.readSync(fd, buf, 0, len, st.size - len); } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
    let lines = buf.toString('utf8').split('\n'); if (st.size > len) lines = lines.slice(1);
    const out = [];
    for (const l of lines) {
      const isA = l.includes('"type":"assistant"'), isU = !isA && l.includes('"type":"user"'); if (!isA && !isU) continue;
      let o; try { o = JSON.parse(l); } catch { continue; } const msg = o.message; if (!msg || o.isSidechain) continue;
      const at = Date.parse(o.timestamp) || 0;
      if (isU) {
        const txt = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n') : '');
        if (txt.trim() && !o.isMeta && !/^<(command-|local-command|system-reminder|task-notification)/.test(txt.trim())) out.push({ r: 'user', t: mask(txt.trim().slice(0, 4000)), at });
      } else for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b.type === 'text' && b.text && b.text.trim()) out.push({ r: 'assistant', t: mask(b.text.trim().slice(0, 4000)), at });
        else if (b.type === 'tool_use') out.push({ r: 'tool', t: describeTool(b.name || 'tool', b.input), at });
      }
    }
    return out.slice(-limit);
  }
  return { read, messages, lookup: id => meta.get(id) || null };
}

/* ---- all providers together: Claude Code (registry + transcripts), Codex CLI, Gemini CLI ---- */
function createObserver(opts = {}) {
  const { createCodex } = require('./providers/codex'), { createGemini } = require('./providers/gemini'), { createGrok } = require('./providers/grok'), { createGrokBot } = require('./providers/grokbot');
  const claude = createClaudeObserver(opts), others = [createCodex(opts), createGemini(opts), createGrok(opts), createGrokBot(opts)];
  const all = [claude, ...others];
  return {
    read() {
      const r = claude.read();
      for (const p of others) {
        try { const x = p.read(); r.sessions.push(...x.sessions); r.subs.push(...x.subs); r.tokens += x.tokens; } catch (e) { /* a broken provider must never take the office down */ }
      }
      r.sessions.sort((a, b) => a.root.localeCompare(b.root) || (a.startedAt || a.updatedAt) - (b.startedAt || b.updatedAt));
      return r;
    },
    messages(id, limit) { for (const p of all) { const m = p.messages(id, limit); if (m) return m; } return null; },
    lookup(id) { for (const p of all) { const m = p.lookup(id); if (m) return m; } return null; }
  };
}

module.exports = { createObserver, mask };
