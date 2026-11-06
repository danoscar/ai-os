'use strict';
/* =====================================================================
   Grok Bot desktop app provider (read-only, presence only).
   The Grok Bot app keeps a local execution daemon and writes a small status file:
     <data dir>/local-exec-daemon.json   {pid, startedAt, servingAt, inflightCount, generation}
   That is all we read: is it running, and are tasks in flight. Nothing else in that folder is opened
   (it also holds sealed credentials, settings and a log; those are deliberately never read).
   Data dir: GROKBOT_DIR, else ~/.grokbot.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../util');

const APP = /\/Grok Bot\.app\/Contents\/MacOS\/Grok Bot(\s|$)/;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function createGrokBot() {
  const dir = () => process.env.GROKBOT_DIR || path.join(os.homedir(), '.grokbot');
  function read() {
    const d = dir(); let j = null, mtime = 0;
    try { j = JSON.parse(fs.readFileSync(path.join(d, 'local-exec-daemon.json'), 'utf8')); mtime = fs.statSync(path.join(d, 'local-exec-daemon.json')).mtimeMs; } catch { /* app not installed / daemon not started */ }
    const daemonUp = !!(j && Number.isInteger(j.pid) && alive(j.pid)), appUp = U.procRunning(APP);
    if (!daemonUp && !appUp) return { sessions: [], subs: [], tokens: 0 };
    const inflight = daemonUp ? Math.max(0, Number(j.inflightCount) || 0) : 0, now = Date.now();
    const status = inflight > 0 ? 'working' : 'idle';
    const text = daemonUp ? (inflight > 0 ? `${inflight} local task${inflight > 1 ? 's' : ''} in flight` : 'local exec daemon up, no tasks in flight') : 'app running (daemon not started)';
    return { sessions: [{
      id: 'gb-app', sessionId: 'grokbot-app', provider: 'grokbot', kind: 'main', sleeping: false, pid: daemonUp ? j.pid : 0, project: 'Grok Bot', root: d, name: 'Grok Bot',
      status, waitingFor: '', since: (j && j.servingAt) || mtime || now, startedAt: (j && j.startedAt) || 0, entrypoint: 'desktop app',
      activity: { id: 'gb:' + inflight + ':' + status, text, at: now }, prompt: '', model: '', ctx: 0, tokens: 0, tools: 0, updatedAt: now
    }], subs: [], tokens: 0 };
  }
  return { read, messages: () => null, lookup: id => id === 'gb-app' ? { provider: 'grokbot', live: true, status: 'idle', cwd: '', file: '' } : null };
}
module.exports = { createGrokBot };
