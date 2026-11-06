'use strict';
/* =====================================================================
   Grok Build CLI provider (read-only).
   Sessions live under <GROK_HOME or ~/.grok>/sessions/…, "keyed by working directory"; each session is a
   directory holding  summary.json  (title, git info, model)  and  updates.jsonl  (one update per line).
   Update lines are keyed by `sessionUpdate`: user_message_chunk, agent_message_chunk, agent_thought_chunk,
   tool_call, tool_call_update … (Agent Client Protocol style), each with a stable _meta.eventId.
   Format reference: xAI docs (sessions) + Traces' adapter notes. NOTE: the exact directory naming and the field
   that records the working directory are NOT documented, so this reader is tolerant (several field names are tried,
   unknown lines are skipped) and is fixture-tested only, not verified against a live install.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../util');

const RUNNING = /(^|\n)(\S*\/)?(node\s+\S*\/)?grok(\.js)?(\s|$)/;
const SCAN_MS = 10000;
const home = () => process.env.GROK_HOME || path.join(os.homedir(), '.grok');

const unwrap = o => (o && (o.update || (o.params && o.params.update))) || o;
const textOfContent = c => !c ? '' : typeof c === 'string' ? c : Array.isArray(c) ? c.map(textOfContent).join('') : typeof c.text === 'string' ? c.text : c.content ? textOfContent(c.content) : '';
const toolLine = u => {
  const raw = u.rawInput || u.input || u.arguments || {}; const what = raw.command || raw.file_path || raw.path || raw.query || raw.url || '';
  const title = u.title || u.kind || 'tool'; return U.mask(U.clip(what && !String(title).includes(String(what)) ? `${title}: ${what}` : title, 110));
};

class GrokTail extends U.JsonlTail {
  constructor(file) { super(file); this.model = ''; this.activity = null; this.prompt = ''; this.tools = 0; this.ids = new Set(); this.say = ''; this.sayAt = 0; }
  line(l, count) {
    let o; try { o = JSON.parse(l); } catch { return; } const u = unwrap(o); if (!u || typeof u !== 'object') return;
    const meta = o._meta || u._meta || {}; const at = Date.parse(o.timestamp || meta.timestamp) || Date.now();
    if (typeof meta.model === 'string' && meta.model) this.model = meta.model; else if (typeof u.model === 'string') this.model = u.model;
    switch (u.sessionUpdate) {
      case 'user_message_chunk': { const t = textOfContent(u.content).trim(); if (t && !U.INJECTED.test(t) && !this.promptOpen) this.prompt = U.mask(U.clip(t, 140)); return; }
      case 'agent_message_chunk': { const t = textOfContent(u.content); if (t) { this.say = (at - this.sayAt < 15000 ? this.say : '') + t; this.sayAt = at; this.activity = { id: 'say:' + (meta.eventId || at), text: U.mask(U.clip(this.say, 110)), at, say: true }; } return; }
      case 'tool_call': { const id = u.toolCallId || meta.eventId || 't' + at; if (this.ids.has(id)) return; this.ids.add(id); if (this.ids.size > 3000) this.ids.delete(this.ids.values().next().value);
        if (count) this.tools++; this.activity = { id, text: toolLine(u), at }; return; }
      default: return;
    }
  }
}

function createGrok(opts = {}) {
  const tails = new Map(), metaById = new Map(), summaries = new Map(); let scanAt = 0, list = [];
  const ignore = (opts.ignore || []).map(d => path.resolve(d));
  const ignored = c => ignore.some(d => c === d || c.startsWith(d + path.sep));
  function scan(now) {
    if (now - scanAt < SCAN_MS) return list; scanAt = now; const out = [], root = path.join(home(), 'sessions');
    (function walk(dir, depth) {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      if (ents.some(e => e.name === 'updates.jsonl') && ents.some(e => e.name === 'summary.json')) {
        let st; try { st = fs.statSync(path.join(dir, 'updates.jsonl')); } catch { return; }
        if (now - st.mtimeMs <= U.SLEEP_MS) out.push({ dir, f: path.join(dir, 'updates.jsonl'), key: path.relative(root, path.dirname(dir)), mtime: st.mtimeMs }); return;
      }
      if (depth < 4) for (const e of ents) if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), depth + 1);
    })(root, 0);
    return (list = out.sort((a, b) => b.mtime - a.mtime).slice(0, U.SLEEP_MAX * 2));
  }
  function summary(c) {
    const k = c.dir + ':' + c.mtime; let s = summaries.get(c.dir); if (s && s.at > Date.now() - 30000) return s.v;
    let v = {}; try { v = JSON.parse(fs.readFileSync(path.join(c.dir, 'summary.json'), 'utf8')); } catch { /* optional */ } summaries.set(c.dir, { at: Date.now(), v }); return v;
  }
  function cwdOf(c, s) {
    const cand = s.cwd || s.workingDirectory || s.workspace || s.workspaceRoot || s.projectPath || (s.git && (s.git.root || s.git.cwd)) || '';
    if (typeof cand === 'string' && cand.startsWith('/')) return cand;
    let key = c.key.split(path.sep).pop() || ''; try { key = decodeURIComponent(key); } catch { /* keep */ }
    return key.startsWith('/') ? key : '';
  }
  function read() {
    const now = Date.now(), running = U.procRunning(RUNNING), sessions = []; let tokens = 0;
    for (const c of scan(now)) {
      let t = tails.get(c.f); if (!t) tails.set(c.f, t = new GrokTail(c.f)); t.poll();
      const s = summary(c), cwd = cwdOf(c, s); if (cwd && ignored(cwd)) continue;
      const st = U.statusFor(Math.max(c.mtime, t.lastAt || 0), now, running); if (!st) continue;
      const sid = path.basename(c.dir), id = 'gk-' + sid.slice(0, 8), project = cwd ? (path.basename(cwd) || cwd) : (c.key.split(path.sep).pop() || 'grok');
      metaById.set(id, { provider: 'grok', sessionId: sid, cwd, file: c.f, live: !st.sleeping, status: st.status });
      sessions.push({ id, sessionId: sid, provider: 'grok', kind: 'main', sleeping: st.sleeping, pid: 0, project, root: cwd || path.join(home(), 'sessions', c.key), name: U.clip(s.title || s.summary || t.prompt || 'Grok ' + sid.slice(0, 8), 60),
        status: st.status, waitingFor: '', since: c.mtime, startedAt: Date.parse(s.createdAt || s.startedAt || s.created) || 0, entrypoint: st.sleeping ? 'not running' : 'grok', activity: t.activity, prompt: t.prompt,
        model: U.modelName(t.model || s.model), ctx: 0, tokens: 0, tools: t.tools, updatedAt: Math.max(c.mtime, t.lastAt || 0) });
      if (sessions.length >= U.SLEEP_MAX) break;
    }
    return { sessions, subs: [], tokens };
  }
  function messages(id, limit = 40) {
    const m = metaById.get(id); if (!m) return null; const tt = U.readTailText(m.file, 600 * 1024); if (!tt) return null;
    let lines = tt.text.split('\n'); if (tt.partial) lines = lines.slice(1); const out = []; let last = null;
    const push = (r, t, at) => { if (last && last.r === r && r !== 'tool') { last.t += t; return; } last = { r, t, at }; out.push(last); };
    for (const l of lines) { let o; try { o = JSON.parse(l); } catch { continue; } const u = unwrap(o); if (!u) continue; const at = Date.parse(o.timestamp) || 0;
      if (u.sessionUpdate === 'user_message_chunk') { const t = textOfContent(u.content); if (t) push('user', t, at); }
      else if (u.sessionUpdate === 'agent_message_chunk') { const t = textOfContent(u.content); if (t) push('assistant', t, at); }
      else if (u.sessionUpdate === 'tool_call') push('tool', toolLine(u), at); }
    return out.map(x => ({ r: x.r, t: U.mask(x.t.trim().slice(0, 4000)), at: x.at })).filter(x => x.t).slice(-limit);
  }
  return { read, messages, lookup: id => metaById.get(id) || null };
}
module.exports = { createGrok, GrokTail };
