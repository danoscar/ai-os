'use strict';
/* =====================================================================
   Gemini CLI provider (read-only).
   Reads ~/.gemini/tmp/<project>/chats/session-<time>-<id>.jsonl  (also the older single-JSON session files).
   JSONL: first line = metadata {sessionId, projectHash, startTime, lastUpdated, directories, summary}; then message
   lines {id, timestamp, type:'user'|'gemini', content, toolCalls, tokens:{input,output,…}, model}; `$set` lines update
   metadata (summary/lastUpdated).  Format reference: google-gemini/gemini-cli chatRecordingService.
   NOTE: written from that documented format and fixture-tested, not against a live install.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../util');

const FILE = /^session-.*\.jsonl?$/i;
const RUNNING = /(^|\n)(\S*\/)?(node\s+\S*\/)?gemini(\.js)?(\s|$)/;
const SCAN_MS = 10000;

function dirs() {
  const base = process.env.GEMINI_DIR || (process.env.GEMINI_CLI_HOME ? path.join(process.env.GEMINI_CLI_HOME, '.gemini') : path.join(os.homedir(), '.gemini'));
  const t = path.join(base, 'tmp'); try { return fs.statSync(t).isDirectory() ? [t] : []; } catch { return []; }
}
const toolText = tc => { const a = tc.args || tc.input || {}; const what = a.command || a.file_path || a.path || a.dir_path || a.query || a.url || tc.description || ''; return U.mask(U.clip(what ? `${tc.displayName || tc.name || 'tool'}: ${what}` : (tc.displayName || tc.name || 'tool'), 110)); };

class GeminiTail extends U.JsonlTail {
  constructor(file) { super(file); this.meta = {}; this.ids = new Set(); this.model = ''; this.activity = null; this.prompt = ''; this.tools = 0; this.tokens = 0; this.ctx = 0; }
  line(l, count) {
    let o; try { o = JSON.parse(l); } catch { return; } if (!o || typeof o !== 'object') return;
    if (o.$set && typeof o.$set === 'object') { Object.assign(this.meta, o.$set); return; }
    if (o.sessionId && o.startTime && !o.type) { Object.assign(this.meta, o); return; }
    if (o.$rewindTo || o.$patch) return;
    const at = Date.parse(o.timestamp) || Date.now();
    if (o.type === 'user') { const t = U.textOf(o.content).trim(); if (t) this.prompt = U.mask(U.clip(t, 140)); return; }
    if (o.type !== 'gemini') return;
    if (typeof o.model === 'string') this.model = o.model;
    if (o.id && !this.ids.has(o.id)) { this.ids.add(o.id); if (this.ids.size > 5000) this.ids.delete(this.ids.values().next().value);
      const t = o.tokens; if (t) { this.ctx = t.input || this.ctx; if (count) this.tokens += (t.input || 0) + (t.output || 0); } }
    for (const tc of Array.isArray(o.toolCalls) ? o.toolCalls : []) { if (count) this.tools++; this.activity = { id: tc.id || 't' + at, text: toolText(tc), at }; }
    const txt = U.textOf(o.content).trim(); if (txt) this.activity = { id: o.id || 'g' + at, text: U.mask(U.clip(txt, 110)), at, say: true };
  }
}

function projectOf(chatsDir, meta) {
  const root = path.dirname(chatsDir);
  let cwd = Array.isArray(meta.directories) && meta.directories[0] || '';
  if (!cwd) { try { cwd = fs.readFileSync(path.join(root, '.project_root'), 'utf8').trim(); } catch { /* older versions */ } }
  return cwd || '';
}

