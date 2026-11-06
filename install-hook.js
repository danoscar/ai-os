#!/usr/bin/env node
'use strict';
/* Adds / removes the Pixel Office PermissionRequest hook in Claude Code's settings.json.
     node install-hook.js                 install in every ~/.claude config dir that has sessions/
     node install-hook.js --uninstall     remove it again
     node install-hook.js --config-dir X  only that directory (used for testing)
   A timestamped backup of settings.json is written first. The hook is fail-safe (see hook/permission-hook.mjs). */
const fs = require('fs'), os = require('os'), path = require('path');
const HOOK = path.join(__dirname, 'hook', 'permission-hook.mjs');
const MARK = 'permission-hook.mjs';
const args = process.argv.slice(2), uninstall = args.includes('--uninstall');
const i = args.indexOf('--config-dir');
const dirs = i >= 0 ? [path.resolve(args[i + 1])] : fs.readdirSync(os.homedir()).filter(n => /^\.claude(-|$)/.test(n)).map(n => path.join(os.homedir(), n)).filter(d => fs.existsSync(path.join(d, 'sessions')));
if (!dirs.length) { console.error('no Claude Code config directory found'); process.exit(1); }

for (const dir of dirs) {
  const file = path.join(dir, 'settings.json');
  let text = '{}'; try { text = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  let cfg; try { cfg = JSON.parse(text || '{}'); } catch { console.error(`${file}: not valid JSON, leaving it alone`); continue; }
  const list = (cfg.hooks && Array.isArray(cfg.hooks.PermissionRequest)) ? cfg.hooks.PermissionRequest : [];
  const ours = g => g && Array.isArray(g.hooks) && g.hooks.some(h => typeof h.command === 'string' && h.command.includes(MARK));
  const has = list.some(ours);
  if (uninstall ? !has : has) { console.log(`${dir}: already ${uninstall ? 'clean' : 'installed'}`); continue; }
  fs.mkdirSync(dir, { recursive: true });
  if (text.trim()) fs.copyFileSync(file, `${file}.pixel-office.bak-${Date.now()}`);
  cfg.hooks = cfg.hooks || {};
  cfg.hooks.PermissionRequest = uninstall ? list.filter(g => !ours(g))
    : [...list, { matcher: '*', hooks: [{ type: 'command', command: `node "${HOOK}"`, timeout: 330, statusMessage: 'Waiting for an answer in Pixel Office (or answer here)' }] }];
  if (uninstall && !cfg.hooks.PermissionRequest.length) delete cfg.hooks.PermissionRequest;
  if (uninstall && cfg.hooks && !Object.keys(cfg.hooks).length) delete cfg.hooks;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${dir}: ${uninstall ? 'removed' : 'installed'} (backup saved next to settings.json)`);
}
console.log(uninstall ? 'Done. New sessions stop using the hook.' : 'Done. Applies to sessions started from now on (already-open sessions may need a restart).');
