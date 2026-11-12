'use strict';
/* =====================================================================
   PIXEL OFFICE — activity statistics (server side) for the Insights tab.
   Once a second it looks at the observer snapshot and adds up, per day / hour / project / provider:
     • agent-seconds spent working, waiting for YOU, and idle
     • tokens, tool calls and finished turns seen while the bridge runs
     • approvals you gave and how long sessions waited for them
   Saved per user in ~/.pixel-office/stats.json (30 days, never inside the project folder).
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.homedir(), '.pixel-office', 'stats.json');
const KEEP_DAYS = 30;
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blank = () => ({ h: Array.from({ length: 24 }, () => [0, 0, 0]), p: {}, pv: {}, tok: 0, tools: 0, turns: 0, appr: 0, apprMs: 0, peak: 0 });
const bucket = () => ({ w: 0, n: 0, i: 0, tok: 0, tools: 0, turns: 0, appr: 0 });

class Stats {
  constructor(file = FILE) {
    this.file = file; this.seen = new Map(); this.last = 0; this.dirty = false; this.savedAt = Date.now();
    try { this.s = JSON.parse(fs.readFileSync(file, 'utf8')); if (!this.s || this.s.v !== 1 || !this.s.days) throw 0; } catch { this.s = { v: 1, days: {} }; }
  }
  day(now) {
    const k = dayKey(now); let d = this.s.days[k];
    if (!d) { d = this.s.days[k] = blank(); const keys = Object.keys(this.s.days).sort(); while (keys.length > KEEP_DAYS) delete this.s.days[keys.shift()]; }
    return d;
  }
  save() {
    if (!this.dirty) return; this.dirty = false; this.savedAt = Date.now();
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 }); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 }); fs.renameSync(tmp, this.file); } catch { /* keep counting in memory */ }
  }
  reset() { this.s = { v: 1, days: {} }; this.seen.clear(); this.dirty = true; this.save(); }

  tick(office, now = Date.now()) {
    const dt = this.last ? Math.min(5, Math.max(0, (now - this.last) / 1000)) : 0; this.last = now;
    const d = this.day(now), hr = d.h[new Date(now).getHours()], items = [...(office.sessions || []), ...(office.subs || [])], present = new Set(); let busy = 0;
    for (const it of items) {
      present.add(it.id); const prev = this.seen.get(it.id);
      this.seen.set(it.id, { tools: it.tools || 0, tokens: it.tokens || 0, status: it.status });
      if (it.sleeping) continue;
      const name = String(it.project || 'unknown').slice(0, 60), p = d.p[name] || (d.p[name] = bucket()), pvn = it.provider || 'claude', pv = d.pv[pvn] || (d.pv[pvn] = bucket());
      const slot = it.status === 'working' ? 0 : it.status === 'waiting' ? 1 : 2, f = ['w', 'n', 'i'][slot];
      if (dt) { hr[slot] += dt; p[f] += dt; pv[f] += dt; this.dirty = true; }
      if (it.status === 'working') busy++;
      if (!prev) continue;
      const dTools = Math.max(0, (it.tools || 0) - prev.tools), dTok = Math.max(0, (it.tokens || 0) - prev.tokens), turn = prev.status === 'working' && it.status !== 'working' ? 1 : 0;
      if (dTools || dTok || turn) { for (const b of [d, p, pv]) { b.tok += dTok; b.tools += dTools; b.turns += turn; } this.dirty = true; }
    }
    for (const id of [...this.seen.keys()]) if (!present.has(id)) this.seen.delete(id);
    if (busy > d.peak) { d.peak = busy; this.dirty = true; }
    if (this.dirty && now - this.savedAt > 60000) this.save();
  }
  approval(project, waitedMs) {
    const d = this.day(Date.now()); d.appr++; d.apprMs += Math.max(0, Math.min(3600e3, Number(waitedMs) || 0));
    if (project) { const name = String(project).slice(0, 60); (d.p[name] || (d.p[name] = bucket())).appr++; }
    this.dirty = true;
  }

  publicState(now = Date.now()) {
    const today = dayKey(now), r = v => Math.round(v), days = [];
    for (let i = 13; i >= 0; i--) {
      const k = dayKey(now - i * 86400e3), d = this.s.days[k], sum = j => d ? r(d.h.reduce((a, h) => a + h[j], 0)) : 0;
      days.push({ day: k, w: sum(0), n: sum(1), i: sum(2), tok: d ? d.tok : 0, tools: d ? d.tools : 0, turns: d ? d.turns : 0, appr: d ? d.appr : 0, apprAvg: d && d.appr ? r(d.apprMs / d.appr / 1000) : 0, peak: d ? d.peak : 0 });
    }
    const t = this.s.days[today] || blank(), list = o => Object.entries(o).map(([name, b]) => ({ name, w: r(b.w), n: r(b.n), i: r(b.i), tok: b.tok, tools: b.tools, turns: b.turns, appr: b.appr })).sort((a, b) => (b.w + b.n) - (a.w + a.n) || b.tok - a.tok);
    const week = {}; for (let i = 0; i < 7; i++) { const d = this.s.days[dayKey(now - i * 86400e3)]; if (!d) continue; for (const [name, b] of Object.entries(d.p)) { const x = week[name] || (week[name] = bucket()); for (const f in x) x[f] += b[f] || 0; } }
    return { now, today, days, hours: t.h.map(h => h.map(r)), projects: list(t.p), providers: list(t.pv), week: list(week), tracked: Object.keys(this.s.days).length };
  }
}
module.exports = { Stats };
