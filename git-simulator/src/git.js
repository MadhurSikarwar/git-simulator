/* Git Simulator: git commands (porcelain + a little plumbing).
   Each handler gets (sim, args, ctx) and returns output text (ANSI allowed).
   Failures throw GitError. ctx.r collects teaching metadata:
   explain (plain words), flow (which arrows to light up), tip (error decoder). */
(function (GS) {
'use strict';
const { A, paint, GitError, short, normPath, specMatcher, hashBlob, splitLines, gitDate, tzString } = GS;
const G = {};
GS.git = G;

const VERSION = 'git version 2.53.0.windows.1';
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---------------------------------------------------------------- option parsing */
function parseFlags(args, def, cmd) {
  const o = { f: {}, v: {}, rest: [], dd: false, after: [] };
  let dd = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (dd) { o.after.push(a); continue; }
    if (a === '--') { dd = true; o.dd = true; continue; }
    const setVal = (key, val) => { if (def.multi && def.multi.includes(key)) (o.v[key] = o.v[key] || []).push(val); else o.v[key] = val; };
    if (a.startsWith('--')) {
      const eq = a.indexOf('='); const name = eq > 0 ? a.slice(0, eq) : a;
      if (def.val && def.val[name]) { setVal(def.val[name], eq > 0 ? a.slice(eq + 1) : args[++i]); }
      else if (def.flag && def.flag[name]) o.f[def.flag[name]] = true;
      else throw new GitError("error: unknown option `" + name.slice(2) + "'\nusage: git " + cmd + ' [<options>]', { code: 'bad-option' });
      continue;
    }
    if (a.length > 1 && a[0] === '-' && !/^-\d+$/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        const fl = '-' + a[k];
        if (def.val && def.val[fl]) { const restStr = a.slice(k + 1); setVal(def.val[fl], restStr !== '' ? restStr : args[++i]); break; }
        else if (def.flag && def.flag[fl]) o.f[def.flag[fl]] = true;
        else throw new GitError("error: unknown switch `" + a[k] + "'\nusage: git " + cmd + ' [<options>]', { code: 'bad-option' });
      }
      continue;
    }
    if (/^-\d+$/.test(a) && def.num) { o.v.num = parseInt(a.slice(1), 10); continue; }
    o.rest.push(a);
  }
  return o;
}

const pathErr = p => "error: pathspec '" + p + "' did not match any file(s) known to git";

/* ---------------------------------------------------------------- shared formatting */
function commitHeader(sim, h, opts = {}) {
  const c = sim.obj(h).data;
  const lines = [];
  lines.push(A.y + 'commit ' + h + A.x + sim.decorString(h));
  if (c.parents.length > 1) lines.push('Merge: ' + c.parents.map(short).join(' '));
  const au = /^(.*) (\d+) ([+-]\d{4})$/.exec(c.author);
  const tzm = au ? (au[3][0] === '-' ? -1 : 1) * (parseInt(au[3].slice(1, 3), 10) * 60 + parseInt(au[3].slice(3), 10)) : 0;
  lines.push('Author: ' + (au ? au[1] : c.author));
  lines.push('Date:   ' + gitDate(au ? parseInt(au[2], 10) : 0, tzm));
  lines.push('');
  const msg = c.message.replace(/\n+$/, '').split('\n');
  for (const l of msg) lines.push('    ' + l);
  return lines;
}
const subject = (sim, h) => sim.obj(h).data.message.split('\n')[0];

