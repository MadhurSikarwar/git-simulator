#!/usr/bin/env node
/* Git live helper.
   Watches a real folder on this computer and streams what real Git says about it
   (working directory, index, HEAD, history) to the "Live repo" page of the site.

   Usage:   node git-watch.js [folder] [--port 4781] [--no-open]

   Safety:  * listens on 127.0.0.1 only
            * runs ONLY read-only git commands, with optional locks off, so it never blocks your own git commands
            * every request needs the pairing code printed below (the page served by this helper has it built in)
            * checks the Host header, so other websites cannot reach it through DNS tricks
   No dependencies. Needs Node 18+ and git on the PATH. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');

const VERSION = 1;
const MAX_ROWS = 2000, MAX_UNTRACKED = 400, MAX_HASH_FILES = 150, MAX_HASH_BYTES = 5 * 1024 * 1024, MAX_COMMITS = 300, MAX_DIFF = 200 * 1024;

/* ---------------------------------------------------------------- git runner (read-only) */
function runGit(cwd, args, opts = {}) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_PAGER: 'cat', GIT_EXTERNAL_DIFF: '' });
    const full = ['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat'].concat(args);
    let child;
    try { child = cp.spawn('git', full, { cwd, env, windowsHide: true }); } catch (e) { return resolve({ code: -1, out: Buffer.alloc(0), err: String(e.message) }); }
    const out = [], err = []; let size = 0, done = false;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* already gone */ } finish({ code: -2, out: Buffer.concat(out), err: 'timed out' }); }, opts.timeout || 12000);
    child.stdout.on('data', d => { size += d.length; if (size <= (opts.max || 32 * 1024 * 1024)) out.push(d); });
    child.stderr.on('data', d => err.push(d));
    child.on('error', e => finish({ code: -1, out: Buffer.alloc(0), err: e.code === 'ENOENT' ? 'git was not found on the PATH' : String(e.message) }));
    child.on('close', code => finish({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString('utf8') }));
    if (opts.input != null) { child.stdin.on('error', () => { /* ignore EPIPE */ }); child.stdin.end(opts.input); } else child.stdin.end();
  });
}
const text = r => r.out.toString('utf8');

/* Where was each commit made? Replays the HEAD reflog (same logic as the page uses for the simulator).
   entries: oldest first, [{h, m}] */
function reflogMeta(entries, headBranch, branchNames) {
  const born = {}, ff = [], pending = [], pendingFF = [];
  let cur = null, prev = null;
  const isHash = s => /^[0-9a-f]{7,40}$/.test(s) && !(branchNames && branchNames.indexOf(s) >= 0);
  for (const e of entries) {
    const m = e.m; let x;
    if ((x = /^checkout: moving from (\S+) to (\S+)$/.exec(m))) {
      if (cur === null) { const from = isHash(x[1]) ? '(detached)' : x[1]; pending.forEach(h => { born[h] = from; }); pendingFF.forEach(f => { f.into = from; }); pending.length = 0; pendingFF.length = 0; }
      cur = isHash(x[2]) ? '(detached)' : x[2];
    } else if (/^(commit|cherry-pick|revert)\b/.test(m) || /^merge .+: Merge made by/.test(m)) {
      if (cur) born[e.h] = cur; else pending.push(e.h);
    } else if ((x = /^merge (.+): Fast-forward$/.exec(m))) {
      const f = { into: cur, from: x[1], h: e.h, old: prev }; ff.push(f); if (!cur) pendingFF.push(f);
    }
    prev = e.h;
  }
  if (cur === null && headBranch) { pending.forEach(h => { born[h] = headBranch; }); pendingFF.forEach(f => { f.into = headBranch; }); }
  return { born, ff: ff.filter(f => f.into) };
}

/* files of a folder that is not a repository (so the page can still show the working directory) */
function plainFiles(folder) {
  const out = [];
  const walk = (dir, rel) => {
    let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of names) {
      if (out.length >= 200) return;
      if (d.name === '.git' || d.name === 'node_modules') continue;
      if (d.isDirectory()) walk(path.join(dir, d.name), rel + d.name + '/');
      else if (d.isFile()) out.push({ p: rel + d.name, st: 'plain', h: null });
    }
  };
  walk(folder, '');
  return out;
}

