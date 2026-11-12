#!/usr/bin/env node
// Pixel Office — inbox hook (pure Node, no dependencies, no network).
//
// Lets you message a session that is BUSY. The office writes your text to
//   ~/.pixel-office/inbox/<session id>.json
// and this hook, which Claude Code runs after every tool call (PostToolUse) and when a turn ends (Stop),
// hands it to the session:
//   • PostToolUse → as extra context, so the session reads it at its next step
//   • Stop        → the turn continues with your message instead of ending
// With no message waiting it does nothing and exits at once (one file check).
// FAIL-SAFE: any error → exit silently, exactly as if this hook didn't exist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.pixel-office', 'inbox');

function readStdin() {
  return new Promise(ok => {
    let s = ''; const t = setTimeout(() => ok(null), 3000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { s += c; if (s.length > 8e6) { clearTimeout(t); ok(null); } });
    process.stdin.on('end', () => { clearTimeout(t); ok(s); });
    process.stdin.on('error', () => { clearTimeout(t); ok(null); });
  });
}

export function compose(messages) {
  const texts = messages.map(m => String(m && m.text || '').trim()).filter(Boolean); if (!texts.length) return '';
  return `The user sent ${texts.length > 1 ? 'these messages' : 'this message'} from Pixel Office while you were working. Treat ${texts.length > 1 ? 'them' : 'it'} as a new instruction from the user and take ${texts.length > 1 ? 'them' : 'it'} into account now:\n\n` + texts.map(t => t.slice(0, 4000)).join('\n\n---\n\n');
}

async function main() {
  if (!fs.existsSync(DIR)) return;                                       // nothing was ever queued: fastest exit
  const raw = await readStdin(); if (!raw) return;
  let input; try { input = JSON.parse(raw); } catch { return; }
  const sid = String(input && input.session_id || ''); if (!/^[\w-]{8,64}$/.test(sid)) return;
  if (input.agent_id) return;                                            // messages are for the main session, not its helpers
  const file = path.join(DIR, sid + '.json'); if (!fs.existsSync(file)) return;
  const claimed = `${file}.${process.pid}.taken`;
  try { fs.renameSync(file, claimed); } catch { return; }                // another hook run got it first
  let data; try { data = JSON.parse(fs.readFileSync(claimed, 'utf8')); } catch { data = null; }
  try { fs.unlinkSync(claimed); } catch { /* already gone */ }
  const text = compose(data && Array.isArray(data.messages) ? data.messages : []); if (!text) return;
  const ev = input.hook_event_name;
  if (ev === 'Stop') process.stdout.write(JSON.stringify({ decision: 'block', reason: text }));
  else if (ev === 'PostToolUse') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
}
main().catch(() => {}).finally(() => process.exit(0));
