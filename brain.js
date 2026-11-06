'use strict';
/* =====================================================================
   PIXEL OFFICE — "Second Brain" backend (zero dependencies, read-only)

   Lets the user point Pixel Office at ANY folder of markdown notes (an Obsidian vault, a graphify
   output folder, a docs repo…) and browse it in a tab. Nothing about a specific vault lives in this
   repository: the chosen path is stored per user in ~/.pixel-office/config.json.

   Safety: every path is resolved with realpath and must stay inside the vault root (symlinks that
   escape are refused); only .md notes and common image types are served; nothing is ever written.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.pixel-office');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.DS_Store', '.venv', '__pycache__', 'cache']);
const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp' };
const MAX_NOTES = 6000, MAX_NOTE_BYTES = 1024 * 1024, MAX_GRAPH_NODES = 3000;

/* ---------- config ---------- */
function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } }
function saveConfig(cfg) { fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 }); }

const realAbs = p => { try { return fs.realpathSync(path.resolve(String(p))); } catch { return null; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function realIn(root, rel) {                       // resolve `rel` inside `root`, refusing escapes (incl. via symlinks)
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  let rr; try { rr = fs.realpathSync(root); } catch { return null; }
  let target; try { target = fs.realpathSync(path.resolve(rr, rel)); } catch { return null; }
  return target === rr || target.startsWith(rr + path.sep) ? target : null;
}

/* ---------- finding vaults ---------- */
function obsidianRegistry() {
  const files = [path.join(os.homedir(), 'Library/Application Support/obsidian/obsidian.json'), path.join(os.homedir(), '.config/obsidian/obsidian.json'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'obsidian', 'obsidian.json') : ''].filter(Boolean);
  const out = [];
  for (const f of files) { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); for (const v of Object.values(j.vaults || {})) if (v && v.path && isDir(v.path)) out.push(v.path); } catch { /* not installed */ } }
  return out;
}
function scanForVaults(root, depth, out) {
  if (depth < 0) return;
  let ents; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  if (ents.some(e => e.name === '.obsidian' && e.isDirectory())) { out.push(root); return; }
  for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name) && e.name !== 'Library' && e.name !== 'Applications') scanForVaults(path.join(root, e.name), depth - 1, out);
}
function detectVaults() {
  const found = new Set(obsidianRegistry());
  const home = os.homedir(), scan = [];
  for (const d of ['Documents', 'Desktop', 'Obsidian', 'Notes', 'Developer', 'Library/Mobile Documents/iCloud~md~obsidian/Documents']) { const p = path.join(home, d); if (isDir(p)) scanForVaults(p, 3, scan); }
  scan.forEach(p => found.add(p));
  return [...found].map(p => ({ path: p, name: path.basename(p), graphify: fs.existsSync(path.join(p, 'graphify-out', 'graph.json')) }));
}

function browse(dir) {
  const home = fs.realpathSync(os.homedir());
  const target = dir ? realAbs(dir) : home;
  if (!target || !isDir(target)) return { error: 'not a folder' };
  let ents = []; try { ents = fs.readdirSync(target, { withFileTypes: true }); } catch { /* unreadable */ }
  const dirs = ents.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map(e => ({ name: e.name, vault: isDir(path.join(target, e.name, '.obsidian')) })).sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(target);
  return { dir: target, parent: parent !== target ? parent : null, isVault: isDir(path.join(target, '.obsidian')), notes: ents.filter(e => e.isFile() && e.name.endsWith('.md')).length, dirs };
}

/* ---------- reading a vault ---------- */
let cache = { root: '', at: 0, notes: [], index: null };
function scan(root) {
  const notes = [];
  (function walk(dir, rel, depth) {
    if (depth > 14 || notes.length >= MAX_NOTES) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name, depth + 1); }
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        let st; try { st = fs.statSync(path.join(dir, e.name)); } catch { continue; }
        notes.push({ p: rel ? rel + '/' + e.name : e.name, m: Math.round(st.mtimeMs), s: st.size });
      }
    }
  })(root, '', 0);
  return notes.sort((a, b) => a.p.localeCompare(b.p));
}
function ensure(root, force) {
  if (!force && cache.root === root && Date.now() - cache.at < 10000) return cache;
  cache = { root, at: Date.now(), notes: scan(root), index: null }; return cache;
}