function statusLong(sim, opts = {}) {
  const g = sim.git(); const st = sim.status();
  const out = [];
  const head = sim.headHash();
  if (g.head.ref) out.push('On branch ' + sim.branchName());
  else out.push('HEAD detached at ' + short(g.head.hash));
  if (!head) { out.push(''); out.push(opts.forCommit ? 'Initial commit' : 'No commits yet'); }
  if (st.conflicts.length) {
    out.push('');
    out.push('You have unmerged paths.');
    out.push('  (fix conflicts and run "git commit")');
    out.push('  (use "git merge --abort" to abort the merge)');
  } else if (st.merging) {
    out.push('');
    out.push('All conflicts fixed but you are still merging.');
    out.push('  (use "git commit" to conclude merge)');
  }
  if (st.staged.length) {
    out.push('');
    out.push('Changes to be committed:');
    out.push(head ? '  (use "git restore --staged <file>..." to unstage)' : '  (use "git rm --cached <file>..." to unstage)');
    for (const c of st.staged) {
      const label = c.st === 'A' ? 'new file:   ' : c.st === 'M' ? 'modified:   ' : c.st === 'D' ? 'deleted:    ' : 'renamed:    ';
      out.push(A.g + '\t' + label + (c.st === 'R' ? c.oldPath + ' -> ' + c.path : c.path) + A.x);
    }
  }
  if (st.conflicts.length) {
    out.push('');
    out.push('Unmerged paths:');
    out.push('  (use "git add <file>..." to mark resolution)');
    for (const p of st.conflicts) {
      const cf = g.conflicts[p];
      const label = cf.type === 'add/add' ? 'both added:      ' : cf.type === 'modify/delete' ? (cf.deletedIn === 'theirs' ? 'deleted by them: ' : 'deleted by us:   ') : 'both modified:   ';
      out.push(A.r + '\t' + label + p + A.x);
    }
  }
  if (st.unstaged.length) {
    out.push('');
    out.push('Changes not staged for commit:');
    out.push(st.unstaged.some(u => u.y === 'D') ? '  (use "git add/rm <file>..." to update what will be committed)' : '  (use "git add <file>..." to update what will be committed)');
    out.push('  (use "git restore <file>..." to discard changes in working directory)');
    for (const u of st.unstaged) out.push(A.r + '\t' + (u.y === 'M' ? 'modified:   ' : 'deleted:    ') + u.path + A.x);
  }
  if (st.untracked.length) {
    out.push('');
    out.push('Untracked files:');
    out.push('  (use "git add <file>..." to include in what will be committed)');
    for (const u of st.untracked) out.push(A.r + '\t' + u + A.x);
  }
  out.push('');
  if (!st.staged.length && !st.conflicts.length && !st.merging) {
    if (st.unstaged.length) out.push('no changes added to commit (use "git add" and/or "git commit -a")');
    else if (st.untracked.length) out.push('nothing added to commit but untracked files present (use "git add" to track)');
    else if (!head) out.push('nothing to commit (create/copy files and use "git add" to track)');
    else out.push('nothing to commit, working tree clean');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/* ---------------------------------------------------------------- init */
G.init = (sim, args, ctx) => {
  const o = parseFlags(args, { val: { '-b': 'b', '--initial-branch': 'b' }, flag: { '-q': 'q', '--quiet': 'q', '--bare': 'bare' } }, 'init');
  const branch = o.v.b || sim.s.global['init.defaultBranch'] || 'master';
  const created = sim.initRepo(branch);
  const where = sim.cwdLabel + '/.git/';
  ctx.r.flow = ['init'];
  if (!created) {
    ctx.r.explain = 'This folder already has a .git directory, so git init only re-reads it. Nothing was changed.';
    return 'Reinitialized existing Git repository in ' + where;
  }
  sim.op('init', 'created .git/ with HEAD → ref: refs/heads/' + branch + ', config, objects/, refs/', 'init');
  ctx.r.explain = 'git init created the hidden .git folder: HEAD (pointing at the branch "' + branch + '", which does not exist yet), config, an empty object database and empty refs. Your files are untouched and Git is not tracking any of them yet.';
  return (o.f.q ? '' : 'Initialized empty Git repository in ' + where);
};

/* ---------------------------------------------------------------- status */
G.status = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-s': 's', '--short': 's', '-b': 'b', '--branch': 'b', '--porcelain': 's', '-u': 'u', '--untracked-files': 'u', '-uall': 'u' }, val: { '--untracked-files': 'uf' } }, 'status');
  sim.git();
  ctx.r.explain = 'git status runs two comparisons. HEAD vs index gives "Changes to be committed" (what the next commit would contain). Index vs working directory gives "Changes not staged". Files that are in neither are untracked.';
  ctx.r.flow = ['status'];
  if (!o.f.s) return statusLong(sim);
  const st = sim.status(); const lines = [];
  if (o.f.b) lines.push('## ' + (sim.git().head.ref ? sim.branchName() + (sim.headHash() ? '' : '...') : 'HEAD (no branch)'));
  const map = new Map();
  const get = p => { if (!map.has(p)) map.set(p, { x: ' ', y: ' ', p, from: null }); return map.get(p); };
  for (const c of st.staged) { const e = get(c.path); e.x = c.st; if (c.st === 'R') e.from = c.oldPath; }
  for (const u of st.unstaged) get(u.path).y = u.y;
  for (const p of st.conflicts) { const e = get(p); e.x = 'U'; e.y = 'U'; }
  const rows = [...map.values()].sort((a, b) => (a.p < b.p ? -1 : 1));
  for (const e of rows) {
    const x = e.x === ' ' ? ' ' : A.g + e.x + A.x, y = e.y === ' ' ? ' ' : A.r + e.y + A.x;
    lines.push(x + y + ' ' + (e.from ? e.from + ' -> ' : '') + e.p);
  }
  for (const u of st.untracked) lines.push(A.r + '??' + A.x + ' ' + u);
  return lines.join('\n');
};

/* ---------------------------------------------------------------- add */
function stagePath(sim, p) {
  const g = sim.git();
  const c = sim.s.fs[p];
  const { hash, isNew } = sim.writeBlob(c);
  const prev = g.index[p];
  g.index[p] = { hash, mode: (prev && prev.mode) || '100644' };
  if (g.conflicts && g.conflicts[p]) delete g.conflicts[p];
  sim.op('hash-object -w', 'blob ' + short(hash) + ' ← ' + p + ' (' + GS.utf8(c).length + ' bytes) — ' + (isNew ? 'new object stored in .git/objects/' + hash.slice(0, 2) + '/' : 'identical content, object already stored'), 'blob', hash);
  sim.op('update-index', 'index: ' + p + ' → ' + short(hash), 'index', hash);
}
function addPaths(sim, specs, mode) {
  const g = sim.git(); const rules = sim.ignoreRules();
  const errors = []; const ignoredHits = [];
  let staged = 0;
  const handle = (spec, explicit) => {
    const m = specMatcher(spec);
    const fsHits = sim.files().filter(m);
    const delHits = Object.keys(g.index).filter(p => m(p) && sim.s.fs[p] === undefined);
    const conflictDel = Object.keys(g.conflicts || {}).filter(p => m(p) && sim.s.fs[p] === undefined);
    if (!fsHits.length && !delHits.length && !conflictDel.length) {
      if (!['.', ''].includes(normPath(spec))) errors.push("fatal: pathspec '" + spec + "' did not match any files");
      return;
    }
    for (const p of fsHits) {
      const tracked = !!g.index[p] || !!(g.conflicts && g.conflicts[p]);
      if (!tracked && sim.ignoreInfo(p, rules).ignored) { if (explicit) ignoredHits.push(spec); continue; }
      if (mode.update && !tracked) continue;
      if (g.index[p] && g.index[p].hash === sim.wtHash(p) && !(g.conflicts && g.conflicts[p])) continue;
      stagePath(sim, p); staged++;
    }
    for (const p of [...delHits, ...conflictDel]) {
      delete g.index[p]; if (g.conflicts) delete g.conflicts[p];
      sim.op('update-index --remove', 'index: ' + p + ' removed (file is gone from disk)', 'index'); staged++;
    }
  };
  for (const spec of specs) {
    const n = normPath(spec);
    handle(spec, n !== '.' && !/[*?[]/.test(n));
  }
  if (errors.length) throw new GitError(errors.join('\n'), { code: 'pathspec' });
  if (ignoredHits.length) {
    throw new GitError('The following paths are ignored by one of your .gitignore files:\n' + [...new Set(ignoredHits)].join('\n') + '\nhint: Use -f if you really want to add them.\nhint: Turn this message off by running\nhint: "git config advice.addIgnoredFile false"', { code: 'ignored' });
  }
  return staged;
}
G.add = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-A': 'all', '--all': 'all', '-u': 'u', '--update': 'u', '-f': 'f', '--force': 'f', '-v': 'v', '-n': 'n', '--dry-run': 'n', '-p': 'p', '--patch': 'p' } }, 'add');
  sim.git();
  const specs = o.rest.concat(o.after);
  if (o.f.p) throw new GitError('fatal: interactive patch mode is not available in this simulator. Use git add <file>.');
  let list = specs;
  if (o.f.all) list = ['.'];
  if (!list.length && !o.f.u) throw new GitError('Nothing specified, nothing added.\nhint: Maybe you wanted to say \'git add .\'?\nhint: Turn this message off by running\nhint: "git config advice.addEmptyPathspec false"', { code: 'add-empty' });
  if (o.f.u && !list.length) list = ['.'];
  const n = addPaths(sim, list, { update: o.f.u });
  ctx.r.flow = ['wd>idx'];
  ctx.r.explain = n
    ? 'git add copied the content of your file into the object database as a blob (named by the SHA-1 of its content), then wrote "path → blob" into the index. The index is the draft of your next commit. If you edit the file again after this, the staged version stays as it was until you git add again.'
    : 'Nothing needed staging: the index already matches the files on disk for these paths.';
  return '';
};

/* ---------------------------------------------------------------- commit */
function commitTemplate(sim) {
  const g = sim.git(); const st = sim.status(); const lines = ['', '# Please enter the commit message for your changes. Lines starting', "# with '#' will be ignored, and an empty message aborts the commit.", '#'];
  lines.push(g.head.ref ? '# On branch ' + sim.branchName() : '# HEAD detached at ' + short(g.head.hash));
  if (!sim.headHash()) { lines.push('#'); lines.push('# Initial commit'); }
  lines.push('#');
  if (st.staged.length) {
    lines.push('# Changes to be committed:');
    for (const c of st.staged) lines.push('#\t' + (c.st === 'A' ? 'new file:   ' : c.st === 'M' ? 'modified:   ' : c.st === 'D' ? 'deleted:    ' : 'renamed:    ') + (c.st === 'R' ? c.oldPath + ' -> ' + c.path : c.path));
    lines.push('#');
  }
  return lines.join('\n');
}
GS.commitTemplate = commitTemplate;

function doCommit(sim, o, ctx, message) {
  const g = sim.git();
  const st0 = sim.status();
  if (st0.conflicts.length) {
    throw new GitError("error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.", { code: 'unmerged' });
  }
  const headH = sim.headHash();
  let tree, newIndexUpdates = null;
  if (o.f.a) {
    for (const u of st0.unstaged) {
      if (u.y === 'M') stagePath(sim, u.path);
      else { delete g.index[u.path]; sim.op('update-index --remove', 'index: ' + u.path + ' removed', 'index'); }
    }
  }
  let flat = g.index;
  if (o.paths && o.paths.length) {
    const head = sim.headFlat();
    flat = Object.assign({}, head);
    newIndexUpdates = {};
    const known = new Set([...Object.keys(head), ...Object.keys(g.index)]);
    for (const spec of o.paths) {
      const m = specMatcher(spec);
      for (const p of known) if (m(p)) {
        if (sim.s.fs[p] !== undefined) { const { hash } = sim.writeBlob(sim.s.fs[p]); flat[p] = { hash, mode: '100644' }; newIndexUpdates[p] = flat[p]; }
        else { delete flat[p]; newIndexUpdates[p] = null; }
      }
    }
  }
  const parentFlat = sim.commitFlat(headH);
  const changes = sim.diffFlat(parentFlat, flat, { renames: true });
  const merging = !!g.mergeHead;
  if (!changes.length && !o.f.allowEmpty && !o.f.amend && !merging) {
    const body = statusLong(sim, { forCommit: true });
    throw new GitError(body, { code: 'nothing-to-commit', plain: true });
  }
  sim.identity();
  const built = sim.buildTree(flat);
  sim.op('write-tree', 'tree ' + short(built.hash) + ' written from the index (' + plural(built.created, 'new tree object') + ')', 'tree', built.hash);
  let parents = headH ? [headH] : [];
  if (merging) parents = [headH, g.mergeHead];
  let reflogMsg = headH ? 'commit: ' : 'commit (initial): ';
  if (merging) reflogMsg = 'commit (merge): ';
  let amendOf = null;
  if (o.f.amend) {
    if (!headH) throw new GitError('fatal: You have nothing to amend.');
    amendOf = headH;
    parents = sim.obj(headH).data.parents.slice();
    reflogMsg = 'commit (amend): ';
    if (!message) message = sim.obj(headH).data.message;
  }
  const subj = message.split('\n')[0];
  const hash = sim.createCommit(built.hash, parents, message, reflogMsg + subj);
  if (amendOf) {
    // the amended commit is replaced; the old one stays in the object database
    sim.op('amend', 'old commit ' + short(amendOf) + ' is no longer on the branch but still exists in .git/objects (find it with git reflog)', 'note');
  }
  g.index = Object.assign({}, newIndexUpdates ? g.index : flat);
  if (newIndexUpdates) for (const [p, e] of Object.entries(newIndexUpdates)) { if (e) g.index[p] = e; else delete g.index[p]; }
  g.mergeHead = null; g.mergeMsg = null; g.editMsg = message;
  const rootTag = headH || amendOf ? '' : ' (root-commit)';
  const label = g.head.ref ? sim.branchName() : 'detached HEAD';
  let out = '[' + label + (parents.length || !rootTag ? (headH ? '' : '') : '') + rootTag + ' ' + short(hash) + '] ' + subj;
  if (!parents.length && !amendOf) out = '[' + label + ' (root-commit) ' + short(hash) + '] ' + subj;
  else out = '[' + label + ' ' + short(hash) + '] ' + subj;
  if (!merging && changes.length) {
    out += '\n' + sim.shortStat(changes);
    const sm = sim.summaryLines(changes);
    if (sm.length) out += '\n' + sm.join('\n');
  }
  ctx.r.flow = ['idx>repo'];
  ctx.r.explain = 'git commit turned the index into tree objects (one per folder), wrote a commit object that points at the top tree and at the previous commit (its parent), then moved the branch file to the new commit id. Files that did not change point at the same blobs as before, nothing is copied twice.';
  return out;
}
G.commit = (sim, args, ctx) => {
  const o = parseFlags(args, {
    flag: { '-a': 'a', '--all': 'a', '--amend': 'amend', '--allow-empty': 'allowEmpty', '-q': 'q', '-v': 'v', '--no-edit': 'noEdit', '-o': 'only', '--only': 'only', '-s': 'sign', '--no-verify': 'nv', '-n': 'nv' },
    val: { '-m': 'm', '--message': 'm' }, multi: ['m']
  }, 'commit');
  sim.git();
  const paths = o.rest.concat(o.after);
  if (paths.length) {
    const g = sim.git(); const head = sim.headFlat();
    const errs = [];
    for (const spec of paths) {
      const m = specMatcher(spec);
      if (![...Object.keys(head), ...Object.keys(g.index)].some(m)) errs.push(pathErr(spec));
    }
    if (errs.length) throw new GitError(errs.join('\n'), { code: 'pathspec' });
    o.paths = paths;
  }
  let message = null;
  if (o.v.m) {
    message = o.v.m.join('\n\n');
    if (!message.trim()) throw new GitError('Aborting commit due to empty commit message.');
    return doCommit(sim, o, ctx, message);
  }
  if (o.f.amend && o.f.noEdit) return doCommit(sim, o, ctx, null);
  // No -m: Git would open the editor. The UI asks for a message and calls back.
  ctx.r.editor = {
    kind: 'commit', title: 'COMMIT_EDITMSG', text: o.f.amend ? sim.obj(sim.headHash()).data.message + commitTemplate(sim) : commitTemplate(sim),
    hint: 'Write the message above the # lines. First line = subject (what git log --oneline shows). Save to commit, Cancel to abort.',
    done: text => {
      const msg = text.split('\n').filter(l => !l.startsWith('#')).join('\n').replace(/\s+$/, '').replace(/^\s+/, '');
      if (!msg) throw new GitError('Aborting commit due to empty commit message.');
      return doCommit(sim, o, ctx, msg);
    }
  };
  return 'hint: Waiting for your editor to close the file...';
};

/* ---------------------------------------------------------------- log / show / diff */
function graphRender(sim, order, linesFor) {
  const out = []; let cols = [];
  const cell = (arr, mark) => arr.map((c, i) => (mark === i ? '*' : c === null ? ' ' : '|')).join(' ');
  const connector = (arr, ch, atCol) => {
    const chars = []; for (let i = 0; i < arr.length; i++) { chars.push(arr[i] === null ? ' ' : '|'); chars.push(' '); }
    const s = chars.join('').split('');
    s[2 * atCol - 1] = ch; s[2 * atCol] = ' ';
    return s.join('').replace(/\s+$/, '');
  };
  for (const h of order) {
    let idxs = []; cols.forEach((c, i) => { if (c === h) idxs.push(i); });
    if (!idxs.length) { let slot = cols.indexOf(null); if (slot < 0) { cols.push(h); slot = cols.length - 1; } else cols[slot] = h; idxs = [slot]; }
    if (idxs.length > 1) {
      for (const j of idxs.slice(1)) {
        out.push(connector(cols, '/', j));
      }
      for (const j of idxs.slice(1)) cols[j] = null;
      while (cols.length && cols[cols.length - 1] === null) cols.pop();
    }
    const col = idxs[0];
    const parents = sim.obj(h).data.parents;
    const next = cols.slice(); next[col] = parents[0] || null;
    const newCols = [];
    for (const p of parents.slice(1)) {
      let e = next.indexOf(p);
      if (e < 0) { e = next.indexOf(null); if (e < 0 || e < col) { next.push(p); e = next.length - 1; } else next[e] = p; newCols.push(e); }
    }
    const cur = cols.slice();
    const lines = linesFor(h);
    const pad = '  '.repeat(Math.max(0, newCols.length));
    lines.forEach((ln, k) => {
      const gcell = (k === 0 ? cell(cur, col) : cell(cur.map((c, i) => (i === col ? h : c)), -1)) + pad;
      out.push(ln === '' ? gcell.replace(/\s+$/, '') : gcell + ' ' + ln);
    });
    for (const e of newCols) out.push(connector(next.map((c, i) => (i === col ? h : c)), '\\', e));
    cols = next;
    while (cols.length && cols[cols.length - 1] === null) cols.pop();
  }
  return out;
}
G.log = (sim, args, ctx) => {
  const o = parseFlags(args, {
    flag: { '--oneline': 'one', '--graph': 'graph', '--reverse': 'rev', '--all': 'all', '--decorate': 'dec', '--stat': 'stat', '--no-decorate': 'nodec', '--abbrev-commit': 'abbr', '-p': 'patch' },
    val: { '-n': 'num', '--max-count': 'num', '--pretty': 'pretty', '--format': 'pretty' }, num: true
  }, 'log');
  const g = sim.git();
  const revs = o.rest.concat(o.after.length ? [] : []);
  let pretty = o.v.pretty;
  if (pretty === 'oneline') o.f.one = true;
  if (!sim.headHash() && !o.f.all && !revs.length) throw new GitError("fatal: your current branch '" + (sim.branchName() || 'HEAD') + "' does not have any commits yet");
  let tips = [], exclude = [];
  if (o.f.all) tips = sim.allTips();
  else if (revs.length) {
    for (const r of revs) {
      const m = /^(.*)\.\.(.*)$/.exec(r);
      if (m) { exclude.push(sim.resolveCommit(m[1] || 'HEAD')); tips.push(sim.resolveCommit(m[2] || 'HEAD')); }
      else tips.push(sim.resolveCommit(r));
    }
  } else tips = [sim.headHash()];
  let order = sim.orderCommits(tips, exclude);
  if (o.v.num != null) order = order.slice(0, parseInt(o.v.num, 10));
  const linesFor = h => {
    if (o.f.one) return [A.y + short(h) + A.x + (o.f.nodec ? '' : sim.decorString(h)) + ' ' + subject(sim, h)];
    const L = commitHeader(sim, h);
    if (o.f.stat || o.f.patch) {
      const c = sim.obj(h).data;
      const ch = sim.diffFlat(sim.commitFlat(c.parents[0]), sim.commitFlat(h), { renames: true });
      L.push('');
      if (o.f.stat) { L.push(sim.diffStat(ch)); L.push(sim.shortStat(ch)); }
      else L.push(...sim.diffText(ch).split('\n'));
    }
    return L;
  };
  let out;
  if (o.f.graph && !o.f.rev) out = graphRender(sim, order, linesFor);
  else {
    const seq = o.f.rev ? order.slice().reverse() : order;
    out = [];
    seq.forEach((h, i) => { out.push(...linesFor(h)); if (!o.f.one && i < seq.length - 1) out.push(''); });
  }
  ctx.r.explain = 'git log starts at the commit HEAD points to and follows parent pointers backwards. Each commit stores its parent\'s hash, so history is a chain you can walk without any extra index.';
  return out.join('\n');
};

G.show = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '--stat': 'stat', '--oneline': 'one', '-s': 'quiet', '--no-patch': 'quiet' } }, 'show');
  sim.git();
  const specs = o.rest.length ? o.rest : ['HEAD'];
  const hashes = specs.map(spec => {
    if (!o.rest.length && !sim.headHash()) throw sim.unknownRev('HEAD');
    return sim.resolveRev(spec);
  });
  return specs.map((spec, i) => showOne(sim, spec, hashes[i], o, ctx)).join('\n');
};
function showOne(sim, spec, h, o, ctx) {
  const ob = sim.obj(h);
  ctx.r.explain = 'git show understands every object type. For a commit it prints the header and then compares the commit\'s tree with its parent\'s tree at that moment: the diff is computed, never stored.';
  if (ob.type === 'blob') return ob.data.replace(/\n$/, '');
  if (ob.type === 'tree') return 'tree ' + spec + '\n\n' + ob.data.map(e => e.name + (e.type === 'tree' ? '/' : '')).join('\n');
  if (ob.type === 'tag') {
    const t = ob.data;
    return A.y + 'tag ' + t.tag + A.x + '\nTagger: ' + t.tagger.replace(/ \d+ [+-]\d{4}$/, '') + '\n\n' + t.message.replace(/\n$/, '') + '\n\n' + showOne(sim, spec, sim.peel(h), o, ctx);
  }
  const c = ob.data;
  const out = commitHeader(sim, h);
  if (o.f.one) return A.y + short(h) + A.x + sim.decorString(h) + ' ' + subject(sim, h);
  if (!o.f.quiet) {
    const ch = sim.diffFlat(sim.commitFlat(c.parents[0]), sim.commitFlat(h), { renames: true });
    if (ch.length) {
      out.push('');
      if (o.f.stat) { out.push(sim.diffStat(ch)); out.push(sim.shortStat(ch)); }
      else out.push(sim.diffText(ch));
    }
  }
  return out.join('\n');
}

