/* Site: the Live repo page. Shows a real folder (through the local helper), a scripted demo,
   or a mirror of the Lab, in the same three-area picture, with a feed of what just changed. */
(function (GS) {
'use strict';
const U = GS.ui; const { $, $$, esc, sw } = U; const short = GS.short;
const Live = U.pages.live = {};

/* ================================================================== snapshot from the simulator (demo + mirror) */
U.snapshotFromSim = function (sim, label) {
  const g = sim.s.git; const snap = { t: Math.floor(Date.now() / 1000), folder: label, repo: !!g, ms: 0, gitVersion: 'simulated Git' };
  const fs = sim.s.fs;
  if (!g) {
    snap.message = 'This folder is not a Git repository yet. Run git init in it and this page will pick it up.';
    snap.wd = Object.keys(fs).sort().map(p => ({ p, st: 'plain', h: null }));
    return snap;
  }
  const st = sim.status(); const idx = g.index; const head = sim.headHash() ? sim.headFlat() : {};
  const wd = [], index = [], repo = [];
  for (const p of Object.keys(fs).sort()) {
    const h = GS.hashBlob(fs[p]);
    if (g.conflicts && g.conflicts[p]) wd.push({ p, st: 'conflict', h: null });
    else if (!idx[p]) wd.push(sim.isIgnored(p) ? { p, st: 'ignored', h: null } : { p, st: 'untracked', h });
    else if (idx[p].hash !== h) wd.push({ p, st: 'modified', h });
    else wd.push({ p, st: 'clean', h });
  }
  for (const p of Object.keys(idx).sort()) if (fs[p] === undefined) wd.push({ p, st: 'deleted', h: null });
  const tagOf = {};
  for (const c of st.staged) tagOf[c.path] = c;
  for (const p of Object.keys(idx).sort()) {
    const c = tagOf[p]; let tag = '';
    if (c) tag = c.st === 'A' ? 'new' : c.st === 'M' ? 'modified' : c.st === 'R' ? 'renamed' : '';
    index.push({ p, h: idx[p].hash, tag, from: c && c.st === 'R' ? c.oldPath : null });
  }
  for (const p of Object.keys(g.conflicts || {}).sort()) index.push({ p, h: null, tag: 'conflict' });
  for (const c of st.staged) { if (c.st === 'D') index.push({ p: c.path, h: null, tag: 'deleted' }); if (c.st === 'R') index.push({ p: c.oldPath, h: null, tag: 'deleted' }); }
  for (const p of Object.keys(head).sort()) repo.push({ p, h: head[p].hash });
  snap.wd = wd; snap.index = index; snap.repo = repo; snap.truncated = {};
  snap.root = label;
  snap.head = { ref: g.head.ref || null, branch: g.head.ref ? sim.branchName() : null, hash: sim.headHash(), detached: !g.head.ref };
  snap.upstream = null;
  snap.counts = { staged: st.staged.length, modified: st.unstaged.length, untracked: st.untracked.length, conflicts: st.conflicts.length, ignored: st.ignored.length, tracked: Object.keys(idx).length };
  snap.branches = sim.branches().map(b => ({ name: b, hash: g.refs['refs/heads/' + b] }));
  snap.tags = sim.tags().map(t => ({ name: t, hash: sim.peel(g.refs['refs/tags/' + t]) }));
  const order = sim.allTips().length ? sim.orderCommits(sim.allTips()).slice(0, 300) : [];
  snap.commits = order.map(h => { const c = sim.obj(h).data; const au = /^(.*) <.*> \d+ [+-]\d{4}$/.exec(c.author); return { h, p: c.parents, tree: c.tree, a: au ? au[1] : c.author, t: c.time, s: c.message.split('\n')[0] }; });
  snap.reflog = g.reflog.slice().reverse().slice(0, 15).map(r => ({ h: r.hash, m: r.msg, t: r.ts }));
  snap.state = g.mergeHead ? 'merging' : null;
  return snap;
};

/* a throw-away simulator state that only holds commits and refs, so GraphView and RefsView can draw real history */
function simFromSnapshot(snap) {
  const objects = {}; const n = snap.commits.length;
  snap.commits.forEach((c, i) => {
    const who = (c.a || 'unknown') + ' <> ' + c.t + ' +0000';
    objects[c.h] = { type: 'commit', data: { tree: c.tree || c.h, parents: c.p, author: who, committer: who, message: c.s + '\n', time: c.t, seq: n - i } };
  });
  const refs = {};
  for (const b of snap.branches || []) if (objects[b.hash]) refs['refs/heads/' + b.name] = b.hash;
  for (const t of snap.tags || []) if (objects[t.hash]) refs['refs/tags/' + t.name] = t.hash;
  const head = snap.head && snap.head.ref ? { ref: snap.head.ref } : { hash: snap.head && objects[snap.head.hash] ? snap.head.hash : null };
  return new GS.Sim({ state: { fs: {}, dirs: [], global: {}, git: { head, refs, objects, index: {}, conflicts: {}, config: {}, reflog: [], seq: n, mergeHead: null, mergeMsg: null, editMsg: null } } });
}

/* ================================================================== what changed between two snapshots */
function diffSnapshots(a, b) {
  const ev = []; const flow = new Set(); const push = (k, html, f) => { ev.push({ k, html }); if (f) f.forEach(x => flow.add(x)); };
  const code = s => '<code>' + esc(s) + '</code>';
  if (!a) return { ev, flow };
  if (!a.repo && b.repo) { push('info', 'Repository created in this folder (<code>git init</code>).'); return { ev, flow }; }
  if (a.repo && !b.repo) { push('info', 'The repository is gone: the <code>.git</code> folder was deleted.'); return { ev, flow }; }
  if (!b.repo) {
    const wa = new Set((a.wd || []).map(r => r.p)), wb = new Set((b.wd || []).map(r => r.p));
    for (const p of wb) if (!wa.has(p)) push('wd', code(p) + ' created in the folder.', ['wd-edit']);
    for (const p of wa) if (!wb.has(p)) push('wd', code(p) + ' removed from the folder.');
    return { ev, flow };
  }
  const aTip = a.head.hash, bTip = b.head.hash; const aSet = new Set(a.commits.map(c => c.h));
  let headMoved = false, committed = false;
  if (bTip !== aTip) {
    const bc = b.commits.find(c => c.h === bTip);
    if (bTip && !aSet.has(bTip) && bc && (!aTip || bc.p.includes(aTip))) {
      committed = true;
      push('commit', (bc.p.length > 1 ? 'Merge commit ' : 'Committed ') + code(short(bTip)) + ' “' + esc(bc.s) + '” on ' + (b.head.branch ? code(b.head.branch) : 'a detached HEAD') + '.', ['idx>repo']);
    } else if (a.head.branch !== b.head.branch) { headMoved = true; push('head', 'Switched to ' + (b.head.branch ? 'branch ' + code(b.head.branch) : 'a detached HEAD at ' + code(short(bTip))) + '. Git rewrote the index and working directory to match that commit.', ['repo>idx', 'repo>wd']); }
    else { headMoved = true; push('head', 'HEAD moved to ' + code(short(bTip)) + (b.head.branch ? ' on ' + code(b.head.branch) : '') + ' (reset, amend or pull). The index and working directory were rewritten to match.', ['repo>idx', 'repo>wd']); }
  } else if (a.head.branch !== b.head.branch) { headMoved = true; push('head', 'Switched to ' + (b.head.branch ? 'branch ' + code(b.head.branch) : 'a detached HEAD') + ' (same commit, so no files changed).', ['repo>idx']); }
  const ab = new Map((a.branches || []).map(x => [x.name, x.hash])), bb = new Map((b.branches || []).map(x => [x.name, x.hash]));
  for (const [n, h] of bb) { if (!ab.has(n) && committed && n === b.head.branch) continue; if (!ab.has(n)) push('branch', 'Branch ' + code(n) + ' created at ' + code(short(h)) + '.'); else if (ab.get(n) !== h && !(committed && n === b.head.branch)) push('branch', 'Branch ' + code(n) + ' moved to ' + code(short(h)) + '.'); }
  for (const n of ab.keys()) if (!bb.has(n)) push('branch', 'Branch ' + code(n) + ' deleted.');
  const at = new Set((a.tags || []).map(t => t.name)); for (const t of b.tags || []) if (!at.has(t.name)) push('branch', 'Tag ' + code(t.name) + ' created.');
  if (a.state !== b.state) push('info', b.state ? 'Now ' + b.state + '.' : 'No longer ' + a.state + '.');
  if (committed || headMoved) {
    const n = (b.wd || []).filter(r => r.st === 'modified' || r.st === 'untracked').length;
    if (headMoved && !committed) { /* summary already given */ }
    return { ev, flow };
  }
  const m = list => new Map((list || []).map(r => [r.p, r]));
  const wa = m(a.wd), wb = m(b.wd), ia = m(a.index), ib = m(b.index);
  for (const [p, now] of wb) {
    const was = wa.get(p), iNow = ib.get(p), iWas = ia.get(p);
    if (now.st === 'ignored' || (was && was.st === 'ignored')) continue;
    if (now.st === 'untracked' && !was) { push('wd', code(p) + ' created (untracked).', ['wd-edit']); continue; }
    if (now.st === 'conflict' && (!was || was.st !== 'conflict')) { push('wd', code(p) + ' has a merge conflict.'); continue; }
    if (iNow && iNow.tag && iNow.tag !== (iWas && iWas.tag) && iNow.tag !== 'conflict') {
      push('stage', code(p) + (iNow.tag === 'new' ? ' added to the index (<code>git add</code>).' : iNow.tag === 'deleted' ? ': deletion staged.' : iNow.tag === 'renamed' ? ' renamed from ' + code(iNow.from || '?') + ' and staged.' : ' staged (<code>git add</code>).'), ['wd>idx']); continue;
    }
    if (iWas && iWas.tag && iNow && !iNow.tag) { push('stage', code(p) + ' un-staged: the index matches the last commit again.', ['idx>repo-back']); continue; }
    if (now.st === 'modified' && (!was || was.st !== 'modified')) { push('wd', code(p) + ' edited in the working directory.', ['wd-edit']); continue; }
    if (now.st === 'deleted' && (!was || was.st !== 'deleted')) { push('wd', code(p) + ' deleted from disk (Git has not been told yet).'); continue; }
    if (was && was.st === 'modified' && now.st === 'clean' && iNow && iWas && iNow.h === iWas.h) { push('wd', code(p) + ': edits discarded, file matches the index again.', ['idx>wd-back']); continue; }
    if (was && was.st === 'untracked' && now.st !== 'untracked' && !(iNow && iNow.tag)) { push('wd', code(p) + ' is now tracked.'); continue; }
  }
  for (const [p, was] of wa) if (!wb.has(p) && was.st === 'untracked') push('wd', code(p) + ' removed from the folder.');
  for (const [p, was] of wa) { const now = wb.get(p); if (was.st === 'deleted' && now && now.st === 'clean') push('wd', code(p) + ' restored.', ['idx>wd-back']); }
  if (ev.length > 14) { const extra = ev.length - 12; ev.length = 12; ev.push({ k: 'info', html: 'and ' + extra + ' more changes.' }); }
  return { ev, flow };
}
Live.diffSnapshots = diffSnapshots;

/* ================================================================== the three areas, from a snapshot */
class LiveAreas {
  constructor(root, o) {
    this.root = root; this.o = o || {}; this.sel = null;
    this.f = { wd: U.fresher(), idx: U.fresher(), repo: U.fresher() };
    root.classList.add('areas-view', 'live-areas');
    root.innerHTML = U.AreasView.prototype.shell.call({ o: { caption: true, preview: false, happened: false } });
    this.q = s => U.$(s, root);
    this.light = U.AreasView.prototype.light;
    root.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b && this.o.onSelect) this.o.onSelect({ p: b.dataset.pick, area: b.dataset.area, st: b.dataset.st }); });
  }
  forget() { Object.values(this.f).forEach(x => x.forget()); }
  row(r, f, area) {
    const nm = r.dir || r.noPick ? `<span class="fname">${esc(r.name)}</span>` : `<button type="button" class="fname" data-pick="${esc(r.p)}" data-area="${area}" data-st="${esc(r.st || '')}" title="Show what changed in ${esc(r.p)}">${esc(r.name)}</button>`;
    return `<li class="row ${r.cls || ''}${r.p === this.sel ? ' sel' : ''}${f.cls(r.key)}" title="${r.h ? esc(r.h) : ''}">${r.h ? sw(r.h) : '<i class="sw ghost"></i>'}${nm}<code class="hx">${r.h ? short(r.h) : ''}</code>${r.tag ? `<span class="chip ${r.cls || ''}">${esc(r.tag)}</span>` : '<span></span>'}</li>`;
  }
  render(snap, flow) {
    const tr = snap.truncated || {};
    const more = n => n ? `<li class="empty">+ ${n} more not shown</li>` : '';
    // working directory
    const fw = this.f.wd; fw.begin(); let h = '';
    const TAG = { untracked: ['untracked', 'unt'], modified: ['edited', 'mod'], deleted: ['deleted', 'del'], conflict: ['conflict', 'bad'], ignored: ['ignored', 'ign'], clean: ['', 'same'], plain: ['', ''] };
    const wd = snap.wd || [];
    for (const r of wd) { const [tag, cls] = TAG[r.st] || ['', '']; h += this.row({ p: r.p, name: r.p, h: r.h, tag, cls, key: r.p + ':' + r.st + ':' + r.h, st: r.st, dir: r.dir && r.st === 'ignored' }, fw, 'wd'); }
    this.q('[data-r="wd"]').innerHTML = (h || '<li class="empty">No files here.</li>') + more(tr.untracked) + more(tr.wd); fw.end();
    const filesN = wd.filter(r => r.st !== 'ignored' && r.st !== 'deleted').length;
    this.q('[data-f="wd"]').textContent = filesN + (filesN === 1 ? ' file' : ' files') + (snap.counts && snap.counts.ignored ? ' + ' + snap.counts.ignored + ' ignored' : '');
    // index
    const fi = this.f.idx; fi.begin(); h = '';
    if (!snap.repo) h = '<li class="empty">No repository yet.<br>Run <code>git init</code>.</li>';
    else {
      const TG = { new: ['new', 'stg'], modified: ['modified', 'stg'], deleted: ['deleted', 'del'], renamed: ['renamed', 'stg'], conflict: ['conflict', 'bad'], '': ['', 'same'] };
      for (const r of snap.index || []) { const [tag, cls] = TG[r.tag || ''] || ['', 'same']; h += this.row({ p: r.p, name: r.tag === 'renamed' && r.from ? r.from + ' → ' + r.p : r.p, h: r.h, tag, cls, key: r.p + ':' + r.tag + ':' + r.h, st: r.tag }, fi, 'idx'); }
      if (!h) h = '<li class="empty">Empty. <code>git add</code> copies files here.</li>';
      h += more(tr.index);
    }
    this.q('[data-r="idx"]').innerHTML = h; fi.end();
    this.q('[data-f="idx"]').textContent = snap.repo ? (snap.index || []).filter(r => r.tag !== 'deleted').length + ' entries' : '';
    // repository
    const fr = this.f.repo; fr.begin(); h = '';
    if (!snap.repo) h = '<li class="empty">No <code>.git</code> folder yet.</li>';
    else if (!snap.head.hash) h = `<li class="empty">No commits yet.<br><code>HEAD</code> points at <code>${esc(snap.head.ref || '')}</code>, which does not exist until the first commit.</li>`;
    else {
      const c = snap.commits.find(x => x.h === snap.head.hash);
      h += `<li class="headline ${fr.cls('h:' + snap.head.hash)}"><b>${snap.head.branch ? 'HEAD → ' + esc(snap.head.branch) : 'HEAD (detached)'}</b> <code>${short(snap.head.hash)}</code> <span class="msg">${c ? esc(c.s) : ''}</span></li>`;
      for (const r of snap.repo) h += this.row({ p: r.p, name: r.p, h: r.h, tag: '', cls: 'same', key: snap.head.hash + ':' + r.p + ':' + r.h, st: 'head' }, fr, 'repo');
      h += more(tr.repo);
    }
    this.q('[data-r="repo"]').innerHTML = h; fr.end();
    this.q('[data-f="repo"]').textContent = snap.repo ? snap.commits.length + (snap.commits.length >= 300 ? '+' : '') + ' commits, ' + (snap.branches || []).length + ' branches' : '';
    this.root.classList.toggle('no-repo', !snap.repo);
    if (flow && flow.size) this.light([...flow]);
  }
}

