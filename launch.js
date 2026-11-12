'use strict';
/* =====================================================================
   PIXEL OFFICE — quick prompts + starting a new session from the office.

   Quick prompts: a small library of saved prompts (for every project, or for one project). Stored per user in
   ~/.pixel-office/config.json next to the other settings, never inside the project folder.

   Start a session: opens a new terminal window in a project folder running `claude` (or codex / gemini / grok),
   optionally with a first prompt. Safety:
     • the folder must be a project the office already knows (a session was seen there) and must still exist
     • the tool comes from a fixed list, it is never free text
     • the prompt is written into a private script file with strict quoting, never spliced into a command line
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIR = path.join(os.homedir(), '.pixel-office'), CONFIG = path.join(DIR, 'config.json'), RUN = path.join(DIR, 'run');
const load = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}; } catch { return {}; } };
const save = cfg => { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); const tmp = CONFIG + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, CONFIG); };
const isDir = d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, n);

/* ---------- quick prompts ---------- */
const DEFAULTS = [
  ['Continue', 'Continue with the next step.'],
  ['Status', 'Summarise what you have done so far, what is left, and anything you need from me. Be brief.'],
  ['Run tests', 'Run the test suite and fix any failures. Tell me what you changed.'],
  ['Review changes', 'Review the uncommitted changes for bugs and risky edits. List findings by severity. Do not change anything.'],
  ['Commit', 'Commit the current changes with a clear message. Do not push.'],
  ['Explain', 'Explain the last change you made and why, in plain language.']
].map(([label, text], i) => ({ id: 'd' + i, label, text, scope: '' }));

function prompts() { const p = load().prompts; return Array.isArray(p) ? { prompts: p, defaults: false } : { prompts: DEFAULTS, defaults: true }; }
function setPrompts(list) {
  if (!Array.isArray(list)) return { status: 400, error: 'prompts must be a list' };
  if (list.length > 60) return { status: 400, error: 'at most 60 prompts' };
  const out = [], ids = new Set();
  for (const p of list) {
    const label = clean(p && p.label, 28).replace(/\s+/g, ' ').trim(), text = clean(p && p.text, 4000).trim(), scope = clean(p && p.scope, 600);
    if (!label || !text) continue;
    let id = clean(p.id, 24).replace(/[^\w-]/g, ''); if (!id || ids.has(id)) id = 'p' + Date.now().toString(36) + out.length; ids.add(id);
    out.push({ id, label, text, scope });
  }
  const cfg = load(); cfg.prompts = out; save(cfg); return { ok: true, prompts: out };
}
function resetPrompts() { const cfg = load(); delete cfg.prompts; save(cfg); return { ok: true, ...prompts() }; }

/* ---------- start a session in a terminal ---------- */
const TOOLS = { claude: { cmd: process.env.CLAUDE_BIN || 'claude', name: 'Claude Code', prompt: true }, codex: { cmd: 'codex', name: 'Codex', prompt: true }, gemini: { cmd: 'gemini', name: 'Gemini CLI', prompt: false }, grok: { cmd: 'grok', name: 'Grok Build', prompt: false } };
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const terminalName = () => process.env.PIXEL_OFFICE_TERMINAL || (process.platform === 'darwin' ? 'Terminal' : '');