G.diff = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '--staged': 'staged', '--cached': 'staged', '--stat': 'stat', '--name-only': 'names', '--name-status': 'ns', '--shortstat': 'ss' } }, 'diff');
  const g = sim.git();
  const revs = [], paths = [];
  const rest = o.rest;
  if (o.dd) paths.push(...o.after);
  for (const a of rest) { if (!o.dd && sim.tryResolveCommit(a)) revs.push(a); else paths.push(a); }
  const matchers = paths.map(specMatcher); const inPaths = p => !matchers.length || matchers.some(m => m(p));
  let a, b;
  const wtFlat = () => {
    const flat = {};
    for (const p of Object.keys(g.index)) if (sim.s.fs[p] !== undefined) flat[p] = { hash: hashBlob(sim.s.fs[p]), mode: g.index[p].mode };
    // blobs for worktree content must exist for display
    for (const p of Object.keys(flat)) if (!g.objects[flat[p].hash]) g.objects[flat[p].hash] = { type: 'blob', data: sim.s.fs[p], temp: true };
    return flat;
  };
  if (revs.length >= 2) { a = sim.commitFlat(sim.resolveCommit(revs[0])); b = sim.commitFlat(sim.resolveCommit(revs[1])); }
  else if (o.f.staged) { a = revs.length ? sim.commitFlat(sim.resolveCommit(revs[0])) : sim.headFlat(); b = g.index; }
  else if (revs.length) { a = sim.commitFlat(sim.resolveCommit(revs[0])); b = wtFlat(); for (const p of Object.keys(a)) if (!(p in b) && sim.s.fs[p] === undefined) { /* deleted */ } }
  else { a = g.index; b = wtFlat(); }
  let ch = sim.diffFlat(a, b, { renames: !!(o.f.staged || revs.length >= 2) }).filter(c => inPaths(c.path));
  // temp blobs are only needed while printing
  let out;
  if (o.f.names) out = ch.map(c => c.path).join('\n');
  else if (o.f.ns) out = ch.map(c => c.st + '\t' + c.path).join('\n');
  else if (o.f.stat) out = ch.length ? sim.diffStat(ch) + '\n' + sim.shortStat(ch) : '';
  else out = sim.diffText(ch);
  for (const [h, ob] of Object.entries(g.objects)) if (ob.temp) delete g.objects[h];
  ctx.r.explain = o.f.staged
    ? 'git diff --staged compares the index with the last commit: exactly what git commit would record.'
    : 'git diff (no flags) compares the working directory with the index: the edits you have not staged yet. Differences are calculated on demand; Git stores snapshots, not patches.';
  return out;
};

/* ---------------------------------------------------------------- rm / mv */
G.rm = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '--cached': 'cached', '-r': 'r', '-f': 'f', '--force': 'f', '-q': 'q', '-n': 'n', '--dry-run': 'n' } }, 'rm');
  const g = sim.git();
  const specs = o.rest.concat(o.after);
  if (!specs.length) throw new GitError('usage: git rm [<options>] [--] <file>...');
  const head = sim.headFlat();
  const targets = [], errors = [];
  for (const spec of specs) {
    const m = specMatcher(spec);
    const hits = Object.keys(g.index).filter(m);
    if (!hits.length) { errors.push("fatal: pathspec '" + spec + "' did not match any files"); continue; }
    const n = normPath(spec);
    const isDir = !hits.includes(n) && !/[*?[]/.test(n);
    if (isDir && !o.f.r) { errors.push("fatal: not removing '" + n + "/' recursively without -r"); continue; }
    targets.push(...hits);
  }
  if (errors.length) throw new GitError(errors[0], { code: errors[0].includes('recursively') ? 'rm-r' : 'pathspec' });
  const uniq = [...new Set(targets)];
  if (!o.f.f) {
    const local = [], stagedChanges = [];
    for (const p of uniq) {
      const ie = g.index[p].hash, he = head[p] && head[p].hash, wt = sim.wtHash(p);
      if (o.f.cached) { if (ie !== he && wt !== null && wt !== ie) local.push(p); continue; }
      if (wt !== null && wt !== ie) local.push(p);
      else if (ie !== he) stagedChanges.push(p);
    }
    if (local.length) throw new GitError('error: the following file' + (local.length > 1 ? 's have' : ' has') + ' local modifications:\n    ' + local.join('\n    ') + '\n(use --cached to keep the file, or -f to force removal)');
    if (stagedChanges.length) throw new GitError('error: the following file' + (stagedChanges.length > 1 ? 's have' : ' has') + ' changes staged in the index:\n    ' + stagedChanges.join('\n    ') + '\n(use --cached to keep the file, or -f to force removal)');
  }
  const out = [];
  for (const p of uniq) {
    out.push("rm '" + p + "'");
    if (o.f.n) continue;
    delete g.index[p];
    sim.op('update-index --remove', 'index: ' + p + ' removed', 'index');
    if (!o.f.cached) { delete sim.s.fs[p]; sim.op('unlink', p + ' deleted from the working directory', 'worktree'); }
  }
  ctx.r.flow = o.f.cached ? ['idx-only'] : ['idx>wd'];
  ctx.r.explain = o.f.cached
    ? 'git rm --cached removed the path from the index only. The file stays on disk, but Git stops tracking it (it shows as untracked until you add it to .gitignore). Old commits still contain it.'
    : 'git rm deleted the file from the working directory and from the index in one step. The deletion is staged; the next commit will record the file as gone, but older commits keep it forever.';
  return o.f.q ? '' : out.join('\n');
};