/* ================================================================== connection to the helper */
class HelperClient {
  constructor(o) { this.base = (o.base || '').replace(/\/$/, ''); this.token = o.token || ''; this.es = null; this.onState = () => {}; this.onStatus = () => {}; }
  headers() { return { 'X-Git-Live-Token': this.token, 'Content-Type': 'application/json' }; }
  async ping() {
    try { const r = await fetch(this.base + '/api/ping', { cache: 'no-store' }); const j = await r.json(); return !!(j && j.app === 'git-watch'); } catch (e) { return false; }
  }
  async checkToken() {
    try { const r = await fetch(this.base + '/api/state', { headers: this.headers(), cache: 'no-store' }); if (r.status === 401) return { ok: false, error: 'That pairing code is not right. Copy it from the cmd window.' }; const j = await r.json(); return { ok: true, folder: j.folder, snapshot: j.snapshot }; } catch (e) { return { ok: false, error: 'Could not reach the helper.' }; }
  }
  async watch(path) {
    try { const r = await fetch(this.base + '/api/watch', { method: 'POST', headers: this.headers(), body: JSON.stringify({ path }) }); return await r.json(); } catch (e) { return { ok: false, error: 'Could not reach the helper.' }; }
  }
  async get(p, params) {
    const q = new URLSearchParams(params || {}).toString();
    try { const r = await fetch(this.base + p + (q ? '?' + q : ''), { headers: this.headers(), cache: 'no-store' }); return await r.json(); } catch (e) { return { ok: false, error: 'The helper stopped answering.' }; }
  }
  open() {
    this.close();
    const es = this.es = new EventSource(this.base + '/api/events?token=' + encodeURIComponent(this.token));
    es.addEventListener('state', ev => { try { this.onState(JSON.parse(ev.data)); } catch (e) { /* ignore a partial event */ } });
    es.onopen = () => this.onStatus('live');
    es.onerror = () => this.onStatus('lost');
  }
  close() { if (this.es) { this.es.close(); this.es = null; } }
}