const WIKI = /\[\[([^\]\|#]+?)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]/g;
const MDLINK = /\[[^\]]*\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g;
function linkIndex(root) {
  const c = ensure(root); if (c.index) return c.index;
  const byName = new Map(), byPath = new Map();
  for (const n of c.notes) { const base = path.basename(n.p, '.md').toLowerCase(); (byName.get(base) || byName.set(base, []).get(base)).push(n.p); byPath.set(n.p.toLowerCase().replace(/\.md$/, ''), n.p); }
  const resolve = (from, target) => {
    const t = decodeURIComponent(target).replace(/\.md$/i, '').toLowerCase();
    if (byPath.has(t)) return byPath.get(t);
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), t)); if (byPath.has(rel)) return byPath.get(rel);
    const list = byName.get(path.posix.basename(t)); return list ? (list.find(p => p.split('/')[0] === from.split('/')[0]) || list[0]) : null;
  };
  const edges = [], seen = new Set();
  for (const n of c.notes) {
    if (n.s > 400 * 1024) continue;
    let txt; try { txt = fs.readFileSync(path.join(root, n.p), 'utf8'); } catch { continue; }
    for (const re of [WIKI, MDLINK]) { re.lastIndex = 0; let m; while ((m = re.exec(txt))) { let to; try { to = resolve(n.p, m[1].trim()); } catch { to = null; } if (to && to !== n.p) { const k = n.p + '\0' + to; if (!seen.has(k)) { seen.add(k); edges.push([n.p, to]); } } } }
  }
  const back = new Map(); for (const [a, b] of edges) (back.get(b) || back.set(b, []).get(b)).push(a);
  return (c.index = { edges, back, resolve });
}

function linkGraph(root) {
  const c = ensure(root), ix = linkIndex(root), deg = new Map();
  for (const [a, b] of ix.edges) { deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
  const nodes = c.notes.slice(0, MAX_GRAPH_NODES).map(n => ({ id: n.p, label: path.basename(n.p, '.md'), group: n.p.includes('/') ? n.p.split('/')[0] : '(root)', note: n.p, deg: deg.get(n.p) || 0 }));
  const ids = new Set(nodes.map(n => n.id));
  return { source: 'links', nodes, links: ix.edges.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([s, t]) => ({ source: s, target: t })) };
}

function findGraphify(root) {
  const cand = [path.join(root, 'graphify-out', 'graph.json'), path.join(root, 'graph.json')];
  return cand.find(f => fs.existsSync(f)) || null;
}
function graphifyGraph(root) {
  const f = findGraphify(root); if (!f) return null;
  let g; try { g = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  const c = ensure(root), have = new Set(c.notes.map(n => n.p));
  const nodes = (g.nodes || []).slice(0, MAX_GRAPH_NODES).map(n => {
    const sf = typeof n.source_file === 'string' ? n.source_file.replace(/\\/g, '/') : '';
    return { id: String(n.id), label: String(n.label || n.id).slice(0, 80), group: n.community_name || (n.community != null ? 'community ' + n.community : n.file_type || ''), kind: n.file_type || '', note: have.has(sf) ? sf : null, file: sf };
  });
  const ids = new Set(nodes.map(n => n.id));
  const links = (g.links || g.edges || []).filter(l => ids.has(String(l.source)) && ids.has(String(l.target))).map(l => ({ source: String(l.source), target: String(l.target), rel: l.relation || '', conf: l.confidence || '' }));
  const deg = new Map(); links.forEach(l => { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1); });
  nodes.forEach(n => { n.deg = deg.get(n.id) || 0; });
  const report = fs.existsSync(path.join(path.dirname(f), 'GRAPH_REPORT.md')) ? path.relative(root, path.join(path.dirname(f), 'GRAPH_REPORT.md')).split(path.sep).join('/') : null;
  return { source: 'graphify', nodes, links, report, file: path.relative(root, f).split(path.sep).join('/') };
}