G.mv = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-f': 'f', '-k': 'k', '-n': 'n' } }, 'mv');
  const g = sim.git();
  const [src, dst] = o.rest.concat(o.after).map(normPath);
  if (!src || !dst) throw new GitError('usage: git mv [<options>] <source>... <destination>');
  if (sim.s.fs[src] === undefined) throw new GitError('fatal: bad source, source=' + src + ', destination=' + dst);
  if (!g.index[src]) throw new GitError('fatal: not under version control, source=' + src + ', destination=' + dst);
  if (sim.s.fs[dst] !== undefined && !o.f.f) throw new GitError('fatal: destination exists, source=' + src + ', destination=' + dst);
  sim.s.fs[dst] = sim.s.fs[src]; delete sim.s.fs[src];
  g.index[dst] = g.index[src]; delete g.index[src];
  sim.op('rename', src + ' → ' + dst + ' on disk', 'worktree');
  sim.op('update-index', 'index: remove ' + src + ', add ' + dst + ' (same blob ' + short(g.index[dst].hash) + ')', 'index');
  ctx.r.flow = ['wd>idx'];
  ctx.r.explain = 'git mv is shorthand for three actions: rename the file on disk, remove the old path from the index, add the new path. Git has no "rename" record; it notices later that the same blob now lives under a new name.';
  return '';
};

/* ---------------------------------------------------------------- restore / reset / clean */
G.restore = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '--staged': 'staged', '-S': 'staged', '--worktree': 'wt', '-W': 'wt', '-q': 'q' }, val: { '--source': 'src', '-s': 'src' } }, 'restore');
  const g = sim.git();
  const specs = o.rest.concat(o.after);
  if (!specs.length) throw new GitError('fatal: you must specify path(s) to restore', { code: 'restore-nopath' });
  const doStaged = !!o.f.staged, doWt = !!o.f.wt || !o.f.staged;
  const srcCommit = o.v.src ? sim.resolveCommit(o.v.src) : null;
  const headFlat = sim.headFlat();
  const indexSrc = srcCommit ? sim.commitFlat(srcCommit) : headFlat;
  const wtSrc = srcCommit ? sim.commitFlat(srcCommit) : (doStaged ? headFlat : g.index);
  const known = new Set([...Object.keys(g.index), ...Object.keys(doStaged ? indexSrc : wtSrc)]);
  if (srcCommit) for (const p of Object.keys(indexSrc)) known.add(p);
  const errors = [], matchedAll = new Set();
  for (const spec of specs) {
    const m = specMatcher(spec); const hits = [...known].filter(m);
    if (!hits.length && !['.', ''].includes(normPath(spec))) errors.push(pathErr(spec));
    hits.forEach(h => matchedAll.add(h));
  }
  if (errors.length) throw new GitError(errors.join('\n'), { code: 'pathspec' });
  const paths = [...matchedAll].sort();
  if (doStaged) {
    for (const p of paths) {
      const e = indexSrc[p];
      if (e) { if (!g.index[p] || g.index[p].hash !== e.hash) { g.index[p] = { hash: e.hash, mode: e.mode }; sim.op('update-index', 'index: ' + p + ' ← ' + short(e.hash) + ' (from ' + (srcCommit ? short(srcCommit) : 'HEAD') + ')', 'index', e.hash); } }
      else if (g.index[p]) { delete g.index[p]; sim.op('update-index --remove', 'index: ' + p + ' removed (it is not in ' + (srcCommit ? short(srcCommit) : 'HEAD') + ')', 'index'); }
    }
  }
  if (doWt) {
    const src = (doStaged && !srcCommit && !o.f.wt) ? g.index : wtSrc;
    for (const p of paths) {
      const e = (o.f.staged && o.f.wt) ? indexSrc[p] : src[p];
      if (e) { if (sim.wtHash(p) !== e.hash) { sim.s.fs[p] = sim.blobContent(e.hash); sim.op('checkout-index', p + ' ← blob ' + short(e.hash) + ' (working copy overwritten)', 'worktree', e.hash); } }
      else if (srcCommit && sim.s.fs[p] !== undefined) { delete sim.s.fs[p]; sim.op('unlink', p + ' removed (not in ' + short(srcCommit) + ')', 'worktree'); }
    }
  }
  ctx.r.flow = doStaged && !o.f.wt ? ['idx>repo-back'] : ['idx>wd-back'];
  ctx.r.explain = doStaged && !o.f.wt
    ? 'git restore --staged copied the last commit\'s version back into the index (un-staging). Your files on disk were not touched, so no work is lost.'
    : (srcCommit ? 'git restore --source copied the file from that commit into your working directory. Because it was not staged, Git shows it as modified or untracked.'
      : 'git restore <file> copied the staged version from the index over your working file. Edits you had not staged are gone and Git has no copy of them.');
  return '';
};

G.reset = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '--soft': 'soft', '--mixed': 'mixed', '--hard': 'hard', '-q': 'q', '--keep': 'keep' } }, 'reset');
  const g = sim.git();
  let rev = null; let specs = [];
  const pos = o.rest.slice();
  if (o.dd) { rev = pos[0] || null; specs = o.after; }
  else if (pos.length) {
    if (sim.tryResolveCommit(pos[0])) { rev = pos[0]; specs = pos.slice(1); }
    else specs = pos;
  }
  const headH = sim.headHash();
  const mode = o.f.hard ? 'hard' : o.f.soft ? 'soft' : 'mixed';
  if (specs.length) {
    if (mode !== 'mixed') throw new GitError('fatal: Cannot do ' + mode + ' reset with paths.');
    const tgt = rev ? sim.commitFlat(sim.resolveCommit(rev)) : sim.headFlat();
    const errs = [];
    const known = new Set([...Object.keys(tgt), ...Object.keys(g.index)]);
    const paths = new Set();
    for (const s of specs) { const m = specMatcher(s); const hits = [...known].filter(m); if (!hits.length) errs.push("fatal: ambiguous argument '" + s + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'"); hits.forEach(h => paths.add(h)); }
    if (errs.length) throw new GitError(errs[0]);
    for (const p of paths) { if (tgt[p]) g.index[p] = { hash: tgt[p].hash, mode: tgt[p].mode }; else delete g.index[p]; sim.op('update-index', 'index: ' + p + (tgt[p] ? ' ← ' + short(tgt[p].hash) : ' removed'), 'index'); }
  } else {
    const target = rev ? sim.resolveCommit(rev) : headH;
    if (!target && !rev) {
      if (mode === 'hard') throw new GitError("fatal: Failed to resolve 'HEAD' as a valid ref.");
      g.index = {}; sim.op('read-tree', 'index emptied (there is no commit to reset to)', 'index');
    } else {
      if (mode === 'hard') {
        const cur = sim.headFlat(); const tgt = sim.commitFlat(target);
        // reset --hard overwrites everything tracked
        for (const p of new Set([...Object.keys(g.index), ...Object.keys(cur), ...Object.keys(tgt)])) {
          if (tgt[p]) { sim.s.fs[p] = sim.blobContent(tgt[p].hash); g.index[p] = { hash: tgt[p].hash, mode: tgt[p].mode }; }
          else { delete sim.s.fs[p]; delete g.index[p]; }
        }
        g.conflicts = {};
        sim.op('reset --hard', 'index and working directory rewritten to match ' + short(target), 'worktree');
      } else if (mode === 'mixed') {
        g.index = {}; const tgt = sim.commitFlat(target);
        for (const [p, e] of Object.entries(tgt)) g.index[p] = { hash: e.hash, mode: e.mode };
        g.conflicts = {};
        sim.op('read-tree', 'index reset to the tree of ' + short(target), 'index');
      }
      if (target !== headH) sim.moveHeadTo(target, 'reset: moving to ' + (rev || 'HEAD'));
      if (target !== headH) sim.op('update-ref', (g.head.ref || 'HEAD') + ' → ' + short(target), 'ref', target);
      g.mergeHead = null;
    }
  }
  ctx.r.flow = mode === 'hard' && !specs.length ? ['repo>wd'] : ['idx>repo-back'];
  ctx.r.explain = specs.length || mode === 'mixed'
    ? 'git reset (mixed, the default) re-copies the last commit into the index and leaves your files alone: a bulk un-stage that cannot lose work.'
    : mode === 'soft' ? 'git reset --soft only moved the branch pointer. The index and your files are unchanged, so everything from the undone commits is still staged.'
      : 'git reset --hard moved the branch AND overwrote the index and working directory. Uncommitted edits to tracked files are gone for good; committed work can still be found with git reflog.';
  if (!specs.length && mode === 'hard') return 'HEAD is now at ' + short(sim.headHash()) + ' ' + subject(sim, sim.headHash());
  if (mode === 'mixed') {
    const lines = [];
    for (const p of Object.keys(g.index).sort()) { const c = sim.s.fs[p]; if (c === undefined) lines.push('D\t' + p); else if (hashBlob(c) !== g.index[p].hash) lines.push('M\t' + p); }
    if (lines.length && !o.f.q) return 'Unstaged changes after reset:\n' + lines.join('\n');
  }
  return '';
};

G.clean = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-n': 'n', '--dry-run': 'n', '-f': 'f', '--force': 'f', '-d': 'd', '-x': 'x', '-q': 'q', '-fd': 'fd' } }, 'clean');
  sim.git();
  if (!o.f.n && !o.f.f) throw new GitError('fatal: clean.requireForce is true and -f not given: refusing to clean', { code: 'clean-force' });
  const st = sim.status(); const targets = [];
  for (const u of st.untracked) { if (u.endsWith('/')) { if (o.f.d) targets.push(u); } else targets.push(u); }
  if (o.f.x) for (const p of st.ignored) targets.push(p);
  const specs = o.rest.concat(o.after);
  const out = [];
  for (const t of targets.sort()) {
    if (specs.length && !specs.some(s => specMatcher(s)(t.replace(/\/$/, '')))) continue;
    out.push((o.f.n ? 'Would remove ' : 'Removing ') + t);
    if (!o.f.n) {
      if (t.endsWith('/')) { for (const p of Object.keys(sim.s.fs)) if (p.startsWith(t)) delete sim.s.fs[p]; }
      else delete sim.s.fs[t];
      sim.op('unlink', t + ' deleted (Git had no copy)', 'worktree');
    }
  }
  ctx.r.flow = o.f.n ? [] : ['wd-del'];
  ctx.r.explain = o.f.n ? 'git clean -n is a dry run: it only lists what would be deleted. Always run it first, because clean deletes files that were never committed and cannot be recovered.'
    : 'git clean deleted untracked files from disk. Git never saved them, so there is no way back. Ignored files are skipped unless you add -x.';
  return o.f.q ? '' : out.join('\n');
};