/* ================================================================== the page */
const DEMO_STEPS = [
  { run: [] },
  { run: ['git init'] },
  { run: ['git add hello.txt'] },
  { run: [{ write: ['hello.txt', 'Hello from Git\nA second line\n'] }] },
  { run: ['git add hello.txt'] },
  { run: ['git commit -m "Say hello"'] },
  { run: [{ write: ['notes.txt', 'buy milk\nbuy bread\n'] }] },
  { run: ['git add .'] },
  { run: ['git commit -m "Add notes"'] },
  { run: ['git switch -c feature'] },
  { run: [{ write: ['hello.txt', 'Hello from Git\nA second line\nA feature line\n'] }] },
  { run: ['git commit -am "Feature work"'] },
  { run: ['git switch main'] },
  { run: ['git merge feature'] },
  { run: ['rm notes.txt'] },
  { run: ['git rm notes.txt'] },
  { run: ['git commit -m "Remove notes"'] }
];
const KEY = 'gitlive.conn.v1';

Live.html = function () {
  return `<div class="page-head wrap"><p class="eyebrow">Live repo</p><h2>Watch a real folder as you work in cmd</h2>
    <p class="lede">Point this page at a folder on your computer, run your usual <code>git</code> commands in cmd, and watch the working directory, the staging area and the history change here as they happen.</p></div>
  <div class="wrap live">
    <section class="panel live-connect" aria-label="Connection">
      <div class="seg live-seg" role="tablist" aria-label="Source"><button type="button" data-src="helper" class="on">My folder</button><button type="button" data-src="demo">Demo</button><button type="button" data-src="mirror">Mirror the lab</button></div>
      <div class="lc-body" data-body></div>
    </section>
    <section class="live-dash" data-dash hidden>
      <div class="panel live-top" data-top></div>
      <div class="panel live-areas-panel"><div class="panel-h"><h3>The three places, from the real repository</h3><p class="panel-sub">Click a file to see what changed in it.</p></div><div data-areas></div></div>
      <div class="live-split">
        <div class="panel live-feed"><div class="panel-h"><h3>What just changed</h3><p class="panel-sub">newest first</p></div><ol class="feed" data-feed><li class="feed-empty">Make a change in your folder and it appears here.</li></ol>
          <div class="panel-h sub"><h3>Recent HEAD moves</h3><p class="panel-sub">from <code>git reflog</code></p></div><ol class="reflog" data-reflog></ol></div>
        <div class="panel live-diff"><div class="panel-h"><h3 data-diff-title>Diff</h3></div><div class="diff-tabs" data-diff-tabs hidden></div><pre class="diff" data-diff><span class="d-empty">Pick a file on the left to read its diff.</span></pre></div>
      </div>
      <div class="panel live-graph"><div class="panel-h"><h3>History</h3><p class="panel-sub">Click a commit to see its files.</p></div><div data-graph></div><div class="commit-detail" data-cdetail></div><div class="refs-wrap" data-refs></div></div>
    </section>
  </div>`;
};

