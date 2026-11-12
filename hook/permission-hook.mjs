#!/usr/bin/env node
// Pixel Office — PermissionRequest hook (pure Node, no dependencies, talks only to 127.0.0.1).
//
// Claude Code runs this when a session is about to ask "Do you want to…?". The hook:
//   1. reads the request JSON from stdin,
//   2. registers it with the Pixel Office bridge (POST /api/hook/permission),
//   3. waits (long-polling) for you to press Allow / Deny in the office,
//   4. prints the decision for Claude Code.
// FAIL-SAFE: bridge not running, no office page open, timeout or ANY error → exit silently without
// deciding, so the normal terminal prompt works exactly as if this hook didn't exist.
// (The terminal prompt stays visible; whichever you answer first wins.)
const PORT = Number(process.env.PIXEL_OFFICE_PORT) || 8787;
const TIMEOUT_S = Math.min(3600, Math.max(5, Number(process.env.PIXEL_OFFICE_PERMISSION_TIMEOUT) || 300));
const BASE = `http://127.0.0.1:${PORT}`;
const debug = process.env.PIXEL_OFFICE_HOOK_DEBUG === '1' ? m => process.stderr.write(`[pixel-office-hook] ${m}\n`) : () => {};

const trim = (v, max = 4000, d = 0) => typeof v === 'string' ? v.slice(0, max) : (d > 6 || v === null || typeof v !== 'object') ? v
  : Array.isArray(v) ? v.slice(0, 100).map(x => trim(x, max, d + 1)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, max, d + 1)]));

async function call(method, path, body, ms) {
  try {
    const r = await fetch(BASE + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
    return await r.json();
  } catch (e) { debug(`${method} ${path}: ${e.message}`); return null; }
}

function readStdin() {
  return new Promise(ok => {
    let s = ''; const t = setTimeout(() => ok(null), 5000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { s += c; if (s.length > 4e6) { clearTimeout(t); ok(null); } });
    process.stdin.on('end', () => { clearTimeout(t); ok(s); });
    process.stdin.on('error', () => { clearTimeout(t); ok(null); });
  });
}

export function output(res) {
  if (!res || res.status !== 'decided') return null;
  if (res.behavior === 'allow') {
    const decision = { behavior: 'allow' };
    if (res.updatedPermissions) decision.updatedPermissions = res.updatedPermissions;
    if (res.updatedInput && typeof res.updatedInput === 'object') decision.updatedInput = res.updatedInput;       // answers to an AskUserQuestion
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  if (res.behavior === 'deny') {
    const why = typeof res.message === 'string' && res.message.trim() ? `: ${res.message.trim().slice(0, 500)}` : '';
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied by the operator in Pixel Office' + why } } };
  }
  return null;
}

async function main() {
  const raw = await readStdin(); if (!raw) return;
  let input; try { input = JSON.parse(raw); } catch { return; }
  if (!input || !input.tool_name) return;
  const isQuestion = input.tool_name === 'AskUserQuestion';                              // answered in the office as buttons; the terminal prompt still works
  if (isQuestion && (process.env.PIXEL_OFFICE_QUESTIONS === '0' || !input.tool_input || !Array.isArray(input.tool_input.questions))) return;
  const reg = await call('POST', '/api/hook/permission', {
    session_id: input.session_id, agent_id: input.agent_id, cwd: input.cwd, tool_name: input.tool_name,
    tool_input: isQuestion ? input.tool_input : trim(input.tool_input ?? {}), permission_suggestions: Array.isArray(input.permission_suggestions) ? input.permission_suggestions : []
  }, 2000);
  if (!reg || !reg.ok) return;                                                           // bridge down / no page open → terminal decides
  const deadline = Date.now() + TIMEOUT_S * 1000;
  while (Date.now() < deadline) {
    const res = await call('GET', `/api/hook/permission/${encodeURIComponent(reg.id)}/wait`, null, 30000);
    if (!res || res.status === 'gone') return;
    if (res.status === 'decided') { const out = output(res); if (out) process.stdout.write(JSON.stringify(out)); return; }
  }
}
main().catch(() => {}).finally(() => process.exit(0));