/* ---------------------------------------------------------------- plumbing-ish inspection */
G['ls-files'] = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-s': 's', '--stage': 's', '-o': 'o', '--others': 'o', '-m': 'm', '--modified': 'm', '-d': 'd', '--deleted': 'd', '--exclude-standard': 'es', '-c': 'c', '--cached': 'c' } }, 'ls-files');
  const g = sim.git();
  const specs = o.rest.concat(o.after).map(specMatcher);
  const inSpec = p => !specs.length || specs.some(m => m(p));
  const out = [];
  if (o.f.o) {
    for (const p of sim.files()) if (!g.index[p] && !(g.conflicts && g.conflicts[p]) && inSpec(p) && (!o.f.es || !sim.isIgnored(p))) out.push(p);
    return out.join('\n');
  }
  if (o.f.m) { for (const p of Object.keys(g.index).sort()) if (sim.s.fs[p] !== undefined && sim.wtHash(p) !== g.index[p].hash && inSpec(p)) out.push(p); return out.join('\n'); }
  if (o.f.d) { for (const p of Object.keys(g.index).sort()) if (sim.s.fs[p] === undefined && inSpec(p)) out.push(p); return out.join('\n'); }
  const all = new Set([...Object.keys(g.index), ...Object.keys(g.conflicts || {})]);
  for (const p of [...all].sort()) {
    if (!inSpec(p)) continue;
    if (g.conflicts && g.conflicts[p]) {
      const cf = g.conflicts[p];
      if (o.f.s) { [['base', 1], ['ours', 2], ['theirs', 3]].forEach(([k, n]) => { if (cf[k]) out.push('100644 ' + cf[k] + ' ' + n + '\t' + p); }); }
      else out.push(p);
    } else out.push(o.f.s ? g.index[p].mode + ' ' + g.index[p].hash + ' 0\t' + p : p);
  }
  ctx.r.explain = 'git ls-files prints the index: the list of paths (and, with -s, blob hashes) that the next commit will contain. It is the quickest way to ask Git what it believes is tracked right now.';
  return out.join('\n');
};

function lsTreeLines(sim, treeHash, o, prefix = '') {
  const out = [];
  for (const e of sim.obj(treeHash).data) {
    const name = prefix + e.name;
    if (e.type === 'tree' && o.f.r) {
      if (o.f.t) out.push(lsFmt(e, name, o));
      out.push(...lsTreeLines(sim, e.hash, o, name + '/'));
    } else out.push(lsFmt(e, name, o));
  }
  return out;
}
function lsFmt(e, name, o) {
  if (o.f.names) return name;
  return e.mode + ' ' + e.type + ' ' + e.hash + '\t' + name;
}
G['ls-tree'] = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-r': 'r', '-t': 't', '-d': 'd', '--name-only': 'names', '--name-status': 'names' } }, 'ls-tree');
  sim.git();
  const a = o.rest.concat(o.after);
  if (!a.length) throw new GitError('usage: git ls-tree [<options>] <tree-ish> [<path>...]\n\n    -d                    only show trees\n    -r                    recurse into subtrees\n    -t                    show trees when recursing\n    --name-only           list only filenames\n    --full-name           use full path names', { code: 'usage' });
  const h = sim.peel(sim.resolveRev(a[0]));
  const tree = sim.obj(h).type === 'tree' ? h : sim.obj(h).data.tree;
  let root = tree, prefix = '';
  if (a[1]) { const f = sim.lookupPath(tree, a[1]); if (!f) return ''; if (f.type === 'tree') { root = f.hash; prefix = ''; } else return lsFmt({ mode: f.mode, type: f.type, hash: f.hash }, normPath(a[1]), o); }
  ctx.r.explain = 'git ls-tree lists one folder object: for every entry a mode, a type (blob or tree), the hash and the name. A subfolder is just another tree object with its own hash.';
  return lsTreeLines(sim, root, o, prefix).join('\n');
};

G['cat-file'] = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-p': 'p', '-t': 't', '-s': 's', '-e': 'e' } }, 'cat-file');
  sim.git();
  const spec = o.rest[0];
  if (!spec) throw new GitError('usage: git cat-file (-t | -s | -e | -p) <object>');
  let h;
  try { h = sim.resolveRev(spec); } catch (e) { throw new GitError('fatal: Not a valid object name ' + spec); }
  const ob = sim.obj(h);
  if (!ob) throw new GitError('fatal: Not a valid object name ' + spec);
  ctx.r.explain = 'git cat-file reads one object straight out of .git/objects. Every object is just a type, a size and some content, stored under the SHA-1 of "type size<NUL>content".';
  if (o.f.t) return ob.type;
  if (o.f.s) return String(sim.objectSize(h));
  if (o.f.e) return '';
  if (ob.type === 'blob') return ob.data.replace(/\n$/, '');
  if (ob.type === 'tree') return ob.data.map(e => e.mode + ' ' + e.type + ' ' + e.hash + '\t' + e.name).join('\n');
  if (ob.type === 'commit') return GS.commitText(ob.data).replace(/\n$/, '');
  return GS.tagText(ob.data).replace(/\n$/, '');
};

G['hash-object'] = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-w': 'w', '--stdin': 'stdin' }, val: { '-t': 't' } }, 'hash-object');
  let content;
  if (o.f.stdin) content = ctx.stdin == null ? '' : ctx.stdin;
  else {
    const f = normPath(o.rest[0] || '');
    if (!f) throw new GitError('usage: git hash-object [-t <type>] [-w] [--path=<file> | --no-filters] [--stdin [--literally]] [--] <file>...');
    if (sim.s.fs[f] === undefined) throw new GitError("fatal: could not open '" + f + "' for reading: No such file or directory");
    content = sim.s.fs[f];
  }
  const hash = hashBlob(content);
  ctx.r.explain = 'The id of a blob is SHA-1("blob <size>" + NUL + content). Same content always gives the same id, and one changed character gives a completely different one. That is why Git stores identical files only once.';
  if (o.f.w) {
    const g = sim.git(); const { isNew } = sim.writeBlob(content);
    sim.op('hash-object -w', 'blob ' + short(hash) + ' written to .git/objects/' + hash.slice(0, 2) + '/' + hash.slice(2, 9) + '…' + (isNew ? '' : ' (already existed)'), 'blob', hash);
  }
  return hash;
};

G['rev-parse'] = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '--short': 'short', '--abbrev-ref': 'abbrev', '--git-dir': 'gitdir', '--show-toplevel': 'top', '--is-inside-work-tree': 'inside', '--verify': 'verify' } }, 'rev-parse');
  if (o.f.inside) { sim.git(); return 'true'; }
  if (o.f.gitdir) { sim.git(); return '.git'; }
  if (o.f.top) { sim.git(); return sim.cwdLabel; }
  sim.git();
  return o.rest.map(r => {
    if (o.f.abbrev && (r === 'HEAD')) return sim.git().head.ref ? sim.branchName() : 'HEAD';
    const h = sim.resolveRev(r); return o.f.short ? short(h) : h;
  }).join('\n');
};