Live.mount = function (el, app) {
  this.el = el; this.app = app; this.prev = null; this.feed = []; this.mode = 'helper'; this.snap = null; this.picked = null; this.client = null;
  const boot = window.__GITLIVE__ || null; this.boot = boot;
  const saved = U.store.get(KEY, {});
  this.conn = { base: boot ? '' : (saved.base || 'http://localhost:4781'), token: boot ? boot.token : (saved.token || ''), folder: saved.folder || (boot && boot.folder) || '' };
  this.lws = new U.Workspace({});                       // holds a synthetic simulator for the graph and refs views
  this.areas = new LiveAreas($('[data-areas]', el), { onSelect: s => this.pick(s) });
  this.graph = new U.GraphView($('[data-graph]', el), this.lws, { detail: false, onSelect: h => this.showCommit(h) });
  this.refs = new U.RefsView($('[data-refs]', el), this.lws);
  $('.live-seg', el).addEventListener('click', e => { const b = e.target.closest('[data-src]'); if (b) this.setSource(b.dataset.src); });
  el.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.watch != null) this.watchFolder();
    else if (t.dataset.connect != null) this.connectHelper();
    else if (t.dataset.copy) U.copy(t.dataset.copy).then(ok => U.toast(ok ? 'Copied' : 'Copy was blocked: select the text instead'));
    else if (t.dataset.demo) this.demoControl(t.dataset.demo);
    else if (t.dataset.dtab) this.loadDiff(this.picked, t.dataset.dtab);
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-path]')) { e.preventDefault(); this.watchFolder(); } });
  this.setSource('helper');
};
Live.show = function () { if (this.mode === 'helper' && !this.client) this.autoConnect(); if (this.mode === 'demo') this.demoStart(); };
Live.hide = function () { clearInterval(this.demoTimer); this.demoTimer = null; };

