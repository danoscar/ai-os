#!/usr/bin/env node
'use strict';
/* =====================================================================
   PIXEL OFFICE — run the bridge in the background, without a terminal.

     node service.js install [--port 8787] [--notify]   start now + at every login
     node service.js uninstall                          stop it and remove every trace of the service
     node service.js status                             installed? running? where are the logs?
     node service.js restart | stop | start
     node service.js logs                               print the tail of the log
     node service.js open                               open the office in your browser
     node service.js print                              show the service file without installing anything

   It is a per-user service (no sudo, no admin rights):
     macOS    ~/Library/LaunchAgents/com.pixeloffice.bridge.plist      (launchd)
     Linux    ~/.config/systemd/user/pixel-office.service              (systemd --user)
     Windows  a "PixelOffice" task that runs at logon                  (Task Scheduler)
   Logs go to ~/.pixel-office/logs/bridge.log. Nothing is written inside the project folder.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = __dirname, HOME = os.homedir(), PLAT = process.platform;
const LABEL = 'com.pixeloffice.bridge', UNIT = 'pixel-office.service', TASK = 'PixelOffice';
const DATA = path.join(HOME, '.pixel-office'), LOGDIR = path.join(DATA, 'logs'), LOG = path.join(LOGDIR, 'bridge.log');
const PLIST = path.join(HOME, 'Library', 'LaunchAgents', LABEL + '.plist');
const UNITFILE = path.join(HOME, '.config', 'systemd', 'user', UNIT);
const VBS = path.join(DATA, 'pixel-office.vbs');
const uid = () => (os.userInfo().uid);

const run = (cmd, args, quiet) => { try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }) }; } catch (e) { if (!quiet) return { ok: false, out: String((e.stderr || '') + (e.stdout || '') || e.message) }; return { ok: false, out: '' }; } };
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const xml = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function options(argv) {
  const i = argv.indexOf('--port'), port = i >= 0 ? Number(argv[i + 1]) : Number(process.env.PORT) || 8787;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('--port must be a number between 1024 and 65535'); process.exit(2); }
  return { port, notify: argv.includes('--notify') };
}
/* the service starts with an almost empty environment, so remember the PATH that can find `claude`, `gh`, `glab` */
function env(o) {
  const e = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', PORT: String(o.port), PIXEL_OFFICE_SERVICE: '1', PIXEL_OFFICE_LOG: LOG };
  if (o.notify) e.PIXEL_OFFICE_NOTIFY = '1';
  for (const k of ['PIXEL_OFFICE_TERMINAL', 'CLAUDE_BIN', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GEMINI_DIR', 'GROK_HOME', 'GROKBOT_DIR', 'GITLAB_HOST', 'TOKEN_BUDGET']) if (process.env[k]) e[k] = process.env[k];
  return e;                                    // tokens (GITHUB_TOKEN, GITLAB_TOKEN) are deliberately NOT copied into the service file
}

const files = {
  darwin: o => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(ROOT, 'server.js'))}</string></array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key><dict>
${Object.entries(env(o)).map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict></plist>
`,
  linux: o => `[Unit]
Description=Pixel Office bridge (local dashboard for AI coding sessions)
After=default.target

[Service]
ExecStart="${process.execPath}" "${path.join(ROOT, 'server.js')}"
WorkingDirectory=${ROOT}
${Object.entries(env(o)).map(([k, v]) => `Environment="${k}=${String(v).replace(/"/g, '\\"')}"`).join('\n')}
Restart=on-failure
RestartSec=10
StandardOutput=append:${LOG}
StandardError=append:${LOG}

[Install]
WantedBy=default.target
`,
  win32: o => `' Pixel Office: start the bridge hidden (no console window). Created by service.js; remove with: node service.js uninstall
Set sh = CreateObject("WScript.Shell")
Set e = sh.Environment("PROCESS")
${Object.entries(env(o)).filter(([k]) => k !== 'PATH').map(([k, v]) => `e("${k}") = "${String(v).replace(/"/g, '""')}"`).join('\r\n')}
sh.CurrentDirectory = "${ROOT.replace(/"/g, '""')}"
sh.Run """${process.execPath}"" ""${path.join(ROOT, 'server.js')}""", 0, False
`
};
const fileFor = { darwin: PLIST, linux: UNITFILE, win32: VBS };

function installed() { return !!fileFor[PLAT] && fs.existsSync(fileFor[PLAT]); }
function running() {
  if (PLAT === 'darwin') { const r = run('launchctl', ['print', `gui/${uid()}/${LABEL}`], true); const m = /pid = (\d+)/.exec(r.out); return r.ok && m ? Number(m[1]) : 0; }
  if (PLAT === 'linux') { const r = run('systemctl', ['--user', 'show', UNIT, '-p', 'MainPID', '--value'], true); return r.ok ? Number(r.out.trim()) || 0 : 0; }
  if (PLAT === 'win32') { const r = run('wmic', ['process', 'where', "name='node.exe'", 'get', 'ProcessId,CommandLine'], true); const l = r.out.split(/\r?\n/).find(x => x.includes(path.join(ROOT, 'server.js'))); const m = l && /(\d+)\s*$/.exec(l.trim()); return m ? Number(m[1]) : 0; }
  return 0;
}
function portOf() { try { const t = fs.readFileSync(fileFor[PLAT], 'utf8'); const m = /PORT<\/key><string>(\d+)|PORT=(\d+)|e\("PORT"\) = "(\d+)/.exec(t); return m ? Number(m[1] || m[2] || m[3]) : 8787; } catch { return Number(process.env.PORT) || 8787; } }

function start() {
  if (PLAT === 'darwin') {                     // launchd unloads asynchronously: right after a stop, "bootstrap" answers "Input/output error" for a moment
    let r; for (let i = 0; i < 8; i++) { r = run('launchctl', ['bootstrap', `gui/${uid()}`, PLIST]); if (r.ok || !/Input\/output error/i.test(r.out)) break; if (running()) { r = { ok: true, out: '' }; break; } sleep(700); }
    if (!r.ok && !/already|service is loaded/i.test(r.out)) r = run('launchctl', ['load', '-w', PLIST]); else r = { ok: true, out: '' };
    run('launchctl', ['kickstart', `gui/${uid()}/${LABEL}`], true); return r;
  }
  if (PLAT === 'linux') { run('systemctl', ['--user', 'daemon-reload']); return run('systemctl', ['--user', 'enable', '--now', UNIT]); }
  if (PLAT === 'win32') return run('schtasks', ['/Run', '/TN', TASK]);
  return { ok: false, out: 'unsupported platform' };
}
function stop() {
  if (PLAT === 'darwin') {
    const r = run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`]), gone = () => !run('launchctl', ['print', `gui/${uid()}/${LABEL}`], true).ok;
    if (!r.ok && !/No such process|not find|Could not find/i.test(r.out)) return run('launchctl', ['unload', '-w', PLIST]);
    for (let i = 0; i < 20 && !gone(); i++) sleep(250);            // wait until launchd has really let go of it
    return { ok: true, out: '' };
  }
  if (PLAT === 'linux') return run('systemctl', ['--user', 'disable', '--now', UNIT]);
  if (PLAT === 'win32') { const pid = running(); if (pid) run('taskkill', ['/PID', String(pid), '/F'], true); return { ok: true, out: '' }; }
  return { ok: false, out: 'unsupported platform' };
}

