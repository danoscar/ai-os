'use strict';
/* =====================================================================
   PIXEL OFFICE — Repos tab backend (read-only; GitHub and GitLab)

   No tokens are stored by this app. It uses what you are already logged in with:
     GitHub : the `gh` CLI (gh auth login)            or  GITHUB_TOKEN in the environment
     GitLab : the `glab` CLI (glab auth login)        or  GITLAB_TOKEN (+ GITLAB_HOST for self-hosted) in the environment
   Every command is run with an argument array (no shell). Names coming from the browser are validated first.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const NAME = /^[\w.-]+(\/[\w.-]+){0,3}$/;
const run = (bin, args, ms = 30000) => new Promise(res => execFile(bin, args, { timeout: ms, maxBuffer: 16e6, env: process.env }, (err, out, errOut) => res({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') })));
const json = s => { try { return JSON.parse(s); } catch { return null; } };
const host = () => (process.env.GITLAB_HOST || 'https://gitlab.com').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
const cache = new Map();
const cached = async (key, ms, fn) => { const c = cache.get(key); if (c && Date.now() - c.at < ms) return c.v; const v = await fn(); cache.set(key, { at: Date.now(), v }); return v; };

async function http(url, headers) {
  try { const r = await fetch(url, { headers: { 'User-Agent': 'pixel-office', ...headers }, signal: AbortSignal.timeout(20000) }); return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) }; } catch (e) { return { ok: false, status: 0, json: null, err: e.message }; }
}

/* ---------- GitHub ---------- */
async function ghStatus() {
  const r = await run('gh', ['auth', 'status', '--hostname', 'github.com']); const hasCli = !/ENOENT|not found/i.test(r.err) || r.ok;
  if (r.ok) { const u = await run('gh', ['api', 'user', '--jq', '.login']); return { connected: true, via: 'gh', user: u.out.trim(), hint: '' }; }
  if (process.env.GITHUB_TOKEN) { const u = await http('https://api.github.com/user', { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN }); if (u.ok) return { connected: true, via: 'token', user: u.json.login, hint: '' }; }
  return { connected: false, via: '', user: '', hint: hasCli ? 'Run `gh auth login` in a terminal, then reload.' : 'Install the GitHub CLI (https://cli.github.com) and run `gh auth login`, or set GITHUB_TOKEN before starting the bridge.' };
}
async function ghOwners(st) {
  if (st.via === 'gh') { const o = await run('gh', ['api', 'user/orgs', '--jq', '.[].login']); return [st.user, ...o.out.split('\n').map(x => x.trim()).filter(Boolean)]; }
  return [st.user];
}
const ghNorm = r => ({ provider: 'github', id: r.nameWithOwner || r.full_name, name: r.name, fullName: r.nameWithOwner || r.full_name, description: r.description || '', private: !!(r.isPrivate ?? r.private), fork: !!(r.isFork ?? r.fork), archived: !!(r.isArchived ?? r.archived),
  language: (r.primaryLanguage && r.primaryLanguage.name) || r.language || '', pushedAt: r.pushedAt || r.pushed_at || '', stars: r.stargazerCount ?? r.stargazers_count ?? 0, url: r.url || r.html_url, defaultBranch: (r.defaultBranchRef && r.defaultBranchRef.name) || r.default_branch || '' });