Live.setSource = function (src) {
  this.mode = src; clearInterval(this.demoTimer); this.demoTimer = null;
  if (this.client) { this.client.close(); this.client = null; }
  if (this.mirrorOff) { this.mirrorOff(); this.mirrorOff = null; }
  $$('.live-seg button', this.el).forEach(b => b.classList.toggle('on', b.dataset.src === src));
  this.prev = null; this.snap = null; this.picked = null; this.feed = []; this.renderFeed(); this.areas.forget(); this.status = null;
  $('[data-dash]', this.el).hidden = true;
  this.renderBody();
  if (src === 'helper') this.autoConnect();
  else if (src === 'demo') this.demoStart(true);
  else if (src === 'mirror') this.mirrorStart();
};

Live.renderBody = function () {
  const b = $('[data-body]', this.el);
  if (this.mode === 'helper') {
    const same = !!this.boot;
    b.innerHTML = `<div class="lc-status" data-status><i class="sdot s-wait"></i><span>Looking for the helper…</span></div>
      <div class="lc-setup" data-setup hidden>
        <ol class="lc-steps">
          <li>Double-click <b>start-website.bat</b>, or open <b>cmd</b> in the folder that holds <code>git-watch.js</code> and run:<div class="cmdrow"><code>node git-watch.js</code><button type="button" class="mini-btn" data-copy="node git-watch.js">Copy</button></div></li>
          <li>It opens <code>http://localhost:4781</code> in your browser. <b>Use that page</b>: it connects by itself.</li>
          <li>Opened this site as a file instead? Enter the helper address and the pairing code printed in cmd:
            <div class="lc-conn"><label for="lc-base">Helper address</label><input id="lc-base" type="text" value="${esc(this.conn.base)}" spellcheck="false"><label for="lc-token">Pairing code</label><input id="lc-token" type="text" value="${esc(this.conn.token)}" placeholder="ab12-cd34-ef56" spellcheck="false"><button type="button" class="btn" data-connect>Connect</button></div></li>
        </ol>
        <p class="mini">The helper only runs read-only <code>git</code> commands on the folder you name, listens on your own computer only, and never changes your repository. This hosted page cannot reach it: use the offline file or the address the helper opens.</p>
      </div>
      <form class="lc-folder" data-folder hidden onsubmit="return false">
        <label for="lc-path">Folder to watch</label>
        <div class="lc-row"><input id="lc-path" data-path type="text" value="${esc(this.conn.folder || '')}" placeholder="C:\\Users\\you\\gitlearning" spellcheck="false" autocomplete="off"><button type="button" class="btn primary" data-watch>Watch this folder</button></div>
        <p class="mini">Paste the full path. In Explorer: hold Shift, right-click the folder, choose <b>Copy as path</b>. Then use cmd in that folder as usual.</p>
        <p class="lc-msg" data-msg role="status"></p>
      </form>`;
  } else if (this.mode === 'demo') {
    b.innerHTML = `<div class="lc-status"><i class="sdot s-live"></i><span>Demo: a scripted session on a pretend folder. Same view as the real thing, no helper needed.</span></div>
      <div class="lc-demo"><button type="button" class="btn" data-demo="toggle" data-t>Pause</button><button type="button" class="btn" data-demo="step">Step</button><button type="button" class="btn" data-demo="restart">Restart</button><code class="lc-cmd" data-demo-cmd>$ …</code></div>`;
  } else {
    b.innerHTML = `<div class="lc-status"><i class="sdot s-live"></i><span>Mirroring the repository from the <b>Lab</b> page. Run commands there and watch them land here.</span></div>`;
  }
};
Live.setStatus = function (kind, text) {
  const s = $('[data-status]', this.el); if (!s) return;
  s.innerHTML = `<i class="sdot s-${kind}"></i><span>${text}</span>`;
};

