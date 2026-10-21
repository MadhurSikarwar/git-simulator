/* Site: reusable views. Each takes a root element and a Workspace and keeps itself in sync. */
(function (GS) {
'use strict';
const U = GS.ui; const { esc, sw, hashColor, ansi } = U; const short = GS.short;

const FLOW = {
  'wd>idx': ['wi-f'], 'idx>repo': ['ir-f'], 'idx>repo-back': ['ir-b'], 'idx>wd-back': ['wi-b'],
  'repo>idx': ['ir-b'], 'repo>wd': ['ir-b', 'wi-b'], 'idx>wd': ['wi-b'], 'idx-only': ['wi-f']
};

/* ================================================================== AreasView */
class AreasView {
  constructor(root, ws, o = {}) {
    this.root = root; this.ws = ws;
    this.o = Object.assign({ editable: false, preview: false, happened: false, caption: true }, o);
    this.f = { wd: U.fresher(), idx: U.fresher(), repo: U.fresher() };
    this.previewOn = !!o.previewOn;
    root.classList.add('areas-view');
    root.innerHTML = this.shell();
    this.q = s => U.$(s, root);
    this.bind();
    ws.on((res, kind) => { if (kind === 'reset') Object.values(this.f).forEach(x => x.forget()); this.render(res, kind); });
    this.render(null, 'sync');
  }
  shell() {
    const o = this.o;
    return `<div class="areas-grid">
      <div class="area wd">
        <div class="area-h"><h3>Working directory</h3>${o.caption ? '<p>your files on disk</p><em>tags compare with the index</em>' : ''}</div>
        <ul class="rows" data-r="wd"></ul><div class="area-f" data-f="wd"></div>
      </div>
      <div class="gutter">
        <div class="arrow f" data-a="wi-f"><span class="lbl">git add</span><span class="ln"></span></div>
        <div class="arrow b" data-a="wi-b"><span class="lbl">git restore</span><span class="ln"></span></div>
      </div>
      <div class="area idx">
        <div class="area-h"><h3>Index <small>staging area</small></h3>${o.caption ? '<p>.git/index: the next commit, drafted</p><em>tags compare with the last commit</em>' : ''}</div>
        <ul class="rows" data-r="idx"></ul><div class="area-f" data-f="idx"></div>
      </div>
      <div class="gutter">
        <div class="arrow f" data-a="ir-f"><span class="lbl">git commit</span><span class="ln"></span></div>
        <div class="arrow b" data-a="ir-b"><span class="lbl">git reset or<br> restore --staged</span><span class="ln"></span></div>
      </div>
      <div class="area repo">
        <div class="area-h"><h3>Repository</h3>${o.caption ? '<p>.git/objects + refs: permanent history</p><em>the snapshot HEAD points to</em>' : ''}</div>
        <ul class="rows" data-r="repo"></ul><div class="area-f" data-f="repo"></div>
      </div>
    </div>
    ${o.preview ? `<div class="preview-bar">
        <button type="button" class="mini-btn" data-act="preview" aria-expanded="false">Show page preview</button>
        <button type="button" class="mini-btn" data-act="newfile">New file</button>
        <span class="mini">Click a file name to edit it. Squares share a colour when the content (hash) is identical.</span>
      </div>
      <div class="preview" data-pv hidden><iframe title="Rendered preview of index.html in your working directory" sandbox=""></iframe></div>` : ''}
    ${o.happened ? '<div class="happened" data-h></div>' : ''}`;
  }
  bind() {
    this.root.addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]');
      if (ed && this.o.onEdit) { this.o.onEdit(ed.getAttribute('data-edit')); return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'newfile' && this.o.onNewFile) this.o.onNewFile();
      if (act.dataset.act === 'preview') this.togglePreview();
    });
  }
  togglePreview(force) {
    this.previewOn = force == null ? !this.previewOn : force;
    const b = this.q('[data-act="preview"]'); const pv = this.q('[data-pv]');
    if (!b || !pv) return;
    b.textContent = this.previewOn ? 'Hide page preview' : 'Show page preview';
    b.setAttribute('aria-expanded', String(this.previewOn));
    pv.hidden = !this.previewOn;
    this.updatePreview(true);
    if (this.o.onPreviewToggle) this.o.onPreviewToggle(this.previewOn);
  }
  updatePreview(force) {
    const pv = this.q('[data-pv]'); if (!pv || !this.previewOn) return;
    const fs = this.ws.sim.s.fs;
    let html = fs['index.html'];
    if (html === undefined) html = '<p style="font:14px sans-serif;padding:1rem">No index.html in the working directory.</p>';
    html = html.replace(/<link[^>]+href=["']style\.css["'][^>]*>/i, () => '<style>' + (fs['style.css'] || '') + '</style>');
    const frame = U.$('iframe', pv);
    if (force || frame.srcdoc !== html) frame.srcdoc = html;
  }
  row(r, f) {
    const nm = r.edit ? `<button type="button" class="fname" data-edit="${esc(r.name)}" title="Edit ${esc(r.name)}">${esc(r.name)}</button>` : `<span class="fname">${esc(r.name)}</span>`;
    return `<li class="row ${r.cls || ''}${f.cls(r.key)}" title="${r.h ? esc(r.h) : ''}">${r.h ? sw(r.h) : '<i class="sw ghost"></i>'}${nm}<code class="hx">${r.h ? short(r.h) : ''}</code>${r.tag ? `<span class="chip ${r.cls || ''}">${r.tag}</span>` : '<span></span>'}</li>`;
  }
  render(res, kind) {
    const sim = this.ws.sim, g = sim.s.git;
    const idx = g ? g.index : {}; const head = g && sim.headHash() ? sim.headFlat() : {};
    const fs = sim.s.fs;
    // working directory
    const fw = this.f.wd; fw.begin(); let html = '';
    const names = Object.keys(fs).sort();
    for (const p of names) {
      const h = GS.hashBlob(fs[p]); let tag = '', cls = '';
      if (g) {
        if (g.conflicts && g.conflicts[p]) { tag = 'conflict'; cls = 'bad'; }
        else if (!idx[p]) { if (sim.isIgnored(p)) { tag = 'ignored'; cls = 'ign'; } else { tag = 'untracked'; cls = 'unt'; } }
        else if (idx[p].hash !== h) { tag = 'edited'; cls = 'mod'; }
        else cls = 'same';
      }
      html += this.row({ name: p, h, tag, cls, key: p + ':' + h + ':' + tag, edit: this.o.editable }, fw);
    }
    for (const p of Object.keys(idx).sort()) if (fs[p] === undefined) html += this.row({ name: p, h: null, tag: 'deleted', cls: 'del', key: 'gone:' + p }, fw);
    this.q('[data-r="wd"]').innerHTML = html || '<li class="empty">Empty folder.</li>';
    fw.end();
    this.q('[data-f="wd"]').textContent = names.length + (names.length === 1 ? ' file' : ' files');
    // index
    const fi = this.f.idx; fi.begin(); html = '';
    if (!g) html = '<li class="empty">No repository yet.<br>Run <code>git init</code>.</li>';
    else {
      for (const p of Object.keys(idx).sort()) {
        const h = idx[p].hash; const inHead = head[p];
        const tag = !inHead ? 'new' : inHead.hash !== h ? 'modified' : '';
        html += this.row({ name: p, h, tag, cls: tag ? 'stg' : 'same', key: p + ':' + h + ':' + tag }, fi);
      }
      for (const p of Object.keys(g.conflicts || {}).sort()) html += this.row({ name: p, h: null, tag: 'conflict', cls: 'bad', key: 'c:' + p }, fi);
      for (const p of Object.keys(head).sort()) if (!idx[p] && !(g.conflicts && g.conflicts[p])) html += this.row({ name: p, h: null, tag: 'deleted', cls: 'del', key: 'dl:' + p }, fi);
      if (!html) html = '<li class="empty">Empty. <code>git add</code> copies files here.</li>';
    }
    this.q('[data-r="idx"]').innerHTML = html; fi.end();
    this.q('[data-f="idx"]').textContent = g ? Object.keys(idx).length + ' entries' : '';
    // repository
    const fr = this.f.repo; fr.begin(); html = '';
    let foot = '';
    if (!g) html = '<li class="empty">No <code>.git</code> folder yet.</li>';
    else if (!sim.headHash()) {
      html = `<li class="empty">No commits yet.<br><code>HEAD</code> says <code>${esc(g.head.ref || '')}</code>, but that branch file does not exist until the first commit.</li>`;
    } else {
      const hh = sim.headHash(); const c = sim.obj(hh).data;
      html += `<li class="headline ${fr.cls('h:' + hh)}"><b>${g.head.ref ? 'HEAD → ' + esc(sim.branchName()) : 'HEAD (detached)'}</b> <code>${short(hh)}</code> <span class="msg">${esc(c.message.split('\n')[0])}</span></li>`;
      for (const p of Object.keys(head).sort()) html += this.row({ name: p, h: head[p].hash, tag: '', cls: 'same', key: hh + ':' + p + ':' + head[p].hash }, fr);
    }
    this.q('[data-r="repo"]').innerHTML = html; fr.end();
    if (g) {
      const cnt = { blob: 0, tree: 0, commit: 0, tag: 0 };
      for (const o of Object.values(g.objects)) cnt[o.type]++;
      foot = Object.keys(g.objects).length + ' objects: ' + cnt.blob + ' blob, ' + cnt.tree + ' tree, ' + cnt.commit + ' commit' + (cnt.tag ? ', ' + cnt.tag + ' tag' : '');
    }
    this.q('[data-f="repo"]').textContent = foot;
    this.root.classList.toggle('no-repo', !g);
    if (res && kind !== 'sync') this.light(res.flow || []);
    if (this.o.happened) this.renderHappened(res || this.ws.last);
    this.updatePreview();
  }
  light(flow) {
    const ids = new Set();
    for (const f of flow) (FLOW[f] || []).forEach(x => ids.add(x));
    for (const id of ids) {
      const a = this.q('[data-a="' + id + '"]'); if (!a) continue;
      a.classList.remove('lit'); void a.offsetWidth; a.classList.add('lit');
      clearTimeout(a._t); a._t = setTimeout(() => a.classList.remove('lit'), 1700);
    }
  }
  renderHappened(r) {
    const box = this.q('[data-h]'); if (!box) return;
    if (!r || !r.cmd) {
      box.innerHTML = `<div class="hp-intro"><h3>What just happened</h3><p>Run a command and this panel explains it, then lists the low-level steps Git actually performed.</p>
        <ul class="gist"><li><b>A commit is a snapshot</b> of the whole project, not a list of edits.</li><li><b>Names are hashes of content.</b> Same content, same name.</li><li><b>Files travel</b> working directory → index → repository.</li></ul></div>`;
      return;
    }
    const ops = (r.ops || []).slice(0, 9);
    const more = (r.ops || []).length - ops.length;
    const explain = r.explain || (r.sub ? '' : (r.edited ? '' : 'This is an ordinary shell command. It talks to your operating system, so Git is not told anything.'));
    box.innerHTML = `<div class="hp-h"><h3>What just happened</h3><code class="hp-cmd">$ ${esc(r.cmd)}</code><span class="badge ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'ok' : 'error'}</span></div>
      ${r.explain || explain ? `<p class="hp-say">${esc(r.explain || explain)}</p>` : ''}
      ${ops.length ? `<div class="hp-ops"><h4>Under the hood <span>what Git ran for you</span></h4><ol>${ops.map(o => `<li class="op-${o.k || 'x'}"><code class="opk">${esc(o.p)}</code><span>${esc(o.t)}</span></li>`).join('')}${more > 0 ? `<li class="more">and ${more} more</li>` : ''}</ol></div>` : ''}`;
  }
}

/* ================================================================== GraphView */
class GraphView {
  constructor(root, ws, o = {}) {
    this.root = root; this.ws = ws; this.o = Object.assign({ detail: true, onOpen: null }, o);
    this.sel = null; this.lastCount = 0; this.f = U.fresher();
    root.classList.add('graph-view');
    root.innerHTML = `<div class="graph-scroll"><div class="gsvg"></div></div>${this.o.detail ? '<div class="commit-detail"></div>' : ''}`;
    root.addEventListener('click', e => {
      const n = e.target.closest('[data-commit]'); if (n) { this.sel = n.getAttribute('data-commit'); this.render(null, 'sync'); if (this.o.onSelect) this.o.onSelect(this.sel); }
      const op = e.target.closest('[data-open]'); if (op && this.o.onOpen) this.o.onOpen(op.getAttribute('data-open'));
    });
    ws.on((res, kind) => { if (kind === 'reset') { this.f.forget(); this.sel = null; this.lastCount = 0; } this.render(res, kind); });
    this.render(null, 'sync');
  }
  layout() {
    const sim = this.ws.sim, g = sim.s.git;
    if (!g) return null;
    const tips = sim.allTips(); if (!tips.length) return null;
    const order = sim.orderCommits(tips);
    const gen = {};
    for (let i = order.length - 1; i >= 0; i--) { const h = order[i]; const ps = sim.obj(h).data.parents; gen[h] = ps.length ? 1 + Math.max(...ps.map(p => (gen[p] == null ? 0 : gen[p]))) : 0; }
    const lane = {}; let next = 1;
    const walk = (h, ln) => { while (h && lane[h] === undefined) { lane[h] = ln; h = sim.obj(h).data.parents[0]; } };
    const base = ['main', 'master'].find(b => g.refs['refs/heads/' + b]);
    const first = base ? g.refs['refs/heads/' + base] : sim.headHash();
    walk(first, 0);
    for (const b of sim.branches()) { const t = g.refs['refs/heads/' + b]; if (lane[t] === undefined) { walk(t, next++); } }
    const hh = sim.headHash(); if (hh && lane[hh] === undefined) walk(hh, next++);
    for (const h of order) if (lane[h] === undefined) walk(h, next++);
    return { order, gen, lane, lanes: Math.max(...Object.values(lane)) + 1, maxGen: Math.max(...Object.values(gen)) };
  }
  render(res, kind) {
    const sim = this.ws.sim; const L = this.layout();
    const box = U.$('.gsvg', this.root);
    this.f.begin();
    if (!L) {
      box.innerHTML = `<div class="g-empty">${sim.s.git ? 'No commits yet. Your first <code>git commit</code> will appear here as a circle.' : 'No repository yet.'}</div>`;
      const d = U.$('.commit-detail', this.root); if (d) d.innerHTML = '';
      this.f.end(); this.lastCount = 0; return;
    }
    const g = sim.s.git; const X0 = 64, DX = 108, DY = 92;
    const labelsAt = {}; let maxLab = 1;
    for (const h of L.order) { const d = sim.decorations(h); labelsAt[h] = d; maxLab = Math.max(maxLab, d.length); }
    const TOP = 18 + maxLab * 26;
    const W = X0 * 2 + L.maxGen * DX, H = TOP + (L.lanes - 1) * DY + 78;
    const pos = h => ({ x: X0 + L.gen[h] * DX, y: TOP + L.lane[h] * DY });
    let edges = '', nodes = '', pills = '';
    const hh = sim.headHash();
    for (const h of L.order) {
      const c = sim.obj(h).data; const p = pos(h);
      c.parents.forEach((ph, i) => {
        const q = pos(ph);
        const d = p.y === q.y ? `M${p.x - 10} ${p.y} L${q.x + 10} ${q.y}` : `M${p.x - 9} ${p.y + (q.y > p.y ? 6 : -6)} C${p.x - 56} ${p.y} ${q.x + 56} ${q.y} ${q.x + 9} ${q.y + (q.y > p.y ? -6 : 6)}`;
        edges += `<path class="g-edge${i ? ' second' : ''}${this.f.cls('e:' + h + ph)}" d="${d}"/>`;
      });
      const isHead = h === hh, merge = c.parents.length > 1, sel = h === this.sel;
      nodes += `<g class="g-node${merge ? ' merge' : ''}${isHead ? ' head' : ''}${sel ? ' sel' : ''}${this.f.cls('n:' + h)}" data-commit="${h}" tabindex="0" role="button" aria-label="Commit ${short(h)}: ${esc(c.message.split('\n')[0])}">
        ${isHead ? `<circle class="g-ring" cx="${p.x}" cy="${p.y}" r="15"/>` : ''}<circle class="g-dot" cx="${p.x}" cy="${p.y}" r="9" style="fill:${hashColor(c.tree)}"/>${merge ? `<circle class="g-merge" cx="${p.x}" cy="${p.y}" r="4"/>` : ''}
        <text class="g-hash" x="${p.x}" y="${p.y + 28}" text-anchor="middle">${short(h)}</text>
        <text class="g-msg" x="${p.x}" y="${p.y + 43}" text-anchor="middle">${esc(c.message.split('\n')[0].slice(0, 17) + (c.message.split('\n')[0].length > 17 ? '…' : ''))}</text></g>`;
      const labs = labelsAt[h];
      labs.forEach((lb, i) => {
        const w = Math.max(34, lb.text.length * 6.9 + 16); const y = p.y - 26 - i * 26;
        pills += `<g class="g-pill ${lb.kind}${this.f.cls('l:' + h + lb.text)}"><rect x="${p.x - w / 2}" y="${y - 12}" width="${w}" height="20" rx="10"/><text x="${p.x}" y="${y + 2}" text-anchor="middle">${esc(lb.text)}</text></g>`;
      });
    }
    box.innerHTML = `<svg class="gsvg-el" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Commit graph with ${L.order.length} commits">${edges}${nodes}${pills}</svg>`;
    this.f.end();
    const scroller = U.$('.graph-scroll', this.root);
    if (L.order.length !== this.lastCount) { scroller.scrollLeft = scroller.scrollWidth; this.lastCount = L.order.length; }
    this.renderDetail(L);
  }
  renderDetail(L) {
    const d = U.$('.commit-detail', this.root); if (!d) return;
    const sim = this.ws.sim;
    let h = this.sel && sim.obj(this.sel) ? this.sel : sim.headHash() || L.order[0];
    const c = sim.obj(h).data; const flat = sim.flatTree(c.tree);
    const au = /^(.*) (\d+) ([+-]\d{4})$/.exec(c.author);
    d.innerHTML = `<div class="cd-row"><span class="cd-k">commit</span><code>${h}</code></div>
      <div class="cd-row"><span class="cd-k">message</span><span class="cd-v">${esc(c.message.trim())}</span></div>
      <div class="cd-row"><span class="cd-k">parent${c.parents.length === 1 ? '' : 's'}</span><span class="cd-v">${c.parents.length ? c.parents.map(p => `<code>${short(p)}</code>`).join(' + ') : '<i>none: this is the root commit</i>'}</span></div>
      <div class="cd-row"><span class="cd-k">tree</span><code>${short(c.tree)}</code>${au ? `<span class="cd-by">by ${esc(au[1])}</span>` : ''}</div>
      <div class="cd-row"><span class="cd-k">snapshot</span><span class="cd-files">${Object.keys(flat).sort().map(p => `<span class="cd-file" title="blob ${flat[p].hash}">${sw(flat[p].hash)}${esc(p)}</span>`).join('')}</span></div>
      ${this.o.onOpen ? `<button type="button" class="mini-btn" data-open="${h}">Inspect this commit object</button>` : ''}`;
  }
}

/* ================================================================== InspectView (.git folder / object database) */
const DESC = {
  '.git/HEAD': 'HEAD says where you are. Normally it holds the name of a branch, not a hash. That is how Git knows which branch file to move when you commit.',
  '.git/config': 'Settings for this repository only: your name and email, remotes, line-ending rules.',
  '.git/description': 'Only used by GitWeb. Safe to ignore.',
  '.git/index': 'The staging area. A binary table of path, blob hash and mode that describes the snapshot git commit would create right now. Read it with git ls-files -s.',
  '.git/COMMIT_EDITMSG': 'The last message typed in the editor (or with -m).',
  '.git/info/exclude': 'Ignore rules that are private to your copy of the repo. Same syntax as .gitignore.',
  '.git/logs/HEAD': 'The reflog: where HEAD has been. It is the safety net after a bad reset. Read it with git reflog.',
  '.git/MERGE_HEAD': 'Present only while a merge is unfinished: the commit being merged in.',
  '.git/MERGE_MSG': 'The message Git will use for the merge commit.'
};
class InspectView {
  constructor(root, ws, o = {}) {
    this.root = root; this.ws = ws; this.mode = o.mode || 'git';
    this.sel = o.sel || (this.mode === 'git' ? { kind: 'file', path: '.git/HEAD' } : null);
    this.open = {}; this.f = U.fresher(); this.getSel = o.getSel || null;
    root.classList.add('inspect-view', 'mode-' + this.mode);
    root.innerHTML = `<div class="ins-list" data-l></div><div class="ins-view" data-v></div>`;
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-dir]');
      if (t) { const p = t.getAttribute('data-dir'); this.open[p] = !this.isOpen(p, t.dataset.d | 0, t.dataset.n | 0); this.render(null, 'sync'); return; }
      const f = e.target.closest('[data-file]'); if (f) { this.select({ kind: 'file', path: f.getAttribute('data-file') }); return; }
      const ob = e.target.closest('[data-obj]');
      if (ob) { e.preventDefault(); this.select({ kind: 'obj', hash: ob.getAttribute('data-obj') }); }
    });
    ws.on((res, kind) => { if (kind === 'reset') { this.f.forget(); if (this.mode === 'objects') this.sel = null; } this.render(res, kind); });
    this.render(null, 'sync');
  }
  select(sel) { this.sel = sel; this.render(null, 'sync'); const v = U.$('[data-v]', this.root); if (v && v.scrollIntoView && this.mode === 'objects' && window.innerWidth < 760) v.scrollIntoView({ block: 'nearest' }); }
  selectPathForObject(h) { return '.git/objects/' + h.slice(0, 2) + '/' + h.slice(2); }
  isOpen(path, depth, nobj) {
    if (path in this.open) return this.open[path];
    if (/^\.git\/objects\/[0-9a-f]{2}$/.test(path)) return nobj <= 12 && this.objDirs <= 10;
    return depth <= 2 || path.startsWith('.git/refs');
  }
  render(res, kind) {
    if (this.mode === 'git') this.renderTree(); else this.renderObjects();
    U.$('[data-v]', this.root).innerHTML = this.viewer();
  }
  renderTree() {
    const sim = this.ws.sim; const L = U.$('[data-l]', this.root);
    if (!sim.s.git) { L.innerHTML = '<div class="g-empty">There is no <code>.git</code> folder yet.<br>Run <code>git init</code> and watch it appear.</div>'; return; }
    const v = GS.gitVfs(sim);
    const root = { name: '.git', path: '.git', dirs: new Map(), files: [] };
    const ensure = path => { const parts = path.split('/'); let n = root; for (let i = 1; i < parts.length; i++) { const k = parts[i]; if (!n.dirs.has(k)) n.dirs.set(k, { name: k, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] }); n = n.dirs.get(k); } return n; };
    v.dirs.forEach(d => { if (d !== '.git') ensure(d); });
    Object.keys(v.files).forEach(p => { const parts = p.split('/'); ensure(parts.slice(0, -1).join('/')).files.push(p); });
    this.objDirs = [...v.dirs].filter(d => /^\.git\/objects\/[0-9a-f]{2}$/.test(d)).length;
    this.f.begin();
    const sel = this.sel && this.sel.kind === 'file' ? this.sel.path : (this.sel && this.sel.kind === 'obj' ? this.selectPathForObject(this.sel.hash) : '');
    const fileLi = p => {
      const f = v.files[p]; const name = p.split('/').pop();
      let note = f.obj ? f.type : (f.c && f.c.length < 60 && !f.c.includes('\n\n') ? f.c.trim().split('\n')[0] : (f.note || ''));
      if (/^\.git\/refs\//.test(p)) note = short(f.c.trim());
      const key = p + ':' + (f.c ? f.c.length + f.c.slice(0, 50) : f.obj || 'b');
      return `<li class="file${this.f.cls(key)}"><button type="button" data-file="${esc(p)}"${sel === p ? ' class="on"' : ''}>${f.obj ? sw(f.obj) : '<i class="sw ghost"></i>'}<span class="nm">${esc(name)}</span><span class="note">${esc(note)}</span></button></li>`;
    };
    const rec = (n, depth) => {
      const nobj = n.files.length; const open = this.isOpen(n.path, depth, nobj);
      const kids = open ? '<ul>' + [...n.dirs.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map(d => rec(d, depth + 1)).join('') + n.files.sort().map(fileLi).join('') + '</ul>' : '';
      const count = n.files.length + [...n.dirs.values()].reduce((s, d) => s + d.files.length, 0);
      return `<li class="dir"><button type="button" class="dtog${this.f.cls('d:' + n.path)}" data-dir="${esc(n.path)}" data-d="${depth}" data-n="${nobj}" aria-expanded="${open}"><span class="car">${open ? '▾' : '▸'}</span><span class="nm">${esc(n.name)}/</span>${!open && count ? `<span class="note">${count}</span>` : ''}</button>${kids}</li>`;
    };
    const keep = L.scrollTop;
    L.innerHTML = '<ul class="tree">' + rec(root, 0) + '</ul>';
    L.scrollTop = keep;
    this.f.end();
  }
  objLabels() {
    const sim = this.ws.sim; const labels = {};
    for (const [h, o] of Object.entries(sim.s.git.objects)) {
      if (o.type === 'tree') for (const e of o.data) { (labels[e.hash] = labels[e.hash] || new Set()).add(e.name + (e.type === 'tree' ? '/' : '')); }
    }
    return labels;
  }
  renderObjects() {
    const sim = this.ws.sim; const L = U.$('[data-l]', this.root);
    if (!sim.s.git) { L.innerHTML = '<div class="g-empty">No repository yet, so no objects.<br>Run <code>git init</code>, then <code>git add</code>.</div>'; return; }
    const g = sim.s.git; const entries = Object.entries(g.objects).reverse();
    const cnt = { blob: 0, tree: 0, commit: 0, tag: 0 }; entries.forEach(([, o]) => cnt[o.type]++);
    const labels = this.objLabels();
    this.f.begin();
    const rootTrees = new Set(Object.values(g.objects).filter(o => o.type === 'commit').map(o => o.data.tree));
    const li = ([h, o]) => {
      let label = '';
      if (o.type === 'blob') label = labels[h] ? [...labels[h]].join(', ') : 'content no file refers to';
      else if (o.type === 'tree') label = rootTrees.has(h) ? 'top-level folder of a snapshot' : (labels[h] ? [...labels[h]].join(', ') : 'folder');
      else if (o.type === 'commit') label = o.data.message.split('\n')[0];
      else label = 'tag ' + o.data.tag;
      const on = this.sel && this.sel.kind === 'obj' && this.sel.hash === h;
      return `<li class="${this.f.cls('o:' + h)}"><button type="button" data-obj="${h}"${on ? ' class="on"' : ''}>${sw(h)}<code class="hx">${short(h)}</code><span class="chip t-${o.type}">${o.type}</span><span class="lab">${esc(label)}</span></button></li>`;
    };
    const keep = L.scrollTop;
    L.innerHTML = `<div class="obj-count"><b>${entries.length}</b> objects <span class="t-blob">${cnt.blob} blob</span> <span class="t-tree">${cnt.tree} tree</span> <span class="t-commit">${cnt.commit} commit</span>${cnt.tag ? ` <span class="t-tag">${cnt.tag} tag</span>` : ''}</div>
      ${entries.length ? `<ul class="objlist">${entries.map(li).join('')}</ul>` : '<div class="g-empty">The object database is empty. <code>git add</code> writes the first blob.</div>'}`;
    L.scrollTop = keep;
    this.f.end();
  }
  viewer() {
    const sim = this.ws.sim; const sel = this.sel;
    if (!sim.s.git) return '<div class="vw-empty">Nothing to inspect yet.</div>';
    if (!sel) return '<div class="vw-empty">Pick an object on the left to read it, the way <code>git cat-file -p</code> does.</div>';
    if (sel.kind === 'obj') return this.objViewer(sel.hash);
    const v = GS.gitVfs(sim); const f = v.files[sel.path];
    if (!f) return `<div class="vw-empty"><code>${esc(sel.path)}</code> does not exist right now.</div>`;
    if (f.obj) return this.objViewer(f.obj);
    const head = `<div class="vw-h"><code class="vw-path">${esc(sel.path)}</code></div>`;
    const desc = DESC[sel.path] || (/^\.git\/refs\/heads\//.test(sel.path) ? 'A branch is exactly this: a 41-byte file holding one commit hash (40 characters and a newline). Creating a branch copies a hash; committing rewrites it.' : /^\.git\/refs\/tags\//.test(sel.path) ? 'A lightweight tag is a branch that never moves.' : '');
    let body;
    if (sel.path === '.git/index') body = ansiToLinks(GS.git['ls-files'](sim, ['-s'], { r: {} }) || '(empty)');
    else body = this.linkify(esc(f.c));
    return head + (desc ? `<p class="vw-note">${esc(desc)}</p>` : '') + `<pre class="vw-body">${body}</pre>` + (sel.path === '.git/index' ? '<p class="vw-note">Columns: mode, blob hash, stage number (0 normally; 1 to 3 appear during a merge conflict), path.</p>' : '');
  }
  linkify(escaped) { return escaped.replace(/\b[0-9a-f]{40}\b/g, m => this.ws.sim.obj(m) ? `<a href="#" class="hl" data-obj="${m}">${m}</a>` : m); }
  objViewer(h) {
    const sim = this.ws.sim; const o = sim.obj(h);
    if (!o) return `<div class="vw-empty">No object ${esc(h)}.</div>`;
    const raw = GS.git['cat-file'](sim, ['-p', h], { r: {} });
    let body;
    if (o.type === 'tree') body = o.data.map(e => `${e.mode} ${e.type} ${sw(e.hash)}<a href="#" class="hl" data-obj="${e.hash}">${e.hash}</a>\t${esc(e.name)}`).join('\n');
    else body = this.linkify(esc(raw));
    const size = sim.objectSize(h);
    const where = h.slice(0, 2) + '/' + h.slice(2);
    const expl = {
      blob: 'A blob is only the bytes of one file: no file name, no date. Its name is the hash of those bytes, so two files with the same text share one blob.',
      tree: 'A tree is a folder listing. Each line is mode, type, hash and name. A sub-folder is another tree. Names live here, not in the blob.',
      commit: 'A commit is a few lines of text: one tree (the snapshot), its parent commit(s), author, committer and message. Changing any of it changes its hash.',
      tag: 'An annotated tag is a message plus a pointer to another object.'
    }[o.type];
    return `<div class="vw-h"><span class="chip t-${o.type}">${o.type}</span><code class="vw-hash">${h}</code><span class="mini">${size} bytes</span></div>
      <pre class="vw-body">${body}</pre><p class="vw-note">${expl}</p>
      <p class="vw-note"><b>Name</b> = SHA-1 of <code>${o.type} ${size}</code> + a zero byte + the content above. It is stored compressed in <code>.git/objects/${where}</code>: the first two characters become the folder.</p>`;
  }
}
function ansiToLinks(t) { return ansi(t); }

/* ================================================================== RefsView (HEAD + branch files) */
class RefsView {
  constructor(root, ws) {
    this.root = root; this.ws = ws; this.f = U.fresher();
    root.classList.add('refs-view');
    ws.on((res, kind) => { if (kind === 'reset') this.f.forget(); this.render(); }); this.render();
  }
  render() {
    const sim = this.ws.sim, g = sim.s.git; this.f.begin();
    if (!g) { this.root.innerHTML = '<div class="g-empty">No <code>.git</code> yet.</div>'; this.f.end(); return; }
    const headVal = g.head.ref ? 'ref: ' + g.head.ref : g.head.hash;
    let html = `<div class="ref-row head${this.f.cls('H:' + headVal)}"><code class="rp">.git/HEAD</code><span class="arrow-t">contains</span><code class="rv">${esc(headVal)}</code></div>`;
    for (const [r, h] of Object.entries(g.refs).sort()) {
      const cur = g.head.ref === r;
      html += `<div class="ref-row${cur ? ' cur' : ''}${this.f.cls('R:' + r + h)}"><code class="rp">.git/${esc(r)}</code><span class="arrow-t">contains</span><code class="rv">${sw(h)}${short(h)}…</code>${cur ? '<span class="chip same">HEAD is here</span>' : ''}</div>`;
    }
    if (!Object.keys(g.refs).length) html += '<div class="ref-row ghost"><code class="rp">.git/refs/heads/' + esc(g.head.ref ? g.head.ref.replace('refs/heads/', '') : '') + '</code><span class="arrow-t">does not exist yet</span></div>';
    this.root.innerHTML = html; this.f.end();
  }
}

/* ================================================================== SnapshotView (commit → tree → blobs) */
class SnapshotView {
  constructor(root, ws, o = {}) {
    this.root = root; this.ws = ws; this.max = o.max || 4; this.f = U.fresher();
    root.classList.add('snap-view');
    ws.on((res, kind) => { if (kind === 'reset') this.f.forget(); this.render(); }); this.render();
  }
  render() {
    const sim = this.ws.sim; this.f.begin();
    if (!sim.s.git || !sim.headHash()) { this.root.innerHTML = '<div class="g-empty">Each commit points at one tree, and the tree points at blobs.<br>Make a commit to see it drawn here.</div>'; this.f.end(); return; }
    const order = sim.orderCommits([sim.headHash()]).slice(0, this.max).reverse();
    const cols = order.map((h, i) => {
      const c = sim.obj(h).data; const flat = sim.flatTree(c.tree);
      const prev = c.parents[0] ? sim.commitFlat(c.parents[0]) : {};
      const rows = Object.keys(flat).sort().map(p => {
        const isNew = !prev[p] || prev[p].hash !== flat[p].hash;
        return `<li class="${isNew ? 'isnew' : 'shared'}"><span class="fn">${esc(p)}</span><span class="arr">→</span>${sw(flat[p].hash)}<code>${short(flat[p].hash)}</code>${isNew ? '<em>new blob</em>' : '<em>shared</em>'}</li>`;
      }).join('');
      return `<div class="snap${this.f.cls('s:' + h)}">
        <div class="snap-c"><span class="k">commit</span><code>${short(h)}</code><span class="m">${esc(c.message.split('\n')[0])}</span></div>
        <div class="snap-p">${c.parents.length ? 'parent ' + c.parents.map(p => '<code>' + short(p) + '</code>').join(' + ') : 'no parent'}</div>
        <div class="snap-t"><span class="k">tree</span><code>${short(c.tree)}</code></div><ul>${rows}</ul></div>`;
    });
    this.root.innerHTML = `<div class="snap-row">${cols.join('<div class="snap-gap" aria-hidden="true">◂</div>')}</div>
      <p class="snap-note">Unchanged files point at the same blob, so a new snapshot only pays for what changed. Matching colours are identical content.</p>`;
    this.f.end();
  }
}

/* ================================================================== HashPlayground */
class HashPlayground {
  constructor(root, ws) {
    this.root = root; this.ws = ws; this.prev = null;
    root.classList.add('hash-play');
    root.innerHTML = `<label class="hp-l" for="${'hp' + HashPlayground.n}">Type anything. This is the file content.</label>
      <textarea id="${'hp' + HashPlayground.n}" rows="3" spellcheck="false">Hello from Git\n</textarea>
      <div class="hp-out" data-o></div>
      <div class="hp-btns"><button type="button" class="mini-btn" data-add>Add one character</button><button type="button" class="mini-btn" data-hello>Reset to "Hello from Git"</button></div>`;
    HashPlayground.n++;
    this.ta = U.$('textarea', root);
    this.ta.addEventListener('input', () => this.render());
    root.addEventListener('click', e => {
      if (e.target.closest('[data-add]')) { this.ta.value = this.ta.value.replace(/\n?$/, '') + '!\n'; this.render(); }
      if (e.target.closest('[data-hello]')) { this.ta.value = 'Hello from Git\n'; this.prev = null; this.render(); }
    });
    this.render();
  }
  render() {
    const text = this.ta.value; const bytes = GS.utf8(text).length; const h = GS.hashBlob(text);
    let diff = '';
    if (this.prev && this.prev !== h) { let n = 0; for (let i = 0; i < 40; i++) if (h[i] !== this.prev[i]) n++; diff = `<p class="hp-diff"><b>${n} of 40</b> characters changed from the previous hash.</p>`; }
    let known = '';
    const g = this.ws && this.ws.sim.s.git;
    if (g && g.objects[h]) known = `<p class="hp-known">This exact content is already stored in your repository as blob <code>${short(h)}</code>. Git would not store it twice.</p>`;
    this.root.querySelector('[data-o]').innerHTML = `<div class="hp-step"><span class="k">1 · header</span><code>blob ${bytes}</code><span class="nul">NUL</span></div>
      <div class="hp-step"><span class="k">2 · SHA-1 of header + content</span><code class="big">${sw(h)}${h}</code></div>${diff}${known}
      <p class="hp-cmd">Check in the terminal: <code>git hash-object --stdin</code> gives the same id for the same bytes.</p>`;
    this.prev = h;
  }
}
HashPlayground.n = 1;

U.AreasView = AreasView; U.GraphView = GraphView; U.InspectView = InspectView; U.RefsView = RefsView; U.SnapshotView = SnapshotView; U.HashPlayground = HashPlayground;
})(GS);
