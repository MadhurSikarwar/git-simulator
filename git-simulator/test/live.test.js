// Run with: node test/live.test.js
// Runs the same steps in REAL git and in the simulator, then compares what the Live page would draw.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const load = require('./load'); const GS = load();
const { snapshot } = require('../server/git-watch.js');
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) pass++; else { fail++; console.log('FAIL ' + label + (extra ? '\n  ' + JSON.stringify(extra, null, 0) : '')); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcmp-'));
const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' });
const real = (...a) => cp.execFileSync('git', ['-c', 'core.autocrlf=false'].concat(a), { cwd: dir, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
const wr = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
let clock = 1792263856;
const ws = new GS.ui.Workspace({ files: {} }); ws.sim.now = () => clock++;
const sim = () => ws.sim;
const both = {
  write: (f, t) => { wr(f, t); ws.write(f, t); },
  del: f => { fs.unlinkSync(path.join(dir, f)); ws.run('rm ' + f); },
  git: (line, ...realArgs) => { try { real(...realArgs); } catch (e) { /* some steps are expected to fail */ } ws.run(line); }
};

const norm = (snap, simSnap) => {
  const pick = rows => rows.filter(r => r.st !== 'ignored').map(r => r.p + ' ' + r.st + ' ' + (r.st === 'deleted' || r.st === 'conflict' ? '-' : (r.h || '?'))).sort();
  const idx = rows => rows.map(r => r.p + ' ' + (r.tag || '.') + ' ' + (r.h || '-')).sort();
  return { wd: pick(snap.wd), idx: idx(snap.index), repo: snap.repo.map(r => r.p + ' ' + r.h).sort() };
};
async function compare(label) {
  const r = await snapshot(dir);
  const s = GS.ui.snapshotFromSim(sim(), dir);
  const a = norm(r), b = norm(s);
  const sameWd = JSON.stringify(a.wd) === JSON.stringify(b.wd), sameIdx = JSON.stringify(a.idx) === JSON.stringify(b.idx), sameRepo = JSON.stringify(a.repo) === JSON.stringify(b.repo);
  ok(sameWd, label + ': working directory rows agree', { real: a.wd, sim: b.wd });
  ok(sameIdx, label + ': index rows agree', { real: a.idx, sim: b.idx });
  ok(sameRepo, label + ': repository rows agree', { real: a.repo, sim: b.repo });
  const cr = r.counts, cs = s.counts;
  ok(cr.staged === cs.staged && cr.modified === cs.modified && cr.untracked === cs.untracked, label + ': counts agree', { real: cr, sim: cs });
  ok(r.head.branch === s.head.branch && !!r.head.hash === !!s.head.hash, label + ': HEAD agrees', { real: r.head, sim: s.head });
  ok(r.branches.map(x => x.name).sort().join() === s.branches.map(x => x.name).sort().join(), label + ': branch names agree');
  ok(r.commits.map(c => c.s).join('|') === s.commits.map(c => c.s).join('|') || r.commits.map(c => c.s).sort().join('|') === s.commits.map(c => c.s).sort().join('|'), label + ': commit subjects agree', { real: r.commits.map(c => c.s), sim: s.commits.map(c => c.s) });
}

(async () => {
  both.write('index.html', '<h1>Hi</h1>\n'); both.write('style.css', 'body { margin: 0; }\n');
  both.git('git init', 'init', '-q', '-b', 'main');
  await compare('after init');
  both.git('git add index.html', 'add', 'index.html'); await compare('after add one file');
  both.git('git add .', 'add', '.'); await compare('after add .');
  both.git('git commit -m "first"', 'commit', '-q', '-m', 'first'); await compare('after first commit');
  both.write('index.html', '<h1>Hi</h1>\n<p>more</p>\n'); await compare('edited');
  both.git('git add index.html', 'add', 'index.html'); await compare('edit staged');
  both.write('index.html', '<h1>Hi</h1>\n<p>more</p>\n<p>again</p>\n'); await compare('staged then edited again (AM)');
  both.git('git commit -am "second"', 'commit', '-q', '-am', 'second'); await compare('after commit -a');
  both.del('style.css'); await compare('deleted from disk');
  both.git('git add style.css', 'add', 'style.css'); await compare('deletion staged');
  both.git('git commit -m "remove css"', 'commit', '-q', '-m', 'remove css'); await compare('deletion committed');
  both.write('notes.txt', 'n\n'); both.write('src/app.js', 'a\n'); await compare('two untracked files, one in a folder');
  both.git('git add .', 'add', '.'); both.git('git commit -m "notes"', 'commit', '-q', '-m', 'notes'); await compare('committed untracked files');
  both.git('git mv notes.txt memo.txt', 'mv', 'notes.txt', 'memo.txt'); await compare('git mv (rename staged)');
  both.git('git commit -m "rename"', 'commit', '-q', '-m', 'rename');
  both.git('git restore --staged memo.txt', 'restore', '--staged', 'memo.txt');
  both.git('git branch feature', 'branch', 'feature'); both.git('git switch feature', 'switch', '-q', 'feature'); await compare('on feature branch');
  both.write('feat.txt', 'f\n'); both.git('git add feat.txt', 'add', 'feat.txt'); both.git('git commit -m "feat"', 'commit', '-q', '-m', 'feat'); await compare('commit on feature');
  both.git('git switch main', 'switch', '-q', 'main'); await compare('back on main (feat.txt gone from disk)');
  both.git('git merge feature', 'merge', '-q', 'feature'); await compare('fast-forward merge');
  both.write('index.html', '<h1>edited again</h1>\n'); both.git('git restore index.html', 'restore', 'index.html'); await compare('edit discarded with restore');

  // the feed: what changed between two snapshots
  const before = GS.ui.snapshotFromSim(sim(), 'x'); both.write('late.txt', 'l\n');
  const mid = GS.ui.snapshotFromSim(sim(), 'x'); both.git('git add late.txt', 'add', 'late.txt');
  const staged = GS.ui.snapshotFromSim(sim(), 'x'); both.git('git commit -m "late"', 'commit', '-q', '-m', 'late');
  const done = GS.ui.snapshotFromSim(sim(), 'x');
  const D = GS.ui.pages.live.diffSnapshots;
  const e1 = D(before, mid), e2 = D(mid, staged), e3 = D(staged, done);
  ok(e1.ev.length === 1 && /late\.txt<\/code> created/.test(e1.ev[0].html), 'feed: file created', e1.ev);
  ok(e2.ev.some(e => e.k === 'stage' && /late\.txt/.test(e.html)) && e2.flow.has('wd>idx'), 'feed: file staged lights wd>idx', e2);
  ok(e3.ev.some(e => e.k === 'commit' && /“late”/.test(e.html)) && e3.flow.has('idx>repo'), 'feed: commit lights idx>repo', e3);
  const sw = D(done, (() => { both.git('git switch feature', 'switch', '-q', 'feature'); return GS.ui.snapshotFromSim(sim(), 'x'); })());
  ok(sw.ev.some(e => e.k === 'head') && sw.flow.has('repo>wd'), 'feed: switching branch lights repo>wd', sw);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
