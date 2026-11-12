#!/usr/bin/env node
'use strict';
/* Adds / removes Pixel Office's optional pieces in Claude Code's settings.json. Each one is opt-in:

     node install-hook.js                 approvals + questions: answer permission prompts and questions from the office
     node install-hook.js --inbox         also: message a session while it is busy (PostToolUse + Stop hooks)
     node install-hook.js --usage         also: subscription usage bars (wraps your status line command; yours keeps working)
     node install-hook.js --all           all three
     node install-hook.js --uninstall     remove everything Pixel Office added and restore your status line
     node install-hook.js --status        show what is installed
     node install-hook.js --config-dir X  only that directory (used for testing)

   A timestamped backup of settings.json is written before any change. Every hook is fail-safe: if the bridge is not
   running, or anything goes wrong, Claude Code behaves exactly as if the hook were not there. */
const fs = require('fs'), os = require('os'), path = require('path');
const HOOKS = path.join(__dirname, 'hook');
const PERM = { file: 'permission-hook.mjs', events: ['PermissionRequest'], entry: f => ({ matcher: '*', hooks: [{ type: 'command', command: `node "${f}"`, timeout: 330, statusMessage: 'Waiting for an answer in Pixel Office (or answer here)' }] }) };
const INBOX = { file: 'inbox-hook.mjs', events: ['PostToolUse', 'Stop'], entry: f => ({ matcher: '*', hooks: [{ type: 'command', command: `node "${f}"`, timeout: 10 }] }) };
const TAP = 'statusline-tap.mjs', STORE = path.join(os.homedir(), '.pixel-office', 'statusline.json');

const args = process.argv.slice(2), has = a => args.includes(a), uninstall = has('--uninstall'), statusOnly = has('--status');
const want = { perm: true, inbox: has('--inbox') || has('--all'), usage: has('--usage') || has('--all') };
const i = args.indexOf('--config-dir');
const dirs = i >= 0 ? [path.resolve(args[i + 1])] : fs.readdirSync(os.homedir()).filter(n => /^\.claude(-|$)/.test(n)).map(n => path.join(os.homedir(), n)).filter(d => fs.existsSync(path.join(d, 'sessions')));
if (!dirs.length) { console.error('no Claude Code config directory found'); process.exit(1); }

const loadStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) || {}; } catch { return {}; } };
const saveStore = s => { fs.mkdirSync(path.dirname(STORE), { recursive: true, mode: 0o700 }); if (Object.keys(s).length) fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); else try { fs.unlinkSync(STORE); } catch { /* none */ } };
const ours = mark => g => g && Array.isArray(g.hooks) && g.hooks.some(h => typeof h.command === 'string' && h.command.includes(mark));
const hasHook = (cfg, h) => h.events.every(ev => cfg.hooks && Array.isArray(cfg.hooks[ev]) && cfg.hooks[ev].some(ours(h.file)));
const hasTap = cfg => !!(cfg.statusLine && typeof cfg.statusLine.command === 'string' && cfg.statusLine.command.includes(TAP));

function setHook(cfg, h, on) {
  cfg.hooks = cfg.hooks || {};
  for (const ev of h.events) {
    const list = (Array.isArray(cfg.hooks[ev]) ? cfg.hooks[ev] : []).filter(g => !ours(h.file)(g));
    if (on) list.push(h.entry(path.join(HOOKS, h.file)));
    if (list.length) cfg.hooks[ev] = list; else delete cfg.hooks[ev];
  }
  if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
}
function setTap(cfg, dir, on) {
  const store = loadStore();
  if (on && !hasTap(cfg)) { store[dir] = cfg.statusLine || null; saveStore(store); cfg.statusLine = { ...(cfg.statusLine && typeof cfg.statusLine === 'object' ? cfg.statusLine : {}), type: 'command', command: `node "${path.join(HOOKS, TAP)}" "${dir}"` }; }
  else if (!on && hasTap(cfg)) { if (store[dir]) cfg.statusLine = store[dir]; else delete cfg.statusLine; delete store[dir]; saveStore(store); }
}

for (const dir of dirs) {
  const file = path.join(dir, 'settings.json');
  let text = '{}'; try { text = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  let cfg; try { cfg = JSON.parse(text || '{}'); } catch { console.error(`${file}: not valid JSON, leaving it alone`); continue; }
  const state = () => `approvals+questions ${hasHook(cfg, PERM) ? 'ON' : 'off'} · busy-session inbox ${hasHook(cfg, INBOX) ? 'ON' : 'off'} · usage bars ${hasTap(cfg) ? 'ON' : 'off'}`;
  if (statusOnly) { console.log(`${dir}: ${state()}`); continue; }
  const before = JSON.stringify(cfg);
  if (uninstall) { setHook(cfg, PERM, false); setHook(cfg, INBOX, false); setTap(cfg, dir, false); }
  else { if (!hasHook(cfg, PERM)) setHook(cfg, PERM, true); if (want.inbox && !hasHook(cfg, INBOX)) setHook(cfg, INBOX, true); if (want.usage) setTap(cfg, dir, true); }
  if (JSON.stringify(cfg) === before) { console.log(`${dir}: nothing to change (${state()})`); continue; }
  fs.mkdirSync(dir, { recursive: true });
  if (text.trim() && fs.existsSync(file)) fs.copyFileSync(file, `${file}.pixel-office.bak-${Date.now()}`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${dir}: ${uninstall ? 'removed' : 'updated'} → ${state()}  (backup saved next to settings.json)`);
}
if (!statusOnly) console.log(uninstall ? 'Done. New sessions stop using the hooks; your status line is back as it was.' : 'Done. Applies to sessions started from now on (already-open sessions may need a restart).');
