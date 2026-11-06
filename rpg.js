'use strict';
/* =====================================================================
   PIXEL OFFICE — RPG engine (server side)
   Turns real activity seen by the observer into XP, plantings, harvests and level-ups.
   Progress is saved per user in ~/.pixel-office/rpg.json (never inside the project folder).
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./ui/rpg-core');

const FILE = path.join(os.homedir(), '.pixel-office', 'rpg.json');
const fresh = () => ({ v: 1, createdAt: Date.now(), company: { xp: 0, streak: 0, lastDay: '', today: { day: '', xp: 0 }, stats: { tools: 0, turns: 0, tokens: 0, approvals: 0, harvests: 0, coins: 0, planted: 0 } }, lands: {}, chars: {} });

class Rpg {
  constructor(file = FILE) {
    this.file = file; this.seen = new Map(); this.rem = new Map(); this.dirty = false; this.timer = null;
    try { this.s = JSON.parse(fs.readFileSync(file, 'utf8')); if (!this.s || this.s.v !== 1) this.s = fresh(); } catch { this.s = fresh(); }
    for (const k of ['company', 'lands', 'chars']) if (!this.s[k]) this.s[k] = fresh()[k];
  }

  /* ---------- persistence ---------- */
  touch() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.save(); }, 4000); if (this.timer.unref) this.timer.unref(); }
  save() {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 }); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 }); fs.renameSync(tmp, this.file); } catch { /* disk full / read-only: keep playing in memory */ }
  }
  reset() { this.s = fresh(); this.seen.clear(); this.rem.clear(); this.touch(); }

  /* ---------- awarding ---------- */
  land(root, name) { const l = this.s.lands[root] || (this.s.lands[root] = { name: name || path.basename(root), xp: 0, work: 0, plots: [], coins: 0, harvested: 0 }); if (name) l.name = name; return l; }
  char(id, name, project) { const c = this.s.chars[id] || (this.s.chars[id] = { xp: 0, name: '', project: '', at: 0 }); if (name) c.name = String(name).slice(0, 60); if (project) c.project = project; c.at = Date.now(); return c; }
  give(scope, obj, amount, label, evs) {
    if (!amount) return; const before = R.levelFor(obj.xp, scope); obj.xp += amount; const after = R.levelFor(obj.xp, scope);
    if (after > before) evs.push({ kind: 'levelup', scope, name: label, level: after, title: scope === 'char' ? R.titleFor(after) : undefined });
    this.touch();
  }
  dayBonus(now, evs) {
    const c = this.s.company, day = R.dayKey(now); if (c.today.day === day) return;
    const yest = R.dayKey(now - 86400e3); c.streak = c.lastDay === yest ? c.streak + 1 : 1; c.lastDay = day; c.today = { day, xp: 0 };
    const bonus = R.XP.day + Math.min(c.streak, R.XP.streakMax) * R.XP.streakStep; this.give('company', c, bonus, 'Daily bonus', evs); c.today.xp += bonus;
    evs.push({ kind: 'day', streak: c.streak, xp: bonus });
  }
  company(amount, evs) { this.give('company', this.s.company, amount, 'Company', evs); this.s.company.today.xp += amount; }

  /* ---------- planting + harvesting ---------- */
  plant(land, root, now, evs) {
    const L = R.levelFor(land.xp, 'land'); if (land.plots.length >= R.maxPlots(L)) return false;
    const used = new Set(land.plots.map(p => p.c)), free = []; R.CELLS.forEach((_, i) => { if (!used.has(i)) free.push(i); }); if (!free.length) return false;
    const unlocked = R.unlockedKinds(R.levelFor(this.s.company.xp)), special = unlocked[R.hash(root) % unlocked.length];
    const k = Math.random() < 0.6 ? special : unlocked[Math.floor(Math.random() * unlocked.length)];
    const c = free[Math.floor(Math.random() * free.length)]; land.plots.push({ c, k, at: now }); this.s.company.stats.planted++;
    evs.push({ kind: 'plant', root, name: land.name, cell: c, k }); this.touch(); return true;
  }
  harvest(now, evs) {
    for (const [root, land] of Object.entries(this.s.lands)) {
      for (let i = land.plots.length - 1; i >= 0; i--) {
        const p = land.plots[i]; if (now - p.at < R.GROW_MS + R.RIPE_HOLD_MS) continue;
        land.plots.splice(i, 1); const v = R.harvestValue(p.k); land.coins += v.coins; land.harvested++; this.s.company.stats.harvests++; this.s.company.stats.coins += v.coins;
        this.give('land', land, v.xp, land.name, evs); this.company(Math.ceil(v.xp / 2), evs); evs.push({ kind: 'harvest', root, name: land.name, cell: p.c, k: p.k, coins: v.coins });
      }
    }
  }

  /* ---------- the main entry: called once a second with the observer snapshot ---------- */
  tick(office, now = Date.now()) {
    const evs = [], items = [...(office.sessions || []), ...(office.subs || [])], present = new Set();
    for (const it of items) {
      present.add(it.id); const p = this.seen.get(it.id);
      if (!p || it.sleeping) { this.seen.set(it.id, { tools: it.tools || 0, tokens: it.tokens || 0, status: it.sleeping ? 'idle' : it.status }); continue; }
      const dTools = Math.max(0, (it.tools || 0) - p.tools), dTok = Math.max(0, (it.tokens || 0) - p.tokens), turn = p.status === 'working' && it.status !== 'working' ? 1 : 0;
      p.tools = it.tools || 0; p.tokens = it.tokens || 0; p.status = it.status;
      if (!dTools && !dTok && !turn) continue;
      this.dayBonus(now, evs);
      const rem = (this.rem.get(it.id) || 0) + dTok, tokXp = Math.floor(rem / R.XP.tokensPer) * R.XP.tokenXp; this.rem.set(it.id, rem % R.XP.tokensPer);
      const gain = dTools * R.XP.tool + turn * R.XP.turn + tokXp;
      const st = this.s.company.stats; st.tools += dTools; st.turns += turn; st.tokens += dTok;
      const land = this.land(it.root, it.project), ch = this.char(it.sessionId || it.id, it.name, it.project);
      this.company(gain, evs); this.give('land', land, gain, land.name, evs); this.give('char', ch, gain, it.name, evs);
      land.work += dTools + turn * 3; let n = 0; while (land.work >= R.WORK_PER_PLANT && n < 3) { land.work -= R.WORK_PER_PLANT; this.plant(land, it.root, now, evs); n++; }
      if (land.work > R.WORK_PER_PLANT * 6) land.work = R.WORK_PER_PLANT * 6;
    }
    for (const id of [...this.seen.keys()]) if (!present.has(id)) { this.seen.delete(id); this.rem.delete(id); }
    this.harvest(now, evs);
    return evs;
  }
  approval(root) { const evs = []; this.dayBonus(Date.now(), evs); this.s.company.stats.approvals++; this.company(R.XP.approval, evs); if (root && this.s.lands[root]) this.give('land', this.s.lands[root], R.XP.approval, this.s.lands[root].name, evs); return evs; }

  /* ---------- what the page gets ---------- */
  publicState(now = Date.now()) {
    const c = this.s.company, lands = {}, chars = {};
    for (const [root, l] of Object.entries(this.s.lands)) lands[root] = { name: l.name, ...R.progress(l.xp, 'land'), plots: l.plots, coins: l.coins, harvested: l.harvested };
    const cutoff = now - 14 * 86400e3;                                      // characters seen in the last two weeks
    for (const [id, ch] of Object.entries(this.s.chars)) if (ch.at > cutoff) { const pr = R.progress(ch.xp, 'char'); chars[id] = { name: ch.name, project: ch.project, ...pr, title: R.titleFor(pr.level) }; }
    return { now, company: { ...R.progress(c.xp, 'company'), streak: c.streak, today: c.today, stats: c.stats }, lands, chars };
  }
}
module.exports = { Rpg };