/* ---- helper mode */
Live.autoConnect = async function () {
  const b = this.conn;
  this.client = new HelperClient({ base: b.base, token: b.token });
  this.setStatus('wait', 'Looking for the helper…');
  const up = await this.client.ping();
  if (this.mode !== 'helper') return;
  if (!up) { this.client = null; this.setStatus('off', 'The helper is not running (or this page cannot reach it).'); $('[data-setup]', this.el).hidden = false; $('[data-folder]', this.el).hidden = true; return; }
  if (!b.token && !this.boot) { this.client = null; this.setStatus('wait', 'Helper found. Enter its pairing code to connect.'); $('[data-setup]', this.el).hidden = false; return; }
  await this.attach();
};
Live.connectHelper = async function () {
  this.conn.base = $('#lc-base', this.el).value.trim() || 'http://localhost:4781'; this.conn.token = $('#lc-token', this.el).value.trim();
  U.store.set(KEY, { base: this.conn.base, token: this.conn.token, folder: this.conn.folder });
  await this.autoConnect();
};
Live.attach = async function () {
  const cl = this.client; const chk = await cl.checkToken();
  if (!chk.ok) { this.setStatus('off', esc(chk.error)); $('[data-setup]', this.el).hidden = false; this.client = null; return; }
  $('[data-setup]', this.el).hidden = !!this.boot ? true : true; $('[data-folder]', this.el).hidden = false;
  cl.onState = s => this.receive(s);
  cl.onStatus = k => { if (k === 'live') this.setStatus('live', 'Connected. ' + (this.snap && this.snap.folder ? 'Watching <code>' + esc(this.snap.folder) + '</code>' : 'Enter a folder to watch.')); else this.setStatus('wait', 'Connection lost. Reconnecting…'); };
  cl.open();
  if (chk.folder) { $('[data-path]', this.el).value = chk.folder; this.conn.folder = chk.folder; }
  else if (this.conn.folder) this.watchFolder(true);
  this.setStatus('live', 'Connected to the helper. ' + (chk.folder ? 'Watching <code>' + esc(chk.folder) + '</code>' : 'Enter a folder to watch.'));
};
Live.watchFolder = async function (quiet) {
  if (!this.client) return this.autoConnect();
  const path = $('[data-path]', this.el).value.trim(); const msg = $('[data-msg]', this.el);
  if (!path) { msg.textContent = 'Paste a folder path first.'; msg.className = 'lc-msg bad'; return; }
  msg.textContent = 'Checking…'; msg.className = 'lc-msg';
  const r = await this.client.watch(path);
  if (!r.ok) { msg.textContent = r.error || 'That did not work.'; msg.className = 'lc-msg bad'; return; }
  this.conn.folder = r.folder; U.store.set(KEY, { base: this.conn.base, token: this.boot ? '' : this.conn.token, folder: r.folder });
  msg.textContent = r.snapshot && r.snapshot.repo ? 'Watching. Go to cmd and run a git command.' : 'Watching. This folder is not a repository yet: run git init in it.'; msg.className = 'lc-msg ok';
  this.prev = null; this.feed = []; this.renderFeed(); this.areas.forget();
  if (r.snapshot) this.receive(r.snapshot);
  this.setStatus('live', 'Connected. Watching <code>' + esc(r.folder) + '</code>');
};

/* ---- demo + mirror modes */
Live.demoStart = function (restart) {
  if (restart || !this.demoWs) { this.demoWs = new U.Workspace({ files: { 'hello.txt': 'Hello from Git\n', 'notes.txt': 'buy milk\n' } }); this.demoI = 0; this.prev = null; this.feed = []; this.renderFeed(); this.areas.forget(); this.demoPaused = U.reducedMotion(); this.demoTick(true); }
  const t = $('[data-t]', this.el); if (t) t.textContent = this.demoPaused ? 'Play' : 'Pause';
  clearInterval(this.demoTimer);
  this.demoTimer = setInterval(() => { if (!document.hidden && !this.demoPaused && App_isLive()) this.demoTick(); }, 2600);
};
function App_isLive() { return U.App && U.App.cur === 'live'; }
Live.demoTick = function (first) {
  const ws = this.demoWs; const cmdEl = $('[data-demo-cmd]', this.el);
  if (first && this.demoI === 0) { this.receive(U.snapshotFromSim(ws.sim, '~/pretend-folder (demo)')); if (cmdEl) cmdEl.textContent = '$ (an ordinary folder with two files)'; this.demoI = 1; return; }
  if (this.demoI >= DEMO_STEPS.length) { this.demoI = 0; this.demoWs = new U.Workspace({ files: { 'hello.txt': 'Hello from Git\n', 'notes.txt': 'buy milk\n' } }); this.prev = null; this.areas.forget(); this.feed = []; this.renderFeed(); this.receive(U.snapshotFromSim(this.demoWs.sim, '~/pretend-folder (demo)')); this.demoI = 1; return; }
  const step = DEMO_STEPS[this.demoI++]; let label = '';
  for (const it of step.run) { if (typeof it === 'string') { ws.run(it); label = it; } else if (it.write) { ws.write(it.write[0], it.write[1]); label = '(edit ' + it.write[0] + ' in your editor)'; } }
  if (cmdEl) cmdEl.textContent = '$ ' + (label || '…');
  this.receive(U.snapshotFromSim(ws.sim, '~/pretend-folder (demo)'));
};
Live.demoControl = function (what) {
  if (what === 'toggle') { this.demoPaused = !this.demoPaused; const t = $('[data-t]', this.el); if (t) t.textContent = this.demoPaused ? 'Play' : 'Pause'; }
  else if (what === 'step') this.demoTick();
  else if (what === 'restart') this.demoStart(true);
};
Live.mirrorStart = function () {
  const lab = U.Lab && U.Lab.ws; if (!lab) return;
  const push = () => this.receive(U.snapshotFromSim(lab.sim, '~/my-project (the Lab repository)'));
  const fn = () => push(); lab.on(fn); const idx = lab.listeners.length - 1;
  this.mirrorOff = () => { lab.listeners.splice(lab.listeners.indexOf(fn), 1); };
  push();
};

