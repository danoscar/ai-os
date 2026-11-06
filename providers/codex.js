'use strict';
/* =====================================================================
   Codex CLI / Codex app provider (read-only).
   Reads <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl  (CODEX_HOME defaults to ~/.codex).
   Each line is {timestamp, type, payload}: session_meta (cwd…), turn_context (model), event_msg
   (task_started / task_complete / token_count / item_completed / legacy user_message…), response_item (tool calls).
   Format reference: habblaud's Codex source. NOTE: written from that documented format and fixture-tested;
   if your Codex version differs, activity may show less detail but nothing breaks (unknown lines are skipped).
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../util');

const ROLLOUT = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})(?:_[0-9a-f-]{36})?\.jsonl$/i;
const RUNNING = /(^|\n)(\S*\/)?(node\s+\S*\/)?codex(\.js)?(\s|$)/;
const SCAN_MS = 10000;

function homes() {
  if (process.env.CODEX_HOME) return process.env.CODEX_HOME.split(path.delimiter);
  const h = os.homedir();
  try { return fs.readdirSync(h).filter(n => /^\.codex(-|$)/.test(n)).map(n => path.join(h, n)).filter(d => fs.existsSync(path.join(d, 'sessions'))); } catch { return []; }
}
const parseArgs = a => { if (a && typeof a === 'object') return a; try { return JSON.parse(a); } catch { return {}; } };
function describe(name, input) {
  input = parseArgs(input) || {};
  const cmd = Array.isArray(input.command) ? input.command.join(' ') : input.command || input.cmd || '';
  const what = cmd || input.path || input.file_path || input.query || input.url || '';
  const n = /^(shell|shell_command|local_shell|exec_command|container\.exec|exec)$/.test(name) ? 'shell' : name.replace(/^functions\./, '');
  return U.mask(U.clip(what ? `${n}: ${what}` : n, 110));
}

class CodexTail extends U.JsonlTail {
  constructor(file) { super(file); this.meta = null; this.model = ''; this.activity = null; this.prompt = ''; this.tools = 0; this.tokens = 0; this.base = null; this.ctx = 0; this.turnOpen = false; this.mode = ''; }
  poll() {
    if (this.offset < 0 && !this.meta) this.readMeta();
    return super.poll();
  }
  readMeta() {                      // session_meta is the first line (can be tens of KB: it carries the base instructions)
    for (const n of [64 * 1024, 1024 * 1024]) {
      const head = U.readHead(this.file, n), nl = head.indexOf('\n');
      if (nl < 0 && head.length >= n) continue;
      try { const o = JSON.parse(nl < 0 ? head : head.slice(0, nl)); if (o.type === 'session_meta') this.line(JSON.stringify(o), false); } catch { /* unreadable */ }
      return;
    }
  }
  say(id, text, at) { text = String(text || '').trim(); if (text) this.activity = { id, text: U.mask(U.clip(text, 110)), at, say: true }; }
  tool(id, text, at, count) { if (count) this.tools++; this.activity = { id: id || 't' + at, text, at }; }
  ask(text) { text = String(text || '').trim(); if (text && !U.INJECTED.test(text)) this.prompt = U.mask(U.clip(text, 140)); }
  line(l, count) {
    let o; try { o = JSON.parse(l); } catch { return; }
    const p = o && o.payload; if (!p || typeof p !== 'object') return; const at = Date.parse(o.timestamp) || Date.now();
    if (o.type === 'session_meta') { this.meta = { id: p.id, cwd: p.cwd, ver: p.cli_version, started: Date.parse(p.timestamp) || at }; if (p.history_mode === 'paginated') this.mode = 'paginated'; return; }
    if (o.type === 'turn_context') { if (typeof p.model === 'string') this.model = p.model; return; }
    if (o.type === 'event_msg') {
      switch (p.type) {
        case 'task_started': case 'turn_started': this.turnOpen = true; return;
        case 'task_complete': case 'turn_complete': case 'turn_aborted': this.turnOpen = false; return;
        case 'token_count': {
          const tot = p.info && p.info.total_token_usage; if (!tot) return;
          const t = (tot.input_tokens || 0) + (tot.output_tokens || 0); if (this.base === null) this.base = t;
          this.tokens = Math.max(0, t - this.base);
          const last = p.info.last_token_usage; if (last) this.ctx = last.input_tokens || this.ctx; return;
        }
        case 'item_completed': {
          const it = p.item || {}; this.mode = 'paginated';
          switch (it.type) {
            case 'UserMessage': return this.ask(U.textOf(it.content));
            case 'AgentMessage': return this.say(it.id || 'a' + at, U.textOf(it.content), at);
            case 'CommandExecution': return this.tool(it.id, U.mask(U.clip('shell: ' + (Array.isArray(it.command) ? it.command.join(' ') : it.command || ''), 110)), at, count);
            case 'FileChange': return this.tool(it.id, 'apply_patch', at, count);
            case 'McpToolCall': return this.tool(it.id, U.clip(`${it.server || 'mcp'}.${it.tool || 'tool'}`, 80), at, count);
            case 'WebSearch': return this.tool(it.id, U.clip('WebSearch: ' + (it.query || ''), 110), at, count);
            default: return;
          }
        }
        case 'user_message': if (this.mode !== 'paginated') this.ask(p.message); return;      // legacy
        case 'agent_message': if (this.mode !== 'paginated') this.say('a' + at, p.message, at); return;
        default: return;
      }
    }
    if (o.type === 'response_item') {
      if (p.type === 'function_call' || p.type === 'custom_tool_call') this.tool(p.call_id || p.id, describe(p.name || 'tool', p.type === 'custom_tool_call' ? { command: p.input } : p.arguments), at, count && this.mode !== 'paginated');
      else if (p.type === 'local_shell_call') this.tool(p.call_id || p.id, describe('shell', p.action || {}), at, count && this.mode !== 'paginated');
    }
  }
}