/* ---------------------------------------------------------------- snapshot of one folder */
async function snapshot(folder) {
  const t0 = Date.now();
  const snap = { t: Math.floor(t0 / 1000), folder, repo: false };
  let st;
  try { st = fs.statSync(folder); } catch (e) { return Object.assign(snap, { error: 'That folder does not exist: ' + folder }); }
  if (!st.isDirectory()) return Object.assign(snap, { error: 'That path is a file, not a folder: ' + folder });
  const top = await runGit(folder, ['rev-parse', '--show-toplevel', '--absolute-git-dir']);
  if (top.code === -1) return Object.assign(snap, { error: top.err });
  if (top.code !== 0) {
    const dubious = /dubious ownership|safe\.directory/i.test(top.err);
    return Object.assign(snap, { repo: false, wd: plainFiles(folder), message: dubious ? 'Git refuses this folder because it belongs to another user (safe.directory). Fix it with: git config --global --add safe.directory "' + folder.replace(/\\/g, '/') + '"' : 'This folder is not a Git repository yet. Run git init in it and this page will pick it up.' });
  }
  const lines = text(top).split(/\r?\n/).filter(Boolean);
  const root = path.normalize(lines[0]); const gitDir = path.normalize(lines[1] || path.join(root, '.git'));
  snap.repo = true; snap.root = root;

  const [sym, rev, stat, lsf, lst, refs, log, rlog, ver] = await Promise.all([
    runGit(root, ['symbolic-ref', '-q', 'HEAD']),
    runGit(root, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']),
    runGit(root, ['status', '--porcelain=v2', '-z', '--branch', '-uall', '--ignored=matching']),
    runGit(root, ['ls-files', '-s', '-z']),
    runGit(root, ['ls-tree', '-r', '-z', 'HEAD']),
    runGit(root, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(*objectname)', 'refs/heads', 'refs/tags']),
    runGit(root, ['log', '--all', '--max-count=' + MAX_COMMITS, '--date-order', '-z', '--format=%H%x01%P%x01%T%x01%an%x01%ct%x01%s']),
    runGit(root, ['log', '-g', '-n', '1000', '-z', '--format=%H%x01%gs%x01%ct']),
    runGit(root, ['--version'])
  ]);
  snap.gitVersion = text(ver).trim();
  const ref = sym.code === 0 ? text(sym).trim() : null;
  const hash = rev.code === 0 ? text(rev).trim() : null;
  snap.head = { ref, branch: ref ? ref.replace(/^refs\/heads\//, '') : null, hash, detached: !ref };

  // status (porcelain v2)
  const ch = new Map(); const untracked = []; const ignored = []; let upstream = null;
  const toks = text(stat).split('\0');
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]; if (!t) continue;
    if (t.startsWith('# ')) {
      const m = /^# branch\.upstream (.+)$/.exec(t); if (m) upstream = { name: m[1], ahead: 0, behind: 0 };
      const ab = /^# branch\.ab \+(\d+) -(\d+)$/.exec(t); if (ab && upstream) { upstream.ahead = +ab[1]; upstream.behind = +ab[2]; }
    } else if (t[0] === '1') { const f = t.split(' '); ch.set(f.slice(8).join(' '), { x: f[1][0], y: f[1][1], hH: f[6], hI: f[7] }); }
    else if (t[0] === '2') { const f = t.split(' '); const p = f.slice(9).join(' '); const orig = toks[++i]; ch.set(p, { x: f[1][0], y: f[1][1], hH: f[6], hI: f[7], orig, score: f[8] }); }
    else if (t[0] === 'u') { const f = t.split(' '); ch.set(f.slice(10).join(' '), { x: 'U', y: 'U', conflict: true, xy: f[1] }); }
    else if (t[0] === '?') untracked.push(t.slice(2));
    else if (t[0] === '!') ignored.push(t.slice(2));
  }
  snap.upstream = upstream;

  // index (stage 0 entries; conflicts have stages 1-3)
  const idx = new Map(); const conflictPaths = new Set();
  for (const rec of text(lsf).split('\0')) {
    if (!rec) continue; const tab = rec.indexOf('\t'); const meta = rec.slice(0, tab).split(' '); const p = rec.slice(tab + 1);
    if (meta[2] !== '0') conflictPaths.add(p); else idx.set(p, { h: meta[1], mode: meta[0] });
  }
  const headTree = new Map();
  for (const rec of text(lst).split('\0')) { if (!rec) continue; const tab = rec.indexOf('\t'); const meta = rec.slice(0, tab).split(' '); headTree.set(rec.slice(tab + 1), { h: meta[2], mode: meta[0] }); }

  // working directory: hash what is edited or untracked (everything else equals the index)
  const toHash = [];
  for (const [p, c] of ch) if (c.y === 'M' || c.y === 'T') toHash.push(p);
  const untrackedShown = untracked.filter(p => !p.endsWith('/'));
  for (const p of untrackedShown.slice(0, MAX_UNTRACKED)) toHash.push(p);
  const wdHash = new Map();
  const hashable = [];
  for (const p of toHash) { if (hashable.length >= MAX_HASH_FILES) break; try { const s = fs.statSync(path.join(root, p)); if (s.isFile() && s.size <= MAX_HASH_BYTES && !/[\r\n]/.test(p)) hashable.push(p); } catch (e) { /* vanished */ } }
  if (hashable.length) {
    const r = await runGit(root, ['hash-object', '--stdin-paths'], { input: hashable.join('\n') + '\n' });
    const hs = text(r).split(/\r?\n/).filter(Boolean);
    if (r.code === 0 && hs.length === hashable.length) hashable.forEach((p, i) => wdHash.set(p, hs[i]));
  }
  const wd = [], index = [], repo = [];
  for (const [p, e] of [...idx].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const c = ch.get(p);
    if (c && c.y === 'D') wd.push({ p, st: 'deleted', h: null });
    else if (c && (c.y === 'M' || c.y === 'T')) wd.push({ p, st: 'modified', h: wdHash.get(p) || null });
    else wd.push({ p, st: 'clean', h: e.h });
    let tag = '';
    if (c) { if (c.x === 'A') tag = 'new'; else if (c.x === 'M' || c.x === 'T') tag = 'modified'; else if (c.x === 'R' || c.x === 'C') tag = 'renamed'; }
    index.push({ p, h: e.h, tag, from: c && c.orig ? c.orig : null });
  }
  for (const p of [...conflictPaths].sort()) { wd.push({ p, st: 'conflict', h: null }); index.push({ p, h: null, tag: 'conflict' }); }
  for (const [p, c] of ch) { if (c.x === 'D') index.push({ p, h: null, tag: 'deleted' }); if (c.orig) index.push({ p: c.orig, h: null, tag: 'deleted' }); }
  let hiddenUntracked = 0;
  for (const p of untracked) {
    if (p.endsWith('/')) { wd.push({ p, st: 'untracked', h: null, dir: true }); continue; }
    if (wd.filter(w => w.st === 'untracked').length >= MAX_UNTRACKED) { hiddenUntracked++; continue; }
    wd.push({ p, st: 'untracked', h: wdHash.get(p) || null });
  }
  for (const p of ignored.slice(0, 100)) wd.push({ p, st: 'ignored', h: null, dir: p.endsWith('/') });
  for (const [p, e] of [...headTree].sort((a, b) => (a[0] < b[0] ? -1 : 1))) repo.push({ p, h: e.h });
  snap.truncated = { wd: Math.max(0, wd.length - MAX_ROWS), index: Math.max(0, index.length - MAX_ROWS), repo: Math.max(0, repo.length - MAX_ROWS), untracked: hiddenUntracked, ignored: Math.max(0, ignored.length - 100) };
  snap.wd = wd.slice(0, MAX_ROWS); snap.index = index.slice(0, MAX_ROWS); snap.repo = repo.slice(0, MAX_ROWS);
  const stagedN = [...ch.values()].filter(c => c.x !== '.' && c.x !== 'U').length;
  snap.counts = {
    staged: stagedN, modified: [...ch.values()].filter(c => c.y === 'M' || c.y === 'T' || c.y === 'D').length, untracked: untracked.length,
    conflicts: conflictPaths.size, ignored: ignored.length, tracked: idx.size
  };

  // refs, commits, reflog
  const branches = [], tags = [];
  for (const l of text(refs).split(/\r?\n/)) {
    if (!l) continue; const [name, obj, peeled] = l.split('\t');
    if (name.startsWith('refs/heads/')) branches.push({ name: name.slice(11), hash: obj });
    else if (name.startsWith('refs/tags/')) tags.push({ name: name.slice(10), hash: peeled || obj });
  }
  snap.branches = branches; snap.tags = tags;
  const commits = []; const known = new Set();
  const rows = text(log).split('\0').filter(Boolean).map(r => r.split('\x01'));
  rows.forEach(r => known.add(r[0]));
  for (const r of rows) commits.push({ h: r[0], p: (r[1] ? r[1].split(' ') : []).filter(x => known.has(x)), tree: r[2], a: r[3], t: +r[4], s: r[5] });
  snap.commits = commits;
  const rl = rlog.code === 0 ? text(rlog).split('\0').filter(Boolean).map(r => { const f = r.split('\x01'); return { h: f[0], m: f[1], t: +f[2] }; }) : [];
  snap.reflog = rl.slice(0, 15);
  const meta = reflogMeta(rl.slice().reverse().map(e => ({ h: e.h, m: e.m })), snap.head.branch, branches.map(b => b.name));
  snap.born = {}; for (const c of commits) if (meta.born[c.h]) snap.born[c.h] = meta.born[c.h];
  snap.ff = meta.ff.filter(f => known.has(f.h));
  let state = null;
  const has = n => fs.existsSync(path.join(gitDir, n));
  if (has('MERGE_HEAD')) state = 'merging'; else if (has('rebase-merge') || has('rebase-apply')) state = 'rebasing'; else if (has('CHERRY_PICK_HEAD')) state = 'cherry-picking'; else if (has('REVERT_HEAD')) state = 'reverting'; else if (has('BISECT_LOG')) state = 'bisecting';
  snap.state = state;
  snap.ms = Date.now() - t0;
  return snap;
}

/* ---------------------------------------------------------------- extra read-only queries */
function insideRoot(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const abs = path.resolve(root, rel);
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r) || r === '') return null;
  return r.split(path.sep).join('/');
}
async function fileDiff(root, rel, mode) {
  const p = insideRoot(root, rel); if (!p) return { ok: false, error: 'That path is outside the repository.' };
  if (mode === 'file') {
    try {
      const abs = path.join(root, p); const s = fs.statSync(abs); if (!s.isFile()) return { ok: true, text: '(not a regular file)' };
      const fd = fs.openSync(abs, 'r'); const buf = Buffer.alloc(Math.min(s.size, 64 * 1024)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      if (buf.includes(0)) return { ok: true, text: '(binary file, ' + s.size + ' bytes)' };
      return { ok: true, text: buf.toString('utf8') + (s.size > buf.length ? '\n… (' + (s.size - buf.length) + ' more bytes)' : '') };
    } catch (e) { return { ok: false, error: 'Could not read the file: ' + e.message }; }
  }
  const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U3'];
  if (mode === 'staged') args.push('--cached'); else if (mode === 'head') args.push('HEAD');
  args.push('--', p);
  const r = await runGit(root, args, { max: MAX_DIFF * 2 });
  if (r.code !== 0) return { ok: false, error: r.err || 'git diff failed' };
  let t = text(r); if (t.length > MAX_DIFF) t = t.slice(0, MAX_DIFF) + '\n… (truncated)';
  return { ok: true, text: t };
}
async function commitInfo(root, h) {
  if (!/^[0-9a-f]{7,40}$/i.test(h)) return { ok: false, error: 'Not a commit id.' };
  const [meta, files] = await Promise.all([
    runGit(root, ['show', '-s', '--format=%H%x01%an <%ae>%x01%ct%x01%s%x01%b', h + '^{commit}']),
    runGit(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--root', '-m', '--first-parent', '-z', h + '^{commit}'])
  ]);
  if (meta.code !== 0) return { ok: false, error: 'Unknown commit.' };
  const f = text(meta).split('\x01');
  const toks = text(files).split('\0').filter(Boolean); const list = [];
  for (let i = 0; i < toks.length; i++) { const st = toks[i]; if (/^[RC]/.test(st)) { list.push({ st: st[0], old: toks[i + 1], p: toks[i + 2] }); i += 2; } else { list.push({ st: st[0], p: toks[i + 1] }); i += 1; } }
  return { ok: true, h: f[0], author: f[1], t: +f[2], subject: f[3], body: (f[4] || '').trim(), files: list.slice(0, 200) };
}

/* ---------------------------------------------------------------- server */
function createServer(o = {}) {
  const token = o.token || crypto.randomBytes(6).toString('hex').match(/.{4}/g).join('-');
  const clients = new Set();
  const state = { folder: o.folder ? path.resolve(o.folder) : null, last: null, lastJson: '', computing: false, dirty: false, watcher: null, timer: null, poll: null, ms: 0, port: 0 };
  const siteCandidates = [process.env.GIT_SITE_HTML, path.join(__dirname, 'git-from-the-inside-out.html'), path.join(__dirname, '..', 'git-from-the-inside-out.html'), path.join(__dirname, '..', 'dist', 'index.html')].filter(Boolean);

  const broadcast = obj => { const data = 'event: state\ndata: ' + JSON.stringify(obj) + '\n\n'; for (const c of clients) { try { c.write(data); } catch (e) { clients.delete(c); } } };
  async function refresh(force) {
    if (!state.folder) return;
    if (state.computing) { state.dirty = true; return; }
    state.computing = true;
    try {
      const snap = await snapshot(state.folder);
      state.ms = snap.ms || 0;
      const key = JSON.stringify(Object.assign({}, snap, { t: 0, ms: 0 }));
      state.last = snap;
      if (force || key !== state.lastJson) { state.lastJson = key; broadcast(snap); }
    } finally { state.computing = false; if (state.dirty) { state.dirty = false; schedule(60); } }
  }
  function schedule(ms) { clearTimeout(state.timer); state.timer = setTimeout(() => refresh(false), ms == null ? 150 : ms); }
  function stopWatching() { if (state.watcher) { try { state.watcher.close(); } catch (e) { /* ignore */ } state.watcher = null; } clearInterval(state.poll); }
  function startWatching() {
    stopWatching(); if (!state.folder) return;
    try {
      state.watcher = fs.watch(state.folder, { recursive: true, persistent: false }, (ev, name) => {
        if (name) { const f = String(name).replace(/\\/g, '/'); if (/^\.git\/objects(\/|$)/.test(f) || /(^|\/)node_modules(\/|$)/.test(f)) return; }
        schedule();
      });
      state.watcher.on('error', () => { /* polling still covers us */ });
    } catch (e) { /* recursive watch unavailable: polling only */ }
    state.poll = setInterval(() => { if (clients.size) schedule(0); }, 2000);
  }
  function setFolder(p) { state.folder = path.resolve(p); state.last = null; state.lastJson = ''; startWatching(); return refresh(true); }

  const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const hostOk = req => { const h = String(req.headers.host || '').toLowerCase(); return [`localhost:${state.port}`, `127.0.0.1:${state.port}`, `[::1]:${state.port}`].includes(h); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Git-Live-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true'); // lets pages opened from a file reach this local helper
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!hostOk(req)) { res.writeHead(403); return res.end('Forbidden host'); }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const f = siteCandidates.find(c => { try { return fs.statSync(c).isFile(); } catch (e) { return false; } });
      if (!f) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:2rem"><h1>Git live helper is running</h1><p>Put <code>git-from-the-inside-out.html</code> next to <code>git-watch.js</code> to serve the site from here, or open the site file yourself and paste this pairing code: <b>' + token + '</b></p>'); }
      let html = fs.readFileSync(f, 'utf8');
      const boot = '<script>window.__GITLIVE__=' + JSON.stringify({ token, same: true, folder: state.folder }) + ';</script>';
      html = html.includes('<div id="app"></div>') ? html.replace('<div id="app"></div>', boot + '<div id="app"></div>') : boot + html;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html);
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end('Not found'); }
    if (url.pathname === '/api/ping') return sendJson(res, 200, { ok: true, app: 'git-watch', version: VERSION, needsToken: true });
    const given = req.headers['x-git-live-token'] || url.searchParams.get('token');
    if (given !== token) return sendJson(res, 401, { ok: false, error: 'Wrong or missing pairing code.' });

    if (url.pathname === '/api/watch' && req.method === 'POST') {
      let body = ''; req.on('data', d => { body += d; if (body.length > 10000) req.destroy(); });
      req.on('end', async () => {
        let p; try { p = JSON.parse(body).path; } catch (e) { return sendJson(res, 400, { ok: false, error: 'Bad request.' }); }
        if (typeof p !== 'string' || !p.trim() || p.includes('\0')) return sendJson(res, 400, { ok: false, error: 'Type or paste a folder path.' });
        p = p.trim().replace(/^"(.*)"$/, '$1');
        let st; try { st = fs.statSync(path.resolve(p)); } catch (e) { return sendJson(res, 404, { ok: false, error: 'That folder does not exist.' }); }
        if (!st.isDirectory()) return sendJson(res, 400, { ok: false, error: 'That path is a file, not a folder.' });
        await setFolder(p); sendJson(res, 200, { ok: true, folder: state.folder, snapshot: state.last });
      });
      return;
    }
    if (url.pathname === '/api/state') return sendJson(res, 200, { ok: true, folder: state.folder, snapshot: state.last });
    if (url.pathname === '/api/refresh') { await refresh(true); return sendJson(res, 200, { ok: true, snapshot: state.last }); }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      if (state.last) res.write('event: state\ndata: ' + JSON.stringify(state.last) + '\n\n'); else if (state.folder) refresh(true);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* closed */ } }, 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    const root = state.last && state.last.repo ? state.last.root : null;
    if (url.pathname === '/api/diff') { if (!root) return sendJson(res, 409, { ok: false, error: 'No repository is being watched.' }); return sendJson(res, 200, await fileDiff(root, url.searchParams.get('path'), url.searchParams.get('mode') || 'unstaged')); }
    if (url.pathname === '/api/commit') { if (!root) return sendJson(res, 409, { ok: false, error: 'No repository is being watched.' }); return sendJson(res, 200, await commitInfo(root, url.searchParams.get('h') || '')); }
    sendJson(res, 404, { ok: false, error: 'Unknown endpoint.' });
  });

  function listen(port) {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = p => {
        state.port = p;
        server.once('error', e => { if (e.code === 'EADDRINUSE' && tries++ < 10) attempt(p + 1); else reject(e); });
        server.listen(p, '127.0.0.1', () => resolve(p));
      };
      attempt(port);
    });
  }
  function close() { stopWatching(); clearTimeout(state.timer); for (const c of clients) { try { c.end(); } catch (e) { /* ignore */ } } server.close(); }
  if (state.folder) { startWatching(); refresh(true); }
  return { server, token, state, listen, close, setFolder, refresh };
}