async function ghList(st, owner) {
  if (st.via === 'gh') {
    const r = await run('gh', ['repo', 'list', owner || st.user, '--limit', '200', '--json', 'name,nameWithOwner,description,isPrivate,isFork,isArchived,primaryLanguage,pushedAt,stargazerCount,url,defaultBranchRef']);
    const j = json(r.out); if (!j) throw new Error(r.err.trim() || 'gh repo list failed'); return j.map(ghNorm);
  }
  const url = !owner || owner === st.user ? 'https://api.github.com/user/repos?per_page=100&sort=pushed' : `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos?per_page=100&sort=pushed`;
  const r = await http(url, { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN }); if (!r.ok || !Array.isArray(r.json)) throw new Error('GitHub API error ' + r.status); return r.json.map(ghNorm);
}
async function ghDetail(st, repo) {
  const commits = st.via === 'gh' ? json((await run('gh', ['api', `repos/${repo}/commits?per_page=6`])).out) : (await http(`https://api.github.com/repos/${repo}/commits?per_page=6`, { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN })).json;
  const prs = st.via === 'gh' ? json((await run('gh', ['api', `repos/${repo}/pulls?state=open&per_page=6`])).out) : (await http(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=6`, { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN })).json;
  return { commits: (Array.isArray(commits) ? commits : []).map(c => ({ sha: String(c.sha).slice(0, 7), message: String((c.commit && c.commit.message) || '').split('\n')[0].slice(0, 120), author: (c.commit && c.commit.author && c.commit.author.name) || '', at: (c.commit && c.commit.author && c.commit.author.date) || '' })),
    prs: (Array.isArray(prs) ? prs : []).map(p => ({ number: p.number, title: String(p.title).slice(0, 120), author: p.user && p.user.login, at: p.updated_at, url: p.html_url })) };
}

/* ---------- GitLab ---------- */
async function glStatus() {
  if (process.env.GITLAB_TOKEN) { const u = await http(host() + '/api/v4/user', { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN }); if (u.ok) return { connected: true, via: 'token', user: u.json.username, hint: '' }; }
  const r = await run('glab', ['auth', 'status']); if (r.ok || /Logged in/i.test(r.err + r.out)) { const u = await run('glab', ['api', 'user']); const j = json(u.out); if (j) return { connected: true, via: 'glab', user: j.username, hint: '' }; }
  return { connected: false, via: '', user: '', hint: 'Install the GitLab CLI and run `glab auth login`, or set GITLAB_TOKEN (and GITLAB_HOST for a self-hosted server) before starting the bridge.' };
}
const glNorm = p => ({ provider: 'gitlab', id: String(p.id), name: p.name, fullName: p.path_with_namespace, description: p.description || '', private: p.visibility !== 'public', fork: !!p.forked_from_project, archived: !!p.archived, language: '', pushedAt: p.last_activity_at || '', stars: p.star_count || 0, url: p.web_url, defaultBranch: p.default_branch || '' });
async function glGet(st, apiPath) {
  if (st.via === 'token') { const r = await http(host() + '/api/v4/' + apiPath, { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN }); if (!r.ok) throw new Error('GitLab API error ' + r.status); return r.json; }
  const r = await run('glab', ['api', apiPath]); const j = json(r.out); if (j === null) throw new Error(r.err.trim() || 'glab api failed'); return j;
}
async function glList(st) { const j = await glGet(st, 'projects?membership=true&per_page=100&order_by=last_activity_at&simple=false'); return (Array.isArray(j) ? j : []).map(glNorm); }
async function glDetail(st, repo) {
  const enc = encodeURIComponent(repo);
  const commits = await glGet(st, `projects/${enc}/repository/commits?per_page=6`).catch(() => []), mrs = await glGet(st, `projects/${enc}/merge_requests?state=opened&per_page=6`).catch(() => []);
  return { commits: commits.map(c => ({ sha: String(c.short_id || c.id).slice(0, 7), message: String(c.title || '').slice(0, 120), author: c.author_name || '', at: c.created_at })), prs: mrs.map(m => ({ number: m.iid, title: String(m.title).slice(0, 120), author: m.author && m.author.username, at: m.updated_at, url: m.web_url })) };
}

/* ---------- which repos are open in the office? (match local project folders by their git remote) ---------- */
function remoteOf(dir) {
  try {
    const gitDir = (() => { const g = path.join(dir, '.git'); const st = fs.statSync(g); if (st.isDirectory()) return g; const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(g, 'utf8')); return m ? path.resolve(dir, m[1].trim()) : null; })(); if (!gitDir) return null;
    let cfg = path.join(gitDir, 'config'); if (!fs.existsSync(cfg)) { const common = path.join(gitDir, 'commondir'); if (fs.existsSync(common)) cfg = path.join(path.resolve(gitDir, fs.readFileSync(common, 'utf8').trim()), 'config'); }
    const m = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(fs.readFileSync(cfg, 'utf8')); if (!m) return null;
    const u = m[1].replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://').replace(/^https?:\/\/[^@/]+@/, 'https://');
    const x = /^https?:\/\/([^/]+)\/(.+)$/.exec(u); return x ? { host: x[1].toLowerCase(), repo: x[2].toLowerCase() } : null;
  } catch { return null; }
}

/* ---------- public API ---------- */
async function status() { const [github, gitlab] = await Promise.all([cached('ghs', 30000, ghStatus), cached('gls', 30000, glStatus)]); return { github, gitlab, gitlabHost: host() }; }
async function list(provider, owner, roots) {
  owner = owner && NAME.test(owner) ? owner : '';
  const st = provider === 'gitlab' ? await cached('gls', 30000, glStatus) : await cached('ghs', 30000, ghStatus);
  if (!st.connected) return { status: 401, error: st.hint || 'not connected' };
  try {
    const owners = provider === 'github' ? await cached('gho:' + st.user, 300000, () => ghOwners(st)) : [];
    const repos = await cached(`${provider}:${owner}`, 60000, () => provider === 'gitlab' ? glList(st) : ghList(st, owner));
    const local = new Map(); for (const r of roots || []) { const rem = remoteOf(r.root); if (rem) { const k = rem.repo; (local.get(k) || local.set(k, []).get(k)).push({ root: r.root, project: r.project }); } }
    return { user: st.user, owners, repos: repos.map(r => ({ ...r, local: local.get(r.fullName.toLowerCase()) || [] })) };
  } catch (e) { return { status: 502, error: String(e.message || e).slice(0, 300) }; }
}
async function detail(provider, repo) {
  if (!NAME.test(repo || '')) return { status: 400, error: 'bad repo name' };
  const st = provider === 'gitlab' ? await cached('gls', 30000, glStatus) : await cached('ghs', 30000, ghStatus); if (!st.connected) return { status: 401, error: 'not connected' };
  try { return await cached(`d:${provider}:${repo}`, 60000, () => provider === 'gitlab' ? glDetail(st, repo) : ghDetail(st, repo)); } catch (e) { return { status: 502, error: String(e.message || e).slice(0, 300) }; }
}
module.exports = { status, list, detail, remoteOf };