function createCodex(opts = {}) {
  const tails = new Map(); let scanAt = 0, list = []; const metaById = new Map();
  const ignore = (opts.ignore || []).map(d => path.resolve(d));
  const ignored = c => ignore.some(d => c === d || c.startsWith(d + path.sep));
  function scan(now) {
    if (now - scanAt < SCAN_MS) return list; scanAt = now; const out = [];
    for (const home of homes()) {
      const root = path.join(home, 'sessions');
      const walk = (dir, depth) => { let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) { const f = path.join(dir, e.name);
          if (e.isDirectory() && depth < 4) walk(f, depth + 1);
          else if (e.isFile() && ROLLOUT.test(e.name)) { let st; try { st = fs.statSync(f); } catch { continue; } if (now - st.mtimeMs <= U.SLEEP_MS) out.push({ f, thread: ROLLOUT.exec(e.name)[1], mtime: st.mtimeMs }); } } };
      walk(root, 0);
    }
    return (list = out.sort((a, b) => b.mtime - a.mtime).slice(0, U.SLEEP_MAX * 2));
  }
  function read() {
    const now = Date.now(), running = U.procRunning(RUNNING), sessions = []; let tokens = 0;
    for (const c of scan(now)) {
      let t = tails.get(c.f); if (!t) tails.set(c.f, t = new CodexTail(c.f)); t.poll();
      const cwd = t.meta && t.meta.cwd; if (!cwd || ignored(cwd)) continue;
      const st = U.statusFor(Math.max(c.mtime, t.lastAt), now, running); if (!st) continue;
      const root = cwd, id = 'cx-' + c.thread.slice(0, 8); metaById.set(id, { provider: 'codex', sessionId: c.thread, cwd, file: c.f, live: !st.sleeping, status: st.status });
      tokens += t.tokens;
      sessions.push({ id, sessionId: c.thread, provider: 'codex', kind: 'main', sleeping: st.sleeping, pid: 0, project: path.basename(root) || root, root, name: U.clip(t.prompt || 'Codex ' + c.thread.slice(0, 8), 60),
        status: st.status, waitingFor: '', since: c.mtime, startedAt: (t.meta && t.meta.started) || 0, entrypoint: st.sleeping ? 'not running' : 'codex', activity: t.activity, prompt: t.prompt,
        model: U.modelName(t.model), ctx: t.ctx, tokens: t.tokens, tools: t.tools, updatedAt: Math.max(c.mtime, t.lastAt) });
      if (sessions.length >= U.SLEEP_MAX) break;
    }
    return { sessions, subs: [], tokens };
  }
  function messages(id, limit = 40) {
    const m = metaById.get(id); if (!m) return null;
    const tt = U.readTailText(m.file, 600 * 1024); if (!tt) return null;
    let lines = tt.text.split('\n'); if (tt.partial) lines = lines.slice(1); const out = []; let paginated = false;
    for (const l of lines) {
      let o; try { o = JSON.parse(l); } catch { continue; } const p = o && o.payload; if (!p) continue; const at = Date.parse(o.timestamp) || 0;
      if (o.type === 'event_msg' && p.type === 'item_completed' && p.item) {
        paginated = true; const it = p.item;
        if (it.type === 'UserMessage') { const t = U.textOf(it.content).trim(); if (t && !U.INJECTED.test(t)) out.push({ r: 'user', t: U.mask(t.slice(0, 4000)), at }); }
        else if (it.type === 'AgentMessage') { const t = U.textOf(it.content).trim(); if (t) out.push({ r: 'assistant', t: U.mask(t.slice(0, 4000)), at }); }
        else if (it.type === 'CommandExecution') out.push({ r: 'tool', t: U.mask(U.clip('shell: ' + (Array.isArray(it.command) ? it.command.join(' ') : it.command || ''), 110)), at });
      } else if (!paginated && o.type === 'event_msg' && p.type === 'user_message') { const t = String(p.message || '').trim(); if (t && !U.INJECTED.test(t)) out.push({ r: 'user', t: U.mask(t.slice(0, 4000)), at }); }
      else if (!paginated && o.type === 'event_msg' && p.type === 'agent_message') { const t = String(p.message || '').trim(); if (t) out.push({ r: 'assistant', t: U.mask(t.slice(0, 4000)), at }); }
      else if (!paginated && o.type === 'response_item' && p.type === 'function_call') out.push({ r: 'tool', t: describe(p.name || 'tool', p.arguments), at });
    }
    return out.slice(-limit);
  }
  return { read, messages, lookup: id => metaById.get(id) || null };
}
module.exports = { createCodex, CodexTail };