function createGemini(opts = {}) {
  const tails = new Map(), metaById = new Map(); let scanAt = 0, list = [];
  const ignore = (opts.ignore || []).map(d => path.resolve(d));
  const ignored = c => ignore.some(d => c === d || c.startsWith(d + path.sep));
  function scan(now) {
    if (now - scanAt < SCAN_MS) return list; scanAt = now; const out = [];
    for (const tmp of dirs()) { let projs; try { projs = fs.readdirSync(tmp); } catch { continue; }
      for (const pr of projs) { const cd = path.join(tmp, pr, 'chats'); let fs_; try { fs_ = fs.readdirSync(cd).filter(n => FILE.test(n)); } catch { continue; }
        for (const n of fs_) { const f = path.join(cd, n); let st; try { st = fs.statSync(f); } catch { continue; } if (now - st.mtimeMs <= U.SLEEP_MS) out.push({ f, cd, proj: pr, mtime: st.mtimeMs, legacy: n.endsWith('.json') }); } } }
    return (list = out.sort((a, b) => b.mtime - a.mtime).slice(0, U.SLEEP_MAX * 2));
  }
  function legacy(c) {                              // older format: one JSON {sessionId, messages:[…]}
    let j; try { j = JSON.parse(fs.readFileSync(c.f, 'utf8')); } catch { return null; }
    const t = new GeminiTail(c.f); t.meta = { sessionId: j.sessionId, startTime: j.startTime, directories: j.directories };
    for (const m of j.messages || []) t.line(JSON.stringify(m), false); t.lastAt = c.mtime; return t;
  }
  function read() {
    const now = Date.now(), running = U.procRunning(RUNNING), sessions = []; let tokens = 0;
    for (const c of scan(now)) {
      let t;
      if (c.legacy) { const k = c.f + ':' + c.mtime; t = tails.get(k); if (!t) { t = legacy(c); if (!t) continue; tails.set(k, t); } }
      else { t = tails.get(c.f); if (!t) { t = new GeminiTail(c.f); const head = U.readHead(c.f, 65536); const nl = head.indexOf('\n'); if (nl > 0) t.line(head.slice(0, nl), false); tails.set(c.f, t); } t.poll(); }
      const sid = t.meta.sessionId; if (!sid) continue;
      const cwd = projectOf(c.cd, t.meta); if (cwd && ignored(cwd)) continue;
      const st = U.statusFor(Math.max(c.mtime, t.lastAt || 0), now, running); if (!st) continue;
      const root = cwd || path.join(path.dirname(c.cd)), project = cwd ? (path.basename(cwd) || cwd) : c.proj, id = 'gm-' + String(sid).slice(0, 8);
      metaById.set(id, { provider: 'gemini', sessionId: sid, cwd, file: c.f, live: !st.sleeping, status: st.status, legacy: c.legacy });
      tokens += t.tokens;
      sessions.push({ id, sessionId: sid, provider: 'gemini', kind: 'main', sleeping: st.sleeping, pid: 0, project, root, name: U.clip(t.meta.summary || t.prompt || 'Gemini ' + String(sid).slice(0, 8), 60),
        status: st.status, waitingFor: '', since: c.mtime, startedAt: Date.parse(t.meta.startTime) || 0, entrypoint: st.sleeping ? 'not running' : 'gemini', activity: t.activity, prompt: t.prompt,
        model: U.modelName(t.model), ctx: t.ctx, tokens: t.tokens, tools: t.tools, updatedAt: Math.max(c.mtime, t.lastAt || 0) });
      if (sessions.length >= U.SLEEP_MAX) break;
    }
    return { sessions, subs: [], tokens };
  }
  function messages(id, limit = 40) {
    const m = metaById.get(id); if (!m) return null; let rows = [];
    if (m.legacy) { try { rows = (JSON.parse(fs.readFileSync(m.file, 'utf8')).messages || []); } catch { return null; } }
    else { const tt = U.readTailText(m.file, 600 * 1024); if (!tt) return null; let lines = tt.text.split('\n'); if (tt.partial) lines = lines.slice(1); for (const l of lines) { try { rows.push(JSON.parse(l)); } catch { /* skip */ } } }
    const out = [];
    for (const o of rows) { if (!o || !o.type) continue; const at = Date.parse(o.timestamp) || 0;
      if (o.type === 'user') { const t = U.textOf(o.content).trim(); if (t) out.push({ r: 'user', t: U.mask(t.slice(0, 4000)), at }); }
      else if (o.type === 'gemini') { for (const tc of Array.isArray(o.toolCalls) ? o.toolCalls : []) out.push({ r: 'tool', t: toolText(tc), at }); const t = U.textOf(o.content).trim(); if (t) out.push({ r: 'assistant', t: U.mask(t.slice(0, 4000)), at }); } }
    return out.slice(-limit);
  }
  return { read, messages, lookup: id => metaById.get(id) || null };
}
module.exports = { createGemini, GeminiTail };