module.exports = { createServer, snapshot, fileDiff, commitInfo, runGit, reflogMeta };

/* ---------------------------------------------------------------- command line */
if (require.main === module) {
  const argv = process.argv.slice(2);
  let port = 4781, folder = null, open = true;
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--port') port = +argv[++i] || port; else if (argv[i] === '--no-open') open = false; else if (!argv[i].startsWith('--')) folder = argv[i]; }
  const app = createServer({ folder });
  app.listen(port).then(p => {
    const url = 'http://localhost:' + p + '/';
    console.log('\n  Git live view is running.\n');
    console.log('  Open the site:    ' + url);
    console.log('  Pairing code:     ' + app.token + '   (only needed if you open the site file directly)');
    console.log('  Watching:         ' + (app.state.folder || '(nothing yet: type a folder path on the Live page)'));
    console.log('\n  Run your git commands in cmd as usual. Press Ctrl+C here to stop.');
    console.log('  This helper only listens on 127.0.0.1 and only runs read-only git commands.\n');
    if (open) {
      try {
        if (process.platform === 'win32') cp.exec('start "" "' + url + '"', { windowsHide: true }, () => {});
        else cp.spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
      } catch (e) { /* the URL is printed above */ }
    }
  }).catch(e => { console.error('Could not start: ' + e.message); process.exit(1); });
}
