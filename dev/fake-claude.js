#!/usr/bin/env node
'use strict';
/* Stand-in for the `claude` CLI so the Pixel Office bridge can be tested without a login.
   Emits the same stream-json shapes: assistant text/tool_use, then a result with permission_denials. */
const fs = require('fs'), os = require('os'), path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'fake' })); process.exit(0); }
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const mode = val('--permission-mode'), resume = val('--resume');
const allowed = argv.includes('--allowedTools') ? argv.slice(argv.indexOf('--allowedTools') + 1).filter(a => !a.startsWith('--')) : [];
const sid = resume || 'fake-' + Math.random().toString(36).slice(2, 10);
const memo = path.join(os.tmpdir(), sid + '.json');
let prompt = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => prompt += c);
const wait = ms => new Promise(r => setTimeout(r, ms));
const out = o => console.log(JSON.stringify({ session_id: sid, ...o }));
process.stdin.on('end', async () => {
  const first = resume ? JSON.parse(fs.readFileSync(memo, 'utf8')).prompt : prompt;
  if (!resume) fs.writeFileSync(memo, JSON.stringify({ prompt }));
  out({ type: 'system', subtype: 'init', cwd: process.cwd() });
  const say = text => out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  const tool = (name, input) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
  const usage = { input_tokens: 1800, output_tokens: 420, cache_creation_input_tokens: 5200, cache_read_input_tokens: 9000 };
  const result = (extra = {}) => out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.0123, usage, permission_denials: [], ...extra });
  await wait(400); say('Reading the task and looking around the workspace.');
  await wait(500); tool('Read', { file_path: 'README.md' });
  await wait(600);
  if (/fail-auth/.test(first)) return result({ is_error: true, result: 'Failed to authenticate: OAuth session expired' });
  if (mode === 'plan') {
    const plan = `1. Read the existing files for context\n2. ${/revise/i.test(prompt) ? 'Apply the operator feedback: ' + prompt.slice(0, 80) : 'Draft the deliverable for: ' + first.slice(0, 80)}\n3. Write the result to out.md`;
    return result({ result: plan, permission_denials: [{ tool_name: 'ExitPlanMode', tool_use_id: 't1', tool_input: { plan } }] });
  }
  if (/bash/i.test(first) && !allowed.some(a => a.startsWith('Bash'))) {
    tool('Bash', { command: 'ls -la' }); await wait(300);
    return result({ result: 'blocked', permission_denials: [{ tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'ls -la' } }] });
  }
  tool('Write', { file_path: 'out.md' }); await wait(600);
  say('Done. Wrote out.md.'); await wait(200);
  result({ result: 'Finished: wrote out.md with the requested content.' });
});