/* ---- shared: receive a snapshot, redraw, update the feed */
Live.receive = function (snap) {
  this.snap = snap;
  const d = diffSnapshots(this.prev, snap);
  const showFeed = this.prev != null;
  if (showFeed) {
    const now = new Date(); const hh = now.toTimeString().slice(0, 8);
    for (const e of d.ev.reverse()) this.feed.unshift({ k: e.k, html: e.html, time: hh });
    this.feed = this.feed.slice(0, 80); this.renderFeed();
  } else if (snap.repo !== undefined) { this.feed = [{ k: 'info', html: snap.repo ? 'Connected. ' + (snap.head && snap.head.hash ? 'HEAD is at <code>' + short(snap.head.hash) + '</code>.' : 'No commits yet.') : 'Watching a folder that is not a repository yet.', time: new Date().toTimeString().slice(0, 8) }]; this.renderFeed(); }
  const dash = $('[data-dash]', this.el); dash.hidden = false;
  if (this.mode === 'helper' && this.client && snap.folder) this.setStatus('live', 'Connected. Watching <code>' + esc(snap.folder) + '</code>');
  this.renderTop(snap);
  this.areas.render(snap, showFeed ? d.flow : null);
  if (snap.repo) { this.lws.sim = simFromSnapshot(snap); this.lws.emit(null, 'sync'); } else { this.lws.sim = new GS.Sim({ state: { fs: {}, dirs: [], git: null, global: {} } }); this.lws.emit(null, 'sync'); }
  this.renderReflog(snap);
  if (this.picked) this.refreshPicked(snap);
  this.prev = snap;
  const t = $('[data-updated]', this.el); if (t) { t.textContent = 'Updated ' + new Date().toTimeString().slice(0, 8); t.classList.remove('blink'); void t.offsetWidth; t.classList.add('blink'); }
};
Live.renderTop = function (s) {
  const top = $('[data-top]', this.el);
  if (!s.repo) { top.innerHTML = `<div class="lt-main"><span class="lt-folder"><code>${esc(s.folder || '')}</code></span><span class="lt-pill warn">not a repository</span></div><p class="lt-note">${esc(s.message || s.error || '')}</p><span class="lt-upd" data-updated></span>`; return; }
  const h = s.head; const c = s.counts || {};
  const where = h.detached ? `HEAD detached at <code>${short(h.hash)}</code>` : `on branch <b>${esc(h.branch)}</b>${h.hash ? ' · <code>' + short(h.hash) + '</code>' : ' · no commits yet'}`;
  const chips = [['staged', c.staged, 'stg'], ['changed, not staged', c.modified, 'mod'], ['untracked', c.untracked, 'unt'], ['conflicts', c.conflicts, 'bad'], ['ignored', c.ignored, 'ign']].map(([l, n, cls]) => `<span class="lt-chip ${n ? cls : 'zero'}"><b>${n || 0}</b> ${l}</span>`).join('');
  top.innerHTML = `<div class="lt-main"><span class="lt-folder"><code>${esc(s.root || s.folder || '')}</code></span><span class="lt-where">${where}</span>${s.upstream ? `<span class="lt-pill">${esc(s.upstream.name)} ↑${s.upstream.ahead} ↓${s.upstream.behind}</span>` : ''}${s.state ? `<span class="lt-pill warn">${esc(s.state)}</span>` : ''}</div>
    <div class="lt-chips">${chips}${s.counts && s.counts.staged === 0 && s.counts.modified === 0 && s.counts.untracked === 0 && s.head.hash ? '<span class="lt-chip ok">working tree clean</span>' : ''}</div><span class="lt-upd"><i class="pulse-dot" aria-hidden="true"></i><span data-updated>live</span>${s.ms ? ' · ' + s.ms + ' ms' : ''}</span>`;
};
Live.renderFeed = function () {
  const ol = $('[data-feed]', this.el);
  ol.innerHTML = this.feed.length ? this.feed.map((e, i) => `<li class="k-${e.k}${i === 0 ? ' fresh' : ''}"><time>${esc(e.time)}</time><span>${e.html}</span></li>`).join('') : '<li class="feed-empty">Make a change in your folder and it appears here.</li>';
};
Live.renderReflog = function (s) {
  const ol = $('[data-reflog]', this.el);
  ol.innerHTML = (s.reflog || []).length ? s.reflog.slice(0, 8).map((r, i) => `<li><code>${short(r.h)}</code> <span>HEAD@{${i}}: ${esc(r.m)}</span></li>`).join('') : '<li class="feed-empty">Nothing yet. The reflog fills up as HEAD moves.</li>';
};