function install(o) {
  if (!files[PLAT]) { console.error(`No service support for "${PLAT}". Run "node server.js" under your own process manager instead.`); process.exit(1); }
  fs.mkdirSync(LOGDIR, { recursive: true }); fs.mkdirSync(path.dirname(fileFor[PLAT]), { recursive: true });
  if (installed()) stop();
  fs.writeFileSync(fileFor[PLAT], files[PLAT](o), { mode: 0o600 });
  if (PLAT === 'win32') { const r = run('schtasks', ['/Create', '/TN', TASK, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F', '/TR', `wscript.exe "${VBS}"`]); if (!r.ok) { console.error(r.out); process.exit(1); } }
  const r = start(); if (!r.ok) { console.error('Could not start the service:\n' + r.out); process.exit(1); }
  console.log(`\n  Pixel Office now runs in the background and starts again at every login.\n`);
  console.log(`  open       →  http://localhost:${o.port}`);
  console.log(`  service    →  ${fileFor[PLAT]}`);
  console.log(`  logs       →  ${LOG}`);
  console.log(`  remove it  →  node service.js uninstall     (or: npm run service:uninstall)\n`);
  if (PLAT === 'linux') console.log('  Linux: it runs while you are logged in. To keep it running after logout:  loginctl enable-linger "$USER"\n');
  if (o.notify) console.log('  Desktop notifications are ON: you are told when a session needs you and no office tab is open.\n');
}
function uninstall() {
  if (!installed()) { console.log('The service is not installed. Nothing to remove.'); return; }
  stop();
  if (PLAT === 'win32') run('schtasks', ['/Delete', '/TN', TASK, '/F'], true);
  try { fs.unlinkSync(fileFor[PLAT]); } catch { /* already gone */ }
  if (PLAT === 'linux') run('systemctl', ['--user', 'daemon-reload'], true);
  console.log(`\n  Service removed: the bridge is stopped and will not start at login any more.`);
  console.log(`  Kept on purpose (your data):  ${DATA}   — delete that folder too if you want no trace at all.`);
  console.log(`  You can still run it by hand:  node server.js\n`);
}
function status() {
  const pid = running(), port = portOf();
  console.log(`\n  installed  →  ${installed() ? 'yes  (' + fileFor[PLAT] + ')' : 'no'}`);
  console.log(`  running    →  ${pid ? 'yes  (pid ' + pid + ')' : 'no'}`);
  if (installed()) { console.log(`  address    →  http://localhost:${port}`); console.log(`  logs       →  ${LOG}\n`); } else console.log(`\n  Install it with:  node service.js install\n`);
}
function logs() { try { const t = fs.readFileSync(LOG, 'utf8').split('\n'); console.log(t.slice(-60).join('\n')); } catch { console.log('No log yet: ' + LOG); } }
function open() { const u = `http://localhost:${portOf()}`; const [c, a] = PLAT === 'darwin' ? ['open', [u]] : PLAT === 'win32' ? ['cmd', ['/c', 'start', '', u]] : ['xdg-open', [u]]; try { spawn(c, a, { detached: true, stdio: 'ignore' }).unref(); } catch { /* print it instead */ } console.log(u); }

module.exports = { installed, running, portOf, LOG, file: () => fileFor[PLAT] || null, platform: PLAT };

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2), o = options(rest);
  switch (cmd) {
    case 'install': install(o); break;
    case 'uninstall': case 'remove': uninstall(); break;
    case 'status': status(); break;
    case 'start': if (!installed()) { console.error('Not installed. Run: node service.js install'); process.exit(1); } { const r = start(); console.log(r.ok ? 'started' : r.out); } break;
    case 'stop': { const r = stop(); console.log(r.ok ? 'stopped (it starts again at next login; use "uninstall" to remove it)' : r.out); } break;
    case 'restart': if (!installed()) { console.error('Not installed. Run: node service.js install'); process.exit(1); } stop(); { const r = start(); console.log(r.ok ? 'restarted' : r.out); } break;
    case 'logs': logs(); break;
    case 'open': open(); break;
    case 'print': if (!files[PLAT]) { console.error('unsupported platform'); process.exit(1); } console.log('# ' + fileFor[PLAT] + '\n' + files[PLAT](o)); break;
    default: console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 19).map(l => l.replace(/^ {3}/, '')).join('\n'));
  }
}