G['update-index'] = (sim, args, ctx) => {
  const g = sim.git();
  const a = args.slice(); let add = false, remove = false, cache = null; const files = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--add') add = true; else if (a[i] === '--remove') remove = true;
    else if (a[i] === '--cacheinfo') { const v = a[++i]; const m = /^(\d+),([0-9a-f]{40}),(.+)$/.exec(v || ''); if (!m) throw new GitError('error: option \'cacheinfo\' expects <mode>,<sha1>,<path>'); cache = { mode: m[1], hash: m[2], path: normPath(m[3]) }; }
    else files.push(normPath(a[i]));
  }
  if (cache) { if (!sim.obj(cache.hash)) throw new GitError('error: ' + cache.path + ': cannot add to the index - missing --add option?'); g.index[cache.path] = { hash: cache.hash, mode: cache.mode }; sim.op('update-index', 'index: ' + cache.path + ' → ' + short(cache.hash), 'index', cache.hash); }
  for (const f of files) {
    if (sim.s.fs[f] === undefined) { if (remove) { delete g.index[f]; sim.op('update-index --remove', 'index: ' + f + ' removed', 'index'); continue; } throw new GitError("error: " + f + ": does not exist and --remove not passed\nfatal: Unable to process path " + f); }
    if (!g.index[f] && !add) throw new GitError('error: ' + f + ': cannot add to the index - missing --add option?\nfatal: Unable to process path ' + f);
    stagePath(sim, f);
  }
  ctx.r.flow = ['wd>idx'];
  ctx.r.explain = 'git update-index is the plumbing behind git add: it only records "path → blob hash" in the index. The blob itself is written by git hash-object -w (git add does both for you).';
  return '';
};
G['write-tree'] = (sim, args, ctx) => {
  const g = sim.git();
  if (Object.keys(g.conflicts || {}).length) throw new GitError('error: ' + Object.keys(g.conflicts)[0] + ': unmerged (' + (g.conflicts[Object.keys(g.conflicts)[0]].ours || '') + ')\nfatal: git-write-tree: error building trees');
  const b = sim.buildTree(g.index);
  sim.op('write-tree', 'tree ' + short(b.hash) + ' written from the index (' + plural(b.created, 'new tree object') + ')', 'tree', b.hash);
  ctx.r.flow = ['idx>repo'];
  ctx.r.explain = 'git write-tree converts the index into tree objects (one per folder) and prints the hash of the top one. This is step 1 of what git commit does.';
  return b.hash;
};
G['commit-tree'] = (sim, args, ctx) => {
  const o = parseFlags(args, { val: { '-p': 'p', '-m': 'm' }, multi: ['p', 'm'] }, 'commit-tree');
  sim.git();
  const treeSpec = o.rest[0]; if (!treeSpec) throw new GitError('usage: git commit-tree <tree> [(-p <parent>)...]');
  const tree = sim.resolveRev(treeSpec);
  if (sim.obj(tree).type !== 'tree') throw new GitError('fatal: ' + treeSpec + ' is not a valid \'tree\' object');
  const parents = (o.v.p || []).map(p => sim.resolveCommit(p));
  const message = (o.v.m || [ctx.stdin || '']).join('\n\n');
  const who = sim.stamp();
  const hash = sim.writeCommit({ tree, parents, author: who, committer: who, message: message.endsWith('\n') ? message : message + '\n' });
  sim.op('commit-tree', 'commit ' + short(hash) + ' → tree ' + short(tree) + ' (no branch moved yet)', 'commit', hash);
  ctx.r.explain = 'git commit-tree wrote a commit object that points at your tree and parent. Nothing points at it yet: no branch has moved, so git log will not show it until git update-ref does.';
  return hash;
};
G['update-ref'] = (sim, args, ctx) => {
  const g = sim.git();
  const [ref, val] = args.filter(a => !a.startsWith('-'));
  if (!ref || !val) throw new GitError('usage: git update-ref [<options>] <refname> <new-oid> [<old-oid>]');
  const h = sim.resolveCommit(val);
  if (ref === 'HEAD') { if (g.head.ref) g.refs[g.head.ref] = h; else g.head.hash = h; }
  else { if (!/^refs\//.test(ref)) throw new GitError('fatal: ' + ref + ': not a valid ref name'); g.refs[ref] = h; }
  sim.logReflog(h, 'update-ref: ' + ref);
  sim.op('update-ref', (ref === 'HEAD' && g.head.ref ? g.head.ref : ref) + ' → ' + short(h), 'ref', h);
  ctx.r.explain = 'A branch is just a text file holding one commit hash. git update-ref rewrites that file. This is the last step of git commit: "move the branch forward".';
  return '';
};
G['symbolic-ref'] = (sim, args, ctx) => {
  const g = sim.git();
  if (args[0] !== 'HEAD') throw new GitError('usage: git symbolic-ref [<options>] <name> [<ref>]');
  if (args[1]) { g.head = { ref: args[1] }; return ''; }
  if (!g.head.ref) throw new GitError('fatal: ref HEAD is not a symbolic ref');
  return g.head.ref;
};

/* ---------------------------------------------------------------- branches, checkout, switch */
const validBranch = n => n && !/[\s~^:?*[\\]|\.\.|^-|\/$|\.lock$|^@$|@\{/.test(n);

G.branch = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-a': 'a', '--all': 'a', '-r': 'r', '--remotes': 'r', '-v': 'v', '-vv': 'v', '--verbose': 'v', '-d': 'd', '--delete': 'd', '-D': 'D', '-m': 'm', '--move': 'm', '-M': 'M', '--show-current': 'cur', '-f': 'f', '--list': 'list', '-l': 'list' } }, 'branch');
  const g = sim.git();
  const names = o.rest.concat(o.after);
  if (o.f.cur) return g.head.ref ? sim.branchName() : '';
  if (o.f.d || o.f.D) {
    if (!names.length) throw new GitError('fatal: branch name required');
    const out = [];
    for (const n of names) {
      const ref = 'refs/heads/' + n;
      if (!g.refs[ref]) { out.push("error: branch '" + n + "' not found."); continue; }
      if (g.head.ref === ref) { out.push("error: cannot delete branch '" + n + "' used by worktree at '" + sim.cwdLabel + "'"); continue; }
      if (o.f.d && !sim.ancestors(sim.headHash()).has(g.refs[ref])) { out.push("error: the branch '" + n + "' is not fully merged.\nhint: If you are sure you want to delete it, run 'git branch -D " + n + "'"); continue; }
      out.push('Deleted branch ' + n + ' (was ' + short(g.refs[ref]) + ').');
      delete g.refs[ref];
      sim.op('delete', '.git/refs/heads/' + n + ' removed (commits stay in the object database)', 'ref');
    }
    const text = out.join('\n');
    if (out.some(l => l.startsWith('error:'))) throw new GitError(text);
    return text;
  }
  if (o.f.m || o.f.M) {
    const [a, b] = names.length === 2 ? names : [sim.branchName(), names[0]];
    if (!a || !b) throw new GitError('fatal: branch name required');
    if (!g.refs['refs/heads/' + a] && !(g.head.ref === 'refs/heads/' + a)) throw new GitError("error: refname refs/heads/" + a + " not found\nfatal: Branch rename failed");
    if (g.refs['refs/heads/' + b] && !o.f.M) throw new GitError("fatal: a branch named '" + b + "' already exists");
    if (!validBranch(b)) throw new GitError("fatal: '" + b + "' is not a valid branch name");
    if (g.refs['refs/heads/' + a]) { g.refs['refs/heads/' + b] = g.refs['refs/heads/' + a]; delete g.refs['refs/heads/' + a]; }
    if (g.head.ref === 'refs/heads/' + a) g.head.ref = 'refs/heads/' + b;
    sim.op('rename', '.git/refs/heads/' + a + ' → .git/refs/heads/' + b, 'ref');
    ctx.r.explain = 'Renaming a branch renames one small file under .git/refs/heads/ and, if it was checked out, rewrites HEAD to point at the new name.';
    return '';
  }
  if (names.length && !o.f.list) {
    const name = names[0], start = names[1];
    if (!validBranch(name)) throw new GitError("fatal: '" + name + "' is not a valid branch name");
    if (g.refs['refs/heads/' + name]) throw new GitError("fatal: a branch named '" + name + "' already exists");
    const from = start ? sim.resolveCommit(start) : sim.headHash();
    if (!from) throw new GitError("fatal: not a valid object name: '" + (sim.branchName() || 'HEAD') + "'");
    g.refs['refs/heads/' + name] = from;
    sim.op('update-ref', 'refs/heads/' + name + ' → ' + short(from) + ' (a new 41-byte file; no files were copied)', 'ref', from);
    ctx.r.flow = ['branch'];
    ctx.r.explain = 'git branch ' + name + ' created one tiny file, .git/refs/heads/' + name + ', containing the hash of the commit you are on. HEAD did not move, so you are still on ' + (sim.branchName() || 'the same commit') + '. That is why branches are free in Git.';
    return '';
  }
  if (o.f.r) return '';
  const lines = [];
  if (!g.head.ref) lines.push(A.g + '* (HEAD detached at ' + short(g.head.hash) + ')' + A.x);
  for (const b of sim.branches()) {
    const cur = g.head.ref === 'refs/heads/' + b;
    const h = g.refs['refs/heads/' + b];
    const txt = o.f.v ? ' ' + short(h) + ' ' + subject(sim, h) : '';
    lines.push(cur ? A.g + '* ' + b + A.x + txt : '  ' + b + txt);
  }
  ctx.r.explain = 'git branch with no name lists the files in .git/refs/heads/. The star marks the branch HEAD points to.';
  return lines.join('\n');
};

function switchTo(sim, targetHash, headSpec, opts, ctx) {
  const g = sim.git();
  const cur = sim.headFlat(), tgt = sim.commitFlat(targetHash);
  const { dirty, untrackedBlock } = sim.checkoutConflicts(cur, tgt);
  if (untrackedBlock.length) throw new GitError('error: The following untracked working tree files would be overwritten by checkout:\n\t' + untrackedBlock.join('\n\t') + '\nPlease move or remove them before you switch branches.\nAborting', { code: 'untracked-overwrite' });
  if (dirty.length) throw new GitError('error: Your local changes to the following files would be overwritten by checkout:\n\t' + dirty.join('\n\t') + '\nPlease commit your changes or stash them before you switch branches.\nAborting', { code: 'dirty-checkout' });
  const from = sim.branchName() || short(sim.headHash());
  const changed = sim.applyTree(cur, tgt);
  const fromHash = sim.headHash();
  if (headSpec.ref) g.head = { ref: headSpec.ref }; else g.head = { hash: headSpec.hash };
  sim.logReflog(targetHash, 'checkout: moving from ' + from + ' to ' + (headSpec.ref ? headSpec.ref.replace('refs/heads/', '') : short(headSpec.hash)));
  sim.op('write HEAD', '.git/HEAD ← ' + (headSpec.ref ? 'ref: ' + headSpec.ref : headSpec.hash), 'head');
  for (const p of changed) sim.op('checkout', p + (sim.s.fs[p] !== undefined ? ' rewritten from blob ' + short(g.index[p].hash) : ' removed from the working directory'), 'worktree');
  if (!changed.length) sim.op('checkout', 'working files already matched; nothing rewritten', 'worktree');
  ctx.r.flow = ['repo>idx', 'repo>wd'];
  const carried = [];
  const head2 = sim.headFlat();
  for (const p of Object.keys(g.index).sort()) { if (!head2[p] || head2[p].hash !== g.index[p].hash) carried.push('A\t' + p); else if (sim.wtHash(p) !== g.index[p].hash) carried.push('M\t' + p); }
  return carried;
}
const DETACHED_ADVICE = (h) => "Note: switching to '" + h + "'.\n\nYou are in 'detached HEAD' state. You can look around, make experimental\nchanges and commit them, and you can discard any commits you make in this\nstate without impacting any branches by switching back to a branch.\n\nIf you want to create a new branch to retain commits you create, you may\ndo so (now or later) by using -c with the switch command. Example:\n\n  git switch -c <new-branch-name>\n\nOr undo this operation with:\n\n  git switch -\n\nTurn off this advice by setting config variable advice.detachedHead to false\n";

function restorePaths(sim, source, specs, ctx) {
  const g = sim.git();
  const srcFlat = source ? sim.commitFlat(source) : g.index;
  const known = Object.keys(srcFlat);
  const errs = [], all = new Set();
  for (const s of specs) { const m = specMatcher(s); const hits = known.filter(m); if (!hits.length) errs.push(pathErr(s)); hits.forEach(h => all.add(h)); }
  if (errs.length) throw new GitError(errs.join('\n'), { code: 'pathspec' });
  for (const p of all) {
    const e = srcFlat[p];
    sim.s.fs[p] = sim.blobContent(e.hash);
    if (source) g.index[p] = { hash: e.hash, mode: e.mode };
    sim.op('checkout', p + ' ← blob ' + short(e.hash), 'worktree', e.hash);
  }
  ctx.r.flow = source ? ['repo>idx', 'repo>wd'] : ['idx>wd-back'];
  ctx.r.explain = source ? 'git checkout <commit> -- <file> copied that file from the commit into BOTH the index and your working directory.' : 'git checkout -- <file> copied the staged version from the index over your working file. Unstaged edits are lost.';
  return '';
}

function doCheckout(sim, args, ctx, asSwitch) {
  const cmd = asSwitch ? 'switch' : 'checkout';
  const o = parseFlags(args, {
    flag: { '-b': 'b', '-B': 'B', '-c': 'c', '-C': 'C', '--detach': 'detach', '-d': 'detach', '-q': 'q', '-f': 'force', '--force': 'force', '--orphan': 'orphan', '--track': 'track' },
    val: {}
  }, cmd);
  // -b / -c take a value: handle manually since they are flags above
  const g = sim.git();
  let rest = o.rest.slice(); const after = o.after;
  let createName = null; let force = false;
  if (o.f.b || o.f.B || o.f.c || o.f.C) { createName = rest.shift(); force = !!(o.f.B || o.f.C); if (!createName) throw new GitError('fatal: switch \'' + (o.f.b ? 'b' : 'c') + '\' requires a value'); }
  if (o.dd || (!asSwitch && after.length)) {
    const src = rest[0] ? sim.resolveCommit(rest[0]) : null;
    const specs = after.length ? after : rest.slice(src ? 1 : 0);
    if (!specs.length) throw new GitError('fatal: invalid reference: ' + (rest[0] || ''));
    return restorePaths(sim, src, specs, ctx);
  }
  if (!asSwitch && !rest.length && !createName) {
    const st = sim.status(); // git checkout with no args: show status of local changes
    return st.staged.concat(st.unstaged).length ? '' : '';
  }
  // `git checkout -` / `git switch -`
  let target = rest[0];
  if (target === '-') {
    const last = [...g.reflog].reverse().find(r => r.msg.startsWith('checkout: moving from '));
    if (!last) throw new GitError('fatal: invalid reference: @{-1}');
    target = /moving from (\S+) to/.exec(last.msg)[1];
  }
  if (createName) {
    if (!validBranch(createName)) throw new GitError("fatal: '" + createName + "' is not a valid branch name");
    if (g.refs['refs/heads/' + createName] && !force) throw new GitError("fatal: a branch named '" + createName + "' already exists");
    const start = target ? sim.resolveCommit(target) : sim.headHash();
    if (!start) { // unborn branch: just rename HEAD
      g.head = { ref: 'refs/heads/' + createName };
      sim.op('write HEAD', '.git/HEAD ← ref: refs/heads/' + createName + ' (still no commits)', 'head');
      return "Switched to a new branch '" + createName + "'";
    }
    g.refs['refs/heads/' + createName] = start;
    sim.op('update-ref', 'refs/heads/' + createName + ' → ' + short(start), 'ref', start);
    const carried = switchTo(sim, start, { ref: 'refs/heads/' + createName }, {}, ctx);
    ctx.r.flow = ['branch'];
    ctx.r.explain = 'git ' + cmd + ' ' + (asSwitch ? '-c' : '-b') + ' ' + createName + ' did two things: created the branch file (a copy of the current commit hash) and pointed HEAD at it. Your files did not change because both branches are on the same commit.';
    return (carried.length ? carried.join('\n') + '\n' : '') + "Switched to a new branch '" + createName + "'";
  }
  if (!target) throw new GitError('fatal: missing branch or commit argument');
  if (o.f.orphan) throw new GitError('fatal: --orphan is not available in this simulator.');
  // existing branch?
  if (g.refs['refs/heads/' + target] && !o.f.detach) {
    const ref = 'refs/heads/' + target;
    if (g.head.ref === ref) { ctx.r.explain = 'You are already on ' + target + '; HEAD did not move.'; return "Already on '" + target + "'"; }
    const carried = switchTo(sim, g.refs[ref], { ref }, {}, ctx);
    ctx.r.explain = 'Switching branches rewrote .git/HEAD to point at "' + target + '", then Git made the index and working directory match that branch\'s latest commit. Only files that differ between the two commits were touched.';
    return (carried.length ? carried.join('\n') + '\n' : '') + "Switched to branch '" + target + "'";
  }
  // a path? (checkout only)
  if (!asSwitch && !o.f.detach) {
    const asCommit = sim.tryResolveCommit(target);
    if (!asCommit) {
      const m = specMatcher(target);
      if (Object.keys(g.index).some(m)) return restorePaths(sim, null, [target].concat(rest.slice(1)), ctx);
      throw new GitError(pathErr(target), { code: 'pathspec' });
    }
  }
  if (asSwitch && !o.f.detach) {
    if (sim.tryResolveCommit(target) && !g.refs['refs/heads/' + target]) throw new GitError('fatal: a branch is expected, got \'' + (/^[0-9a-f]{4,40}$/.test(target) ? 'commit' : 'tag') + '\': \'' + target + '\'\nhint: If you want to detach HEAD at the commit, try again with the --detach option.');
    throw new GitError('fatal: invalid reference: ' + target);
  }
  const h = sim.resolveCommit(target);
  const carried = switchTo(sim, h, { hash: h }, {}, ctx);
  ctx.r.explain = 'HEAD now holds a raw commit hash instead of a branch name: a detached HEAD. You can look around freely, but commits made here are not reachable from any branch name unless you create one.';
  return (carried.length ? carried.join('\n') + '\n' : '') + DETACHED_ADVICE(short(h)) + '\nHEAD is now at ' + short(h) + ' ' + subject(sim, h);
}
G.checkout = (sim, args, ctx) => doCheckout(sim, args, ctx, false);
G.switch = (sim, args, ctx) => doCheckout(sim, args, ctx, true);

/* ---------------------------------------------------------------- merge */
function applyMergeResult(sim, oursFlat, result, conflicts) {
  const g = sim.git();
  const paths = new Set([...Object.keys(oursFlat), ...Object.keys(result)]);
  for (const p of paths) {
    const r = result[p], o = oursFlat[p];
    if (r) { if (!o || o.hash !== r.hash) { sim.s.fs[p] = sim.blobContent(r.hash); sim.op('checkout', p + ' updated by the merge (blob ' + short(r.hash) + ')', 'worktree', r.hash); } g.index[p] = { hash: r.hash, mode: r.mode }; }
    else if (o && !conflicts.some(c => c.path === p)) { delete sim.s.fs[p]; delete g.index[p]; sim.op('unlink', p + ' removed by the merge', 'worktree'); }
  }
}
G.merge = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '--no-ff': 'noff', '--ff-only': 'ffonly', '--ff': 'ff', '--abort': 'abort', '--no-edit': 'noedit', '-q': 'q', '--squash': 'squash', '--continue': 'cont' }, val: { '-m': 'm', '--message': 'm' } }, 'merge');
  const g = sim.git();
  if (o.f.abort) {
    if (!g.mergeHead) throw new GitError('fatal: There is no merge to abort (MERGE_HEAD missing).');
    const head = sim.headFlat();
    for (const p of new Set([...Object.keys(g.index), ...Object.keys(head), ...Object.keys(g.conflicts || {})])) {
      if (head[p]) { sim.s.fs[p] = sim.blobContent(head[p].hash); g.index[p] = { hash: head[p].hash, mode: head[p].mode }; }
      else { delete sim.s.fs[p]; delete g.index[p]; }
    }
    g.conflicts = {}; g.mergeHead = null; g.mergeMsg = null;
    sim.op('merge --abort', 'index and working directory restored to HEAD', 'worktree');
    ctx.r.flow = ['repo>idx', 'repo>wd'];
    ctx.r.explain = 'git merge --abort threw away the half-finished merge and put your files back exactly as they were at HEAD.';
    return '';
  }
  if (o.f.cont) { return G.commit(sim, ['--no-edit'], ctx); }
  const name = o.rest[0];
  if (!name) throw new GitError('fatal: No remote for the current branch.');
  if (g.mergeHead) throw new GitError('error: You have not concluded your merge (MERGE_HEAD exists).\nhint: Please, commit your changes before merging.\nfatal: Exiting because of unfinished merge.');
  const theirs = sim.tryResolveCommit(name);
  if (!theirs || !(g.refs['refs/heads/' + name] || g.refs['refs/tags/' + name] || /^[0-9a-f]{4,40}$/.test(name))) throw new GitError(name + ' - not something we can merge');
  const ours = sim.headHash();
  if (!ours) throw new GitError(name + ' - not something we can merge');
  if (ours === theirs || sim.ancestors(ours).has(theirs)) { ctx.r.explain = 'Every commit on "' + name + '" is already part of your branch\'s history, so there is nothing to merge.'; return 'Already up to date.'; }
  const oursFlat = sim.commitFlat(ours), theirsFlat = sim.commitFlat(theirs);
  const base = sim.mergeBase(ours, theirs);
  const dirty = sim.dirtyPaths();
  const touched = sim.diffFlat(oursFlat, theirsFlat, { renames: false }).map(c => c.path);
  const clash = touched.filter(p => dirty.has(p));
  if (clash.length) throw new GitError('error: Your local changes to the following files would be overwritten by merge:\n\t' + clash.join('\n\t') + '\nPlease commit your changes or stash them before you merge.\nAborting', { code: 'dirty-merge' });
  const curName = sim.branchName();
  const defaultTarget = ['main', 'master'].includes(curName);
  // fast-forward
  if (base === ours && !o.f.noff) {
    const ch = sim.diffFlat(oursFlat, theirsFlat, { renames: true });
    const header = 'Updating ' + short(ours) + '..' + short(theirs) + '\nFast-forward';
    const applied = sim.applyTree(oursFlat, theirsFlat);
    sim.moveHeadTo(theirs, 'merge ' + name + ': Fast-forward');
    sim.op('update-ref', (g.head.ref || 'HEAD') + ' → ' + short(theirs) + ' (branch pointer slid forward; no new commit)', 'ref', theirs);
    for (const p of applied) sim.op('checkout', p + (sim.s.fs[p] !== undefined ? ' updated from blob ' + short(g.index[p].hash) : ' removed'), 'worktree');
    ctx.r.flow = ['repo>idx', 'repo>wd'];
    ctx.r.explain = 'Fast-forward: "' + curName + '" had no new commits of its own, so Git simply moved the branch pointer forward to "' + name + '"\'s commit and updated your files. No merge commit was needed. Both branch names now point at the same commit.';
    return header + '\n' + sim.diffStat(ch) + '\n' + sim.shortStat(ch) + (sim.summaryLines(ch).length ? '\n' + sim.summaryLines(ch).join('\n') : '');
  }
  if (o.f.ffonly) throw new GitError('fatal: Not possible to fast-forward, aborting.');
  // three-way merge
  const baseFlat = base ? sim.commitFlat(base) : {};
  const result = {}, conflicts = [], msgs = [];
  const labels = ['HEAD', name];
  const paths = [...new Set([...Object.keys(baseFlat), ...Object.keys(oursFlat), ...Object.keys(theirsFlat)])].sort();
  for (const p of paths) {
    const b = baseFlat[p], oe = oursFlat[p], t = theirsFlat[p];
    const bh = b && b.hash, oh = oe && oe.hash, th = t && t.hash;
    if (oh === th) { if (oe) result[p] = oe; continue; }
    if (bh === oh) { if (t) result[p] = t; continue; }
    if (bh === th) { if (oe) result[p] = oe; continue; }
    if (oe && t) {
      const mg = GS.merge3(b ? sim.blobContent(bh) : '', sim.blobContent(oh), sim.blobContent(th), labels[0], labels[1]);
      if (b) msgs.push('Auto-merging ' + p);
      if (!mg.conflict) { const { hash } = sim.writeBlob(mg.text); result[p] = { hash, mode: oe.mode }; }
      else { msgs.push('CONFLICT (' + (b ? 'content' : 'add/add') + '): Merge conflict in ' + p); conflicts.push({ path: p, type: b ? 'content' : 'add/add', base: bh || null, ours: oh, theirs: th, text: mg.text }); }
    } else {
      const keptIn = oe ? 'HEAD' : name, delIn = oe ? name : 'HEAD';
      msgs.push('CONFLICT (modify/delete): ' + p + ' deleted in ' + delIn + ' and modified in ' + keptIn + '.  Version ' + keptIn + ' of ' + p + ' left in tree.');
      conflicts.push({ path: p, type: 'modify/delete', deletedIn: oe ? 'theirs' : 'ours', base: bh || null, ours: oh || null, theirs: th || null, text: sim.blobContent((oe || t).hash) });
      result[p] = null;
    }
  }
  for (const k of Object.keys(result)) if (!result[k]) delete result[k];
  applyMergeResult(sim, oursFlat, result, conflicts);
  const mergeMsg = o.v.m || ("Merge branch '" + name + "'" + (defaultTarget ? '' : ' into ' + curName));
  ctx.r.flow = ['repo>idx', 'repo>wd'];
  if (conflicts.length) {
    g.conflicts = g.conflicts || {};
    for (const c of conflicts) {
      sim.s.fs[c.path] = c.text; delete g.index[c.path];
      g.conflicts[c.path] = { type: c.type, base: c.base, ours: c.ours, theirs: c.theirs, deletedIn: c.deletedIn };
      sim.op('merge', c.path + ': conflict, index now holds stages 1 (base), 2 (ours), 3 (theirs); the file on disk has <<<<<<< markers', 'worktree');
    }
    g.mergeHead = theirs; g.mergeMsg = mergeMsg;
    ctx.r.explain = 'Both branches changed the same lines, so Git cannot decide. It wrote both versions into the file between <<<<<<<, ======= and >>>>>>> markers and stopped. Edit the file to what you want, git add it, then git commit to finish the merge. (git merge --abort undoes it.)';
    return msgs.join('\n') + '\nAutomatic merge failed; fix conflicts and then commit the result.';
  }
  const built = sim.buildTree(g.index);
  sim.op('write-tree', 'tree ' + short(built.hash) + ' written from the merged index', 'tree', built.hash);
  const hash = sim.createCommit(built.hash, [ours, theirs], mergeMsg, 'merge ' + name + ': Merge made by the \'ort\' strategy.');
  const ch = sim.diffFlat(oursFlat, sim.commitFlat(hash), { renames: true });
  ctx.r.explain = 'The branches had diverged, so Git compared both tips with their common ancestor (the merge base), combined the changes, and wrote a NEW commit with two parents. That is what makes a merge commit different from a fast-forward.';
  return (msgs.length ? msgs.join('\n') + '\n' : '') + "Merge made by the 'ort' strategy.\n" + (ch.length ? sim.diffStat(ch) + '\n' + sim.shortStat(ch) + (sim.summaryLines(ch).length ? '\n' + sim.summaryLines(ch).join('\n') : '') : '');
};

