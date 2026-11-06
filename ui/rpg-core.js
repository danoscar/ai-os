/* =====================================================================
   PIXEL OFFICE — RPG core (shared by the server and the page; pure functions, no I/O)

   Three things level up:
     • the COMPANY  (everything you do together)
     • each LAND    (one per project: its plots grow and it unlocks more crops / modules)
     • each CHARACTER (one per session: gets a title, and a badge)
   XP comes from real work: tool calls, finished turns, tokens, answering approvals, harvests and daily streaks.
   ===================================================================== */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.RPGCORE = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- XP rules (the numbers are all here, tweak freely) ---- */
  const XP = { tool: 1, turn: 8, tokensPer: 2000, tokenXp: 1, approval: 3, day: 20, streakStep: 5, streakMax: 10, harvestBase: 12, harvestPerTier: 4 };
  const WORK_PER_PLANT = 5;            // work units (tool call = 1, finished turn = 3) needed to plant one new thing
  const GROW_MS = 15 * 60e3;           // seed → ripe
  const RIPE_HOLD_MS = 8 * 60e3;       // how long it stays ripe before it is harvested / shipped
  const STAGES = 4;                    // 0 seed, 1 sprout, 2 growing, 3 ripe

  /* ---- levels: xp needed to REACH level L is  scale * (L-1)^2  ---- */
  const SCALE = { company: 60, land: 40, char: 40 };
  const xpFor = (L, scope = 'company') => Math.round(SCALE[scope] * Math.pow(Math.max(0, L - 1), 2));
  function levelFor(xp, scope = 'company') { let L = 1; while (xp >= xpFor(L + 1, scope) && L < 99) L++; return L; }
  function progress(xp, scope = 'company') { const L = levelFor(xp, scope), lo = xpFor(L, scope), hi = xpFor(L + 1, scope); return { level: L, xp, lo, hi, pct: hi > lo ? (xp - lo) / (hi - lo) : 1 }; }

  const TITLES = ['Intern', 'Junior', 'Associate', 'Mid-level', 'Senior', 'Staff', 'Lead', 'Principal', 'Director', 'Legend'];
  const titleFor = L => TITLES[Math.min(TITLES.length - 1, Math.floor((L - 1) / 2))];
  const CHAR_PERKS = [[2, 'Name badge'], [4, 'Colored headband / hat band'], [6, 'Glow ring when working'], [8, 'Golden nameplate'], [10, 'Legend aura']];

  /* ---- what is planted: tier k (0..7). Farm calls them crops, space calls them modules, office doesn't plant ---- */
  const KIND_UNLOCK = [1, 2, 4, 5, 6, 7, 8, 10];                 // company level that unlocks tier k
  const CROPS = ['Wheat', 'Carrot', 'Corn', 'Tomato', 'Pumpkin', 'Sunflower', 'Strawberry', 'Golden apple'];
  const MODULES = ['Solar array', 'Habitat dome', 'Antenna mast', 'Science lab', 'Hydroponics bay', 'Fusion reactor', 'Observatory', 'Mega-dome'];
  const unlockedKinds = L => KIND_UNLOCK.map((u, k) => (L >= u ? k : -1)).filter(k => k >= 0);

  /* ---- plots: the free tiles of a 7x7 room (desks and walkways excluded) ---- */
  const CELLS = (() => { const o = []; for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 7; rx++) if (rx <= 1 || ry === 0 || ry === 3 || (rx === 4 && ry !== 0 && ry !== 6)) o.push([rx, ry]); return o; })();
  const maxPlots = landLevel => Math.min(CELLS.length, 6 + 3 * landLevel);
  const stageOf = (p, now) => { const age = now - p.at; return age >= GROW_MS ? STAGES - 1 : Math.min(STAGES - 2, Math.floor(age / (GROW_MS / (STAGES - 1)))); };
  const harvestValue = k => ({ coins: 5 + 3 * k, xp: XP.harvestBase + XP.harvestPerTier * k });

  /* ---- perks (what each company level unlocks, per skin) ---- */
  const PERKS = {
    office: [[2, 'Extra plants along the walls'], [3, 'Coffee machine in every room'], [5, 'Neon sign over the hub'], [6, 'Office cat wanders the hallways'], [8, 'Gold trim on every desk'], [10, 'Party lights over the hallways']],
    farm: [[1, 'Wheat fields'], [2, 'Carrots'], [3, 'Well and scarecrow'], [4, 'Corn and chickens'], [5, 'Windmill + tomatoes'], [6, 'Pumpkins and a barn'], [7, 'Greenhouse (glows at night) + sunflowers'], [8, 'Beehives (bees fly) + strawberries'], [10, 'Golden apples and fireflies']],
    space: [[1, 'Solar arrays'], [2, 'Habitat domes'], [3, 'Rover patrols the sector'], [4, 'Antenna masts + drone swarm'], [5, 'Science labs'], [6, 'Hydroponics bays'], [7, 'Fusion reactors'], [8, 'Observatories + shuttle pad'], [10, 'Mega-domes and aurora']]
  };
  const perksFor = (skin, L) => (PERKS[skin] || []).map(([lvl, name]) => ({ lvl, name, unlocked: L >= lvl }));
  const hasPerk = (skin, L, name) => (PERKS[skin] || []).some(([lvl, n]) => L >= lvl && n.toLowerCase().includes(name));

  /* ---- ways to earn XP, shown in the Progress panel ---- */
  const HOW = [
    [`+${XP.tool} XP`, 'every tool call a session makes'], [`+${XP.turn} XP`, 'every finished turn (a session goes from working to idle)'],
    [`+${XP.tokenXp} XP`, `every ${XP.tokensPer.toLocaleString('en-US')} tokens processed`], [`+${XP.approval} XP`, 'every permission you answer from the office'],
    [`+${XP.day} XP`, `first activity of each day, plus +${XP.streakStep} per day of streak (up to ${XP.streakMax} days)`], ['+ harvest XP', 'every crop / module that ripens (higher tiers give more)'],
    ['Plant', `every ${WORK_PER_PLANT} work units (tool call = 1, finished turn = 3) plants a new crop / module on that project's land`]
  ];

  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const dayKey = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  return { XP, WORK_PER_PLANT, GROW_MS, RIPE_HOLD_MS, STAGES, SCALE, xpFor, levelFor, progress, TITLES, titleFor, CHAR_PERKS, KIND_UNLOCK, CROPS, MODULES, unlockedKinds, CELLS, maxPlots, stageOf, harvestValue, PERKS, perksFor, hasPerk, HOW, hash, dayKey };
});
