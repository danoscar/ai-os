'use strict';
/* Shared helpers for the session providers (Claude Code, Codex, Gemini). Zero dependencies. */
const fs = require('fs');
const { execFileSync } = require('child_process');

const SECRET = [
  [/(Bearer\s+)[A-Za-z0-9._~+\/=-]{12,}/gi, '$1***'],
  [/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g, '***'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***'],
  [/(:\/\/[^\s:@\/]+:)[^\s@\/]+@/g, '$1***@'],
  [/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|KEY)\s*=\s*)\S+/g, '$1***'],
  [/(\s-p\s*|--password[= ]|-u\s+[^\s:]+:)\S+/g, '$1***']
];
const mask = s => SECRET.reduce((t, [re, rep]) => t.replace(re, rep), String(s));
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const TAIL = 256 * 1024, MAX_CHUNK = 2 * 1024 * 1024;

/** Incremental JSONL reader: first poll = the last 256 KB (activity only, nothing counted); later polls = only appended bytes. */
class JsonlTail {
  constructor(file) { this.file = file; this.offset = -1; this.lastAt = 0; }
  poll() {
    let st; try { st = fs.statSync(this.file); } catch { return false; }
    this.lastAt = st.mtimeMs;
    const first = this.offset < 0;
    if (!first && st.size === this.offset) return false;
    let from = first ? Math.max(0, st.size - TAIL) : this.offset;
    if (st.size < from) from = Math.max(0, st.size - TAIL);
    if (st.size - from > MAX_CHUNK) from = st.size - MAX_CHUNK;
    const len = st.size - from; if (len <= 0) { this.offset = st.size; return false; }
    const buf = Buffer.alloc(len); let fd;
    try { fd = fs.openSync(this.file, 'r'); fs.readSync(fd, buf, 0, len, from); } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
    let text = buf.toString('utf8'); const cut = text.lastIndexOf('\n');
    if (cut < 0) return false;
    this.offset = from + Buffer.byteLength(text.slice(0, cut + 1)); text = text.slice(0, cut);
    if (from > 0 && first) text = text.slice(text.indexOf('\n') + 1);
    for (const line of text.split('\n')) if (line) this.line(line, !first);
    return true;
  }
  line() { /* subclass */ }
}

function readHead(file, n) {
  let fd; try { fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size, b = Buffer.alloc(Math.min(n, size)); fs.readSync(fd, b, 0, b.length, 0); return b.toString('utf8'); } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function readTailText(file, n) {
  let fd; try { fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size, len = Math.min(n, size), b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, size - len); return { text: b.toString('utf8'), partial: size > len }; } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Is a process whose command line matches `re` running? (macOS/Linux; cached for 5 s). Windows: always false. */
let ps = { at: 0, list: '' };
function procRunning(re) {
  if (process.platform === 'win32') return false;
  if (Date.now() - ps.at > 5000) { try { ps.list = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8', timeout: 2000, maxBuffer: 8e6 }); } catch { ps.list = ''; } ps.at = Date.now(); }
  return re.test(ps.list);
}

const SLEEP_MS = 24 * 3600e3, SLEEP_MAX = 12;
/** Sessions without a registry: working when the file just changed, live-idle while the tool's process runs, otherwise sleeping. */
function statusFor(mtime, now, running) {
  const age = now - mtime;
  if (age < 20000) return { status: 'working', sleeping: false };
  if (running && age < 30 * 60e3) return { status: 'idle', sleeping: false };
  return age < SLEEP_MS ? { status: 'idle', sleeping: true } : null;
}

const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (b && typeof b.text === 'string') ? b.text : '').join('') : '';
const INJECTED = /^\s*(<[A-Za-z_][\w-]*[\s>]|# AGENTS\.md|# Context from my IDE|<environment_context>)/;
const modelName = m => clip(String(m || '').replace(/^models\//, ''), 22) || '?';

module.exports = { mask, clip, JsonlTail, readHead, readTailText, procRunning, statusFor, SLEEP_MS, SLEEP_MAX, textOf, INJECTED, modelName };
