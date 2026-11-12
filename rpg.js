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
    this.migrate();
  }

  /* ---------- persistence ---------- */
  touch() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.save(); }, 4000); if (this.timer.unref) this.timer.unref(); }
  save() {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 }); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 }); fs.renameSync(tmp, this.file); } catch { /* disk full / read-only: keep playing in memory */ }
  }
  reset() { this.s = fresh(); this.seen.clear(); this.rem.clear(); this.touch(); }

  /* ---------- plots are permanent ---------- */
  pickKind(root) { const unlocked = R.unlockedKinds(R.levelFor(this.s.company.xp)), special = unlocked[R.hash(root) % unlocked.length]; return Math.random() < 0.6 ? special : unlocked[Math.floor(Math.random() * unlocked.length)]; }
  freeCell(land) { const used = new Set(land.plots.map(p => p.c)), free = []; R.CELLS.forEach((_, i) => { if (!used.has(i)) free.push(i); }); return free.length ? free[Math.floor(Math.random() * free.length)] : -1; }
  fill(land, root, target, now) {              // add plots (at mixed ages) until the land holds `target`
    target = Math.min(target, R.maxPlots(R.levelFor(land.xp, 'land')), R.CELLS.length); let added = 0;
    while (land.plots.length < target) { const c = this.freeCell(land); if (c < 0) break; land.plots.push({ c, k: this.pickKind(root), at: now - Math.random() * R.GROW_MS * 1.4 }); added++; }
    return added;
  }
  /* older saves removed a crop when it was harvested: give back everything that was earned */
  migrate() {
    if (this.s.m2) return; const now = Date.now();
    for (const [root, l] of Object.entries(this.s.lands)) this.fill(l, root, Math.max(R.STARTER_PLOTS, l.plots.length + (l.harvested || 0)), now);
    this.s.m2 = true; this.touch();
  }

  /* ---------- awarding ---------- */
  land(root, name, now = Date.now()) {
    let l = this.s.lands[root];
    if (!l) { l = this.s.lands[root] = { name: name || path.basename(root), xp: 0, work: 0, plots: [], coins: 0, harvested: 0 }; this.fill(l, root, R.STARTER_PLOTS, now); this.touch(); }
    if (name) l.name = name; return l;
  }
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
  /* one unit of "planting", triggered by real work:
     1. the oldest ripe plot is harvested (coins + XP) and regrows in the same place, maybe as a better kind
     2. while the land has room (its level decides how much), one more plot is opened
     Nothing is ever removed, so a land always shows everything it has earned. */
  plant(land, root, now, evs) {
    let did = false;
    const ripe = land.plots.filter(p => now - p.at >= R.GROW_MS).sort((a, b) => a.at - b.at)[0];
    if (ripe) {
      const v = R.harvestValue(ripe.k); land.coins += v.coins; land.harvested++; this.s.company.stats.harvests++; this.s.company.stats.coins += v.coins;
      evs.push({ kind: 'harvest', root, name: land.name, cell: ripe.c, k: ripe.k, coins: v.coins });
      ripe.k = this.pickKind(root); ripe.at = now; ripe.n = (ripe.n || 0) + 1;
      this.give('land', land, v.xp, land.name, evs); this.company(Math.ceil(v.xp / 2), evs); did = true;
    }
    if (land.plots.length < R.maxPlots(R.levelFor(land.xp, 'land'))) {
      const c = this.freeCell(land);
      if (c >= 0) { const k = this.pickKind(root); land.plots.push({ c, k, at: now }); this.s.company.stats.planted++; evs.push({ kind: 'plant', root, name: land.name, cell: c, k }); did = true; }
    }
    if (did) this.touch(); return did;
  }

  /* ---------- the main entry: called once a second with the observer snapshot ---------- */
  tick(office, now = Date.now()) {
    const evs = [], items = [...(office.sessions || []), ...(office.subs || [])], present = new Set();
    for (const it of items) {
      present.add(it.id); const p = this.seen.get(it.id);
      if (it.root) this.land(it.root, it.project, now);                  // every project in the office owns a land from the first moment
      if (!p || it.sleeping) { this.seen.set(it.id, { tools: it.tools || 0, tokens: it.tokens || 0, status: it.sleeping ? 'idle' : it.status }); continue; }
      const dTools = Math.max(0, (it.tools || 0) - p.tools), dTok = Math.max(0, (it.tokens || 0) - p.tokens), turn = p.status === 'working' && it.status !== 'working' ? 1 : 0;
      p.tools = it.tools || 0; p.tokens = it.tokens || 0; p.status = it.status;
      if (!dTools && !dTok && !turn) continue;
      this.dayBonus(now, evs);
      const rem = (this.rem.get(it.id) || 0) + dTok, tokXp = Math.floor(rem / R.XP.tokensPer) * R.XP.tokenXp; this.rem.set(it.id, rem % R.XP.tokensPer);
      const gain = dTools * R.XP.tool + turn * R.XP.turn + tokXp;
      const st = this.s.company.stats; st.tools += dTools; st.turns += turn; st.tokens += dTok;
      const land = this.land(it.root, it.project, now), ch = this.char(it.sessionId || it.id, it.name, it.project);
      this.company(gain, evs); this.give('land', land, gain, land.name, evs); this.give('char', ch, gain, it.name, evs);
      land.work += dTools + turn * 3; let n = 0; while (land.work >= R.WORK_PER_PLANT && n < 3) { land.work -= R.WORK_PER_PLANT; this.plant(land, it.root, now, evs); n++; }
      if (land.work > R.WORK_PER_PLANT * 6) land.work = R.WORK_PER_PLANT * 6;
    }
    for (const id of [...this.seen.keys()]) if (!present.has(id)) { this.seen.delete(id); this.rem.delete(id); }
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
