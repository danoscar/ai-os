#!/usr/bin/env node
// Pixel Office — status line tap (pure Node, no dependencies, no network).
//
// Claude Code tells the status line command how much of your subscription limits is used
// (rate_limits.five_hour / seven_day). Nothing else exposes that, so this small wrapper:
//   1. copies only those numbers to ~/.pixel-office/usage.json for the office header
//   2. runs YOUR original status line command with the same input and prints what it prints
// If you had no status line, it prints nothing. Any error → your status line is still shown.
// Installed and removed by:  node install-hook.js --usage   /   node install-hook.js --uninstall
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DIR = path.join(os.homedir(), '.pixel-office'), OUT = path.join(DIR, 'usage.json'), STORE = path.join(DIR, 'statusline.json');

export function pick(input) {
  const rl = input && input.rate_limits; if (!rl || typeof rl !== 'object') return null;
  const win = w => (w && Number.isFinite(Number(w.used_percentage))) ? { used: Math.max(0, Math.min(100, Number(w.used_percentage))), resetsAt: Number(w.resets_at) || 0 } : null;
  const five = win(rl.five_hour), week = win(rl.seven_day); return five || week ? { at: Date.now(), five, week } : null;
}

const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('error', () => finish(Buffer.alloc(0)));
process.stdin.on('end', () => finish(Buffer.concat(chunks)));
setTimeout(() => finish(Buffer.concat(chunks)), 2500).unref();

let done = false;
function finish(buf) {
  if (done) return; done = true;
  try { const u = pick(JSON.parse(buf.toString('utf8'))); if (u) { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); const tmp = `${OUT}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(u), { mode: 0o600 }); fs.renameSync(tmp, OUT); } } catch { /* never break the status line */ }
  let orig = null; try { const s = JSON.parse(fs.readFileSync(STORE, 'utf8')); orig = s[process.argv[2] || ''] || null; } catch { /* no original */ }
  if (!orig || typeof orig.command !== 'string' || !orig.command.trim()) return process.exit(0);
  try {
    const p = spawn(orig.command, { shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
    p.on('error', () => process.exit(0)); p.on('close', code => process.exit(code || 0));
    p.stdin.on('error', () => {}); p.stdin.end(buf);
  } catch { process.exit(0); }
}