/* ---------------------------------------------------------------- tag, reflog, config, check-ignore */
G.tag = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-a': 'a', '-d': 'd', '-l': 'l', '--list': 'l', '-f': 'f' }, val: { '-m': 'm' } }, 'tag');
  const g = sim.git();
  const names = o.rest.concat(o.after);
  if (o.f.d) {
    return names.map(n => { if (!g.refs['refs/tags/' + n]) throw new GitError("error: tag '" + n + "' not found."); const h = g.refs['refs/tags/' + n]; delete g.refs['refs/tags/' + n]; return "Deleted tag '" + n + "' (was " + short(h) + ')'; }).join('\n');
  }
  if (!names.length || o.f.l) return sim.tags().join('\n');
  const [name, rev] = names;
  if (g.refs['refs/tags/' + name] && !o.f.f) throw new GitError("fatal: tag '" + name + "' already exists");
  const target = rev ? sim.resolveCommit(rev) : sim.headHash();
  if (!target) throw new GitError("fatal: Failed to resolve 'HEAD' as a valid ref.");
  if (o.f.a || o.v.m) {
    if (!o.v.m) throw new GitError('fatal: annotated tag needs a message: use -m');
    const th = sim.writeTag({ object: target, type: 'commit', tag: name, tagger: sim.stamp(), message: o.v.m + '\n' });
    g.refs['refs/tags/' + name] = th;
    sim.op('mktag', 'tag object ' + short(th) + ' → commit ' + short(target) + '; refs/tags/' + name + ' → ' + short(th), 'tag', th);
    ctx.r.explain = 'An annotated tag is the fourth kind of Git object: a message, a tagger and a pointer to a commit. The file in refs/tags/ points at the tag object.';
  } else {
    g.refs['refs/tags/' + name] = target;
    sim.op('update-ref', 'refs/tags/' + name + ' → ' + short(target), 'ref', target);
    ctx.r.explain = 'A lightweight tag is a branch that never moves: a file in .git/refs/tags/ holding a commit hash.';
  }
  return '';
};
G.reflog = (sim, args, ctx) => {
  const g = sim.git();
  if (!g.reflog.length) return '';
  const lines = []; const total = g.reflog.length;
  [...g.reflog].reverse().forEach((r, i) => {
    lines.push(A.y + short(r.hash) + A.x + (i === 0 ? sim.decorString(r.hash) : '') + ' HEAD@{' + i + '}: ' + r.msg);
  });
  ctx.r.explain = 'The reflog records every place HEAD has been. Even after a bad reset, the old commit usually still exists and you can find its hash here. It only covers committed work.';
  return lines.join('\n');
};
G.config = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '--global': 'global', '--local': 'local', '--system': 'global', '-l': 'list', '--list': 'list', '--unset': 'unset', '--get': 'get' } }, 'config');
  const a = o.rest.concat(o.after).map((x, i) => i === 0 ? x.toLowerCase() : x);
  const scopeObj = () => (!o.f.global && sim.s.git) ? sim.s.git.config : sim.s.global;
  if (o.f.list) {
    const out = [];
    for (const [k, v] of Object.entries(sim.s.global)) out.push(k + '=' + v);
    if (sim.s.git) for (const [k, v] of Object.entries(sim.s.git.config)) out.push(k + '=' + v);
    return out.join('\n');
  }
  if (o.f.unset) { delete scopeObj()[a[0]]; return ''; }
  if (a.length === 1 || o.f.get) { const v = sim.config(a[0]); if (v == null) { throw new GitError('', { code: 'quiet' }); } return v; }
  if (a.length >= 2) {
    if (o.f.local && !sim.s.git) throw new GitError('fatal: --local can only be used inside a git repository');
    scopeObj()[a[0]] = a[1];
    ctx.r.explain = 'Config values are plain text. --global writes to your user settings, otherwise they go to .git/config for this repo only. Git stamps user.name and user.email into every commit you make.';
    return '';
  }
  throw new GitError('usage: git config [<options>]');
};
G['check-ignore'] = (sim, args, ctx) => {
  const o = parseFlags(args, { flag: { '-v': 'v', '--verbose': 'v', '--no-index': 'noindex', '-n': 'n', '--non-matching': 'n' } }, 'check-ignore');
  const g = sim.git();
  const paths = o.rest.concat(o.after);
  if (!paths.length) throw new GitError('fatal: no path specified');
  const rules = sim.ignoreRules(); const out = [];
  for (const raw of paths) {
    const isDir = /[\\/]$/.test(raw); const p = normPath(raw);
    if (!o.f.noindex && g.index[p]) continue;
    let info;
    if (isDir) { const h = GS.ruleHitFor ? null : null; info = sim.ignoreInfo(p + '/x', rules); const dirHit = rules.filter(r => { const t = r.anchored ? p : p.slice(p.lastIndexOf('/') + 1); return r.re.test(t); }).pop(); info = dirHit && !dirHit.neg ? { ignored: true, rule: dirHit } : { ignored: false, rule: dirHit }; }
    else info = sim.ignoreInfo(p, rules);
    if (info.ignored || (o.f.v && o.f.n)) {
      if (o.f.v) out.push(info.rule ? '.gitignore:' + info.rule.line + ':' + info.rule.raw + '\t' + raw : '::\t' + raw);
      else out.push(raw);
    }
  }
  ctx.r.explain = 'check-ignore -v reports which rule (file:line:pattern) matches a path. Add --no-index to ask the question while ignoring that the file is already tracked.';
  if (!out.length) throw new GitError('', { code: 'quiet' });
  return out.join('\n');
};