/* ---- diff + commit detail */
Live.pick = function (sel) {
  this.picked = sel; this.areas.sel = sel.p; if (this.snap) this.areas.render(this.snap, null);
  const tabs = $('[data-diff-tabs]', this.el);
  const opts = sel.st === 'untracked' ? [['file', 'File contents']] : sel.area === 'repo' ? [['head', 'vs HEAD']] : [['unstaged', 'Unstaged'], ['staged', 'Staged'], ['head', 'vs last commit']];
  tabs.hidden = false;
  const def = sel.st === 'untracked' || sel.st === 'plain' ? 'file' : sel.area === 'idx' ? 'staged' : sel.area === 'repo' ? 'head' : 'unstaged';
  this.diffMode = def; this.diffOpts = opts;
  this.loadDiff(sel, def);
};
Live.refreshPicked = function (snap) { if (this.picked && !this.diffBusy) this.loadDiff(this.picked, this.diffMode, true); };
Live.loadDiff = async function (sel, mode, quiet) {
  if (!sel) return; this.diffMode = mode; this.diffBusy = true;
  const tabs = $('[data-diff-tabs]', this.el);
  tabs.innerHTML = (this.diffOpts || []).map(([m, l]) => `<button type="button" data-dtab="${m}" class="${m === mode ? 'on' : ''}">${l}</button>`).join('');
  $('[data-diff-title]', this.el).innerHTML = 'Diff: <code>' + esc(sel.p) + '</code>';
  const pre = $('[data-diff]', this.el); let text = '', ok = true;
  if (this.mode === 'helper' && this.client) { const r = await this.client.get('/api/diff', { path: sel.p, mode }); ok = r.ok; text = r.ok ? r.text : r.error; }
  else {
    const sim = (this.mode === 'demo' ? this.demoWs : U.Lab.ws).sim;
    try {
      if (mode === 'file') text = sim.s.fs[sel.p] !== undefined ? sim.s.fs[sel.p] : '(file not found)';
      else text = GS.stripAnsi(GS.git.diff(sim, mode === 'staged' ? ['--staged', '--', sel.p] : mode === 'head' ? ['HEAD', '--', sel.p] : ['--', sel.p], { r: {} }));
    } catch (e) { ok = false; text = e.message; }
  }
  this.diffBusy = false;
  if (!ok) { pre.innerHTML = `<span class="d-err">${esc(text)}</span>`; return; }
  if (!text.trim()) { pre.innerHTML = '<span class="d-empty">' + (mode === 'unstaged' ? 'No unstaged changes in this file.' : mode === 'staged' ? 'Nothing from this file is staged.' : 'No differences.') + '</span>'; return; }
  pre.innerHTML = mode === 'file' ? esc(text) : text.split('\n').map(l => `<span class="${/^(\+\+\+|---)/.test(l) ? 'd-file' : /^diff |^index |^new file|^deleted file|^similarity|^rename/.test(l) ? 'd-meta' : l[0] === '+' ? 'd-add' : l[0] === '-' ? 'd-del' : l.startsWith('@@') ? 'd-hunk' : ''}">${esc(l)}</span>`).join('\n');
};
Live.showCommit = async function (h) {
  const box = $('[data-cdetail]', this.el); const c = this.snap && this.snap.commits.find(x => x.h === h); if (!c) return;
  const base = `<div class="cd-row"><span class="cd-k">commit</span><code>${h}</code></div><div class="cd-row"><span class="cd-k">message</span><span class="cd-v">${esc(c.s)}</span></div><div class="cd-row"><span class="cd-k">parents</span><span class="cd-v">${c.p.length ? c.p.map(p => `<code>${short(p)}</code>`).join(' + ') : '<i>none: root commit</i>'}</span></div><div class="cd-row"><span class="cd-k">by</span><span class="cd-v">${esc(c.a || '')}${c.t ? ', ' + new Date(c.t * 1000).toLocaleString() : ''}</span></div>`;
  box.innerHTML = base + '<div class="cd-row"><span class="cd-k">files</span><span class="cd-v mini">loading…</span></div>';
  let files = null;
  if (this.mode === 'helper' && this.client) { const r = await this.client.get('/api/commit', { h }); if (r.ok) files = r.files.map(f => ({ st: f.st, p: f.p })); }
  else { const sim = (this.mode === 'demo' ? this.demoWs : U.Lab.ws).sim; if (sim.obj(h)) { const cc = sim.obj(h).data; files = sim.diffFlat(sim.commitFlat(cc.parents[0]), sim.commitFlat(h), { renames: true }).map(x => ({ st: x.st, p: x.path })); } }
  box.innerHTML = base + `<div class="cd-row"><span class="cd-k">files</span><span class="cd-files">${files && files.length ? files.map(f => `<span class="cd-file st-${f.st}"><b>${esc(f.st)}</b>${esc(f.p)}</span>`).join('') : '<span class="mini">no file changes</span>'}</span></div>`;
};
})(GS);