const wrap = (root, run) => `#!/bin/sh\n# Pixel Office: open a session in a project. This file is temporary and removes itself.\nrm -f -- "$0"\ncd -- ${shq(root)} || { echo "Folder not found"; exit 1; }\nclear\n${run}\nexec "\${SHELL:-/bin/sh}" -l\n`;
function script(root, tool, prompt) { const t = TOOLS[tool]; return wrap(root, shq(t.cmd) + (prompt && t.prompt ? ' ' + shq(prompt) : '')); }
const launchProc = (cmd, args) => new Promise(res => { let done = false; const fin = v => { if (!done) { done = true; res(v); } }; try { const p = spawn(cmd, args, { detached: true, stdio: 'ignore' }); p.on('error', () => fin(false)); p.on('spawn', () => { p.unref(); fin(true); }); } catch { fin(false); } });
/* run a prepared script in a new terminal window (macOS / Linux) */
async function openTerminal(text) {
  fs.mkdirSync(RUN, { recursive: true, mode: 0o700 }); sweep();
  const file = path.join(RUN, `start-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.command`);
  fs.writeFileSync(file, text, { mode: 0o700 });
  if (process.platform === 'darwin') { const app = terminalName(); return (await launchProc('open', ['-a', app, file])) ? { ok: true, terminal: app } : { status: 500, error: `could not open ${app}` }; }
  const custom = terminalName(), cands = [...(custom ? [[custom, ['-e', file]]] : []), ['x-terminal-emulator', ['-e', file]], ['gnome-terminal', ['--', file]], ['konsole', ['-e', file]], ['xfce4-terminal', ['-x', file]], ['xterm', ['-e', file]]];
  for (const [cmd, args] of cands) if (await launchProc(cmd, args)) return { ok: true, terminal: cmd };
  try { fs.unlinkSync(file); } catch { /* gone */ } return { status: 500, error: 'no terminal program found (set PIXEL_OFFICE_TERMINAL)' };
}
/** Reopen a Claude Code session that is not running, in a terminal: `claude --resume <id>` in its folder. */
function resumeSession(meta) {
  if (!meta) return { status: 404, error: 'unknown session (it may have been closed)' };
  if (meta.provider && meta.provider !== 'claude') return { status: 400, error: 'only Claude Code sessions can be reopened from here' };
  if (meta.live) return { status: 409, error: 'this session is already open' };
  if (!/^[0-9a-fA-F-]{8,64}$/.test(String(meta.sessionId || ''))) return { status: 400, error: 'unexpected session id' };
  if (!meta.cwd || !path.isAbsolute(meta.cwd) || !isDir(meta.cwd)) return { status: 404, error: 'the session folder no longer exists' };
  if (process.platform === 'win32') { if (/["%!^&|<>\r\n]/.test(meta.cwd)) return { status: 400, error: 'this folder name cannot be opened safely on Windows' }; return launchProc('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${meta.cwd}" && ${TOOLS.claude.cmd} --resume ${meta.sessionId}`]).then(ok => ok ? { ok: true, terminal: 'Command Prompt' } : { status: 500, error: 'could not open a terminal' }); }
  return openTerminal(wrap(meta.cwd, `${shq(TOOLS.claude.cmd)} --resume ${shq(meta.sessionId)}`));
}
function sweep() { try { for (const f of fs.readdirSync(RUN)) { const p = path.join(RUN, f); if (Date.now() - fs.statSync(p).mtimeMs > 10 * 60e3) fs.unlinkSync(p); } } catch { /* nothing to clean */ } }

/** known: Set of project folders the office has seen. Returns { ok, terminal } or { status, error }. */
function startSession(body, known) {
  const root = String(body.root || ''), tool = String(body.tool || 'claude'), prompt = clean(body.prompt, 4000).trim();
  if (!TOOLS[tool]) return { status: 400, error: 'unknown tool' };
  if (!root || !path.isAbsolute(root) || !known.has(root)) return { status: 403, error: 'that folder is not a project the office knows' };
  if (!isDir(root)) return { status: 404, error: 'the project folder no longer exists' };
  const plat = process.platform, launch = launchProc;
  if (plat === 'win32') {                                             // no script file: cmd quoting is too fragile to carry a prompt
    if (/["%!^&|<>\r\n]/.test(root)) return { status: 400, error: 'this folder name cannot be opened safely on Windows' };
    return launch('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${root}" && ${TOOLS[tool].cmd}`]).then(ok => ok ? { ok: true, terminal: 'Command Prompt', promptUsed: false } : { status: 500, error: 'could not open a terminal' });
  }
  return openTerminal(script(root, tool, prompt)).then(r => r.ok ? { ...r, promptUsed: !!(prompt && TOOLS[tool].prompt) } : r);
}

module.exports = { prompts, setPrompts, resetPrompts, startSession, resumeSession, script, tools: () => Object.entries(TOOLS).map(([id, t]) => ({ id, name: t.name, prompt: t.prompt })), terminalName };