/* ---------------------------------------------------------------- help + version */
G.version = () => VERSION;
G.help = () => 'usage: git [-v | --version] [-h | --help] <command> [<args>]\n\nstart a working area\n   init       Create an empty Git repository\n\nwork on the current change\n   add        Add file contents to the index\n   mv         Move or rename a file\n   restore    Restore working tree files\n   rm         Remove files from the working tree and from the index\n\nexamine the history and state\n   diff       Show changes between commits, index and working tree\n   log        Show commit logs\n   show       Show various types of objects\n   status     Show the working tree status\n\ngrow, mark and tweak your common history\n   branch     List, create, or delete branches\n   commit     Record changes to the repository\n   merge      Join two or more development histories together\n   reset      Reset current HEAD to the specified state\n   switch     Switch branches\n   tag        Create, list, delete or verify a tag object\n\ninternals\n   cat-file, hash-object, ls-files, ls-tree, write-tree, commit-tree, update-ref, reflog\n\nThis simulator is local only: clone, fetch, pull and push need a remote.';
G.KNOWN = ['add', 'branch', 'checkout', 'cat-file', 'check-ignore', 'clean', 'commit', 'commit-tree', 'config', 'diff', 'hash-object', 'help', 'init', 'log', 'ls-files', 'ls-tree', 'merge', 'mv', 'reflog', 'reset', 'restore', 'rev-parse', 'rm', 'show', 'status', 'switch', 'symbolic-ref', 'tag', 'update-index', 'update-ref', 'write-tree'];
G.UNSUPPORTED = { clone: 'needs a remote', fetch: 'needs a remote', pull: 'needs a remote', push: 'needs a remote', remote: 'needs a remote', stash: 'is not implemented in this simulator', rebase: 'is not implemented in this simulator', 'cherry-pick': 'is not implemented in this simulator', revert: 'is not implemented in this simulator', bisect: 'is not implemented in this simulator', blame: 'is not implemented in this simulator', gc: 'is not needed here (the simulator never packs objects)', fsck: 'is not implemented in this simulator' };

GS.parseFlags = parseFlags;
GS.statusLong = statusLong;
})(GS);
if (typeof module !== 'undefined') module.exports = GS;