function search(root, q) {
  q = String(q || '').trim().toLowerCase(); if (q.length < 2) return [];
  const c = ensure(root), out = [], t0 = Date.now();
  for (const n of c.notes) {
    if (out.length >= 40 || Date.now() - t0 > 1500) break;
    const name = n.p.toLowerCase(); let score = 0, snip = '';
    if (path.basename(name, '.md').includes(q)) score += 3; else if (name.includes(q)) score += 1;
    if (n.s < 300 * 1024) {
      let txt = ''; try { txt = fs.readFileSync(path.join(root, n.p), 'utf8'); } catch { /* skip */ }
      const i = txt.toLowerCase().indexOf(q);
      if (i >= 0) { score += 1; snip = txt.slice(Math.max(0, i - 50), i + 90).replace(/\s+/g, ' ').trim(); }
    }
    if (score) out.push({ p: n.p, score, snip });
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ---------- public API used by server.js ---------- */
function status() {
  const cfg = loadConfig(), root = cfg.vault && isDir(cfg.vault) ? cfg.vault : null;
  return { configured: !!root, vault: root, name: root ? path.basename(root) : '', graphify: root ? !!findGraphify(root) : false, detected: root ? [] : detectVaults() };
}
function setVault(p) {
  const t = p ? realAbs(p) : null;
  if (p && (!t || !isDir(t))) return { status: 400, error: 'not a folder' };
  const cfg = loadConfig(); if (t) cfg.vault = t; else delete cfg.vault; saveConfig(cfg); cache = { root: '', at: 0, notes: [], index: null };
  return { ok: true, vault: t };
}
const root = () => { const v = loadConfig().vault; return v && isDir(v) ? v : null; };

function note(rel) {
  const r = root(); if (!r) return { status: 404, error: 'no vault' };
  const f = realIn(r, String(rel || '')); if (!f || !f.toLowerCase().endsWith('.md')) return { status: 404, error: 'not found' };
  let st; try { st = fs.statSync(f); } catch { return { status: 404, error: 'not found' }; }
  if (st.size > MAX_NOTE_BYTES) return { status: 413, error: 'note too large' };
  const p = path.relative(fs.realpathSync(r), f).split(path.sep).join('/');
  const ix = linkIndex(r);
  return { p, text: fs.readFileSync(f, 'utf8'), m: st.mtimeMs, backlinks: ix.back.get(p) || [], resolve: Object.fromEntries([]) };
}
function resolveLink(from, target) { const r = root(); if (!r) return null; try { return linkIndex(r).resolve(from, target); } catch { return null; } }
function file(rel) {
  const r = root(); if (!r) return null; const f = realIn(r, String(rel || '')); const type = f && IMG[path.extname(f).toLowerCase()];
  return f && type && fs.statSync(f).size < 20 * 1024 * 1024 ? { f, type } : null;
}
/* attachments are referenced by bare name (![[pic.png]]) — find them anywhere in the vault */
function findAttachment(name) {
  const r = root(); if (!r || !IMG[path.extname(name).toLowerCase()]) return null;
  const want = path.basename(name).toLowerCase(); let hit = null;
  (function walk(dir, depth) { if (hit || depth > 8) return; let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { if (hit) return; if (e.isSymbolicLink()) continue; if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), depth + 1); } else if (e.name.toLowerCase() === want) hit = path.relative(r, path.join(dir, e.name)).split(path.sep).join('/'); } })(r, 0);
  return hit;
}

module.exports = {
  status, setVault, browse, detectVaults, root,
  tree: () => { const r = root(); return r ? { name: path.basename(r), notes: ensure(r, true).notes } : null; },
  note, file, findAttachment, resolveLink, search: q => { const r = root(); return r ? search(r, q) : []; },
  graph: kind => { const r = root(); if (!r) return null; return kind === 'graphify' ? graphifyGraph(r) : linkGraph(r); }
};
