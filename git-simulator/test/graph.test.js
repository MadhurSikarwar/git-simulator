// Run with: node test/graph.test.js   (needs real git)
// Branch lanes: where each commit was made, and where branches were merged.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const GS = require('./load')(); const { snapshot, reflogMeta } = require('../server/git-watch.js');
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) pass++; else { fail++; console.log('FAIL ' + label + (extra ? '\n  ' + JSON.stringify(extra) : '')); } };
const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' });
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitgraph-'));
  const g = (...a) => cp.execFileSync('git', ['-c', 'core.autocrlf=false'].concat(a), { cwd: dir, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'master'); const n = { i: 0 };
  return { dir, g, commit(msg) { fs.writeFileSync(path.join(dir, 'f' + (n.i++) + '.txt'), msg + '\n'); g('add', '-A'); g('commit', '-q', '-m', msg); } };
}
const bySubject = (snap, map) => { const out = {}; for (const c of snap.commits) if (map[c.h]) out[c.s] = map[c.h]; return out; };

(async () => {
  // ---- a history shaped like the one in the screenshot: two fast-forward merges
  const r = repo();
  r.commit('c1'); r.commit('c2'); r.commit('c3');
  r.g('switch', '-q', '-c', 'feature2'); r.commit('F2');
  r.g('switch', '-q', 'master'); r.g('merge', '-q', 'feature2');
  r.g('switch', '-q', '-c', 'feature1'); r.commit('F1');
  r.g('switch', '-q', 'master'); r.g('merge', '-q', 'feature1');
  r.commit('M4');
  let snap = await snapshot(r.dir);
  const born = bySubject(snap, snap.born);
  ok(born.c1 === 'master' && born.c3 === 'master' && born.M4 === 'master', 'commits made on master', born);
  ok(born.F2 === 'feature2' && born.F1 === 'feature1', 'commits made on the feature branches', born);
  ok(snap.ff.length === 2 && snap.ff[0].into === 'master' && snap.ff[0].from === 'feature2' && snap.ff[1].from === 'feature1', 'two fast-forward merges found', snap.ff);
  const sub = h => (snap.commits.find(c => c.h === h) || {}).s;
  ok(sub(snap.ff[0].h) === 'F2' && sub(snap.ff[1].h) === 'F1' && sub(snap.ff[0].old) === 'c3' && sub(snap.ff[1].old) === 'F2', 'merge targets and previous tips', snap.ff.map(f => [sub(f.h), sub(f.old)]));
  const live = GS.ui.pages.live; let sim = live.simFromSnapshot(snap);
  let L = GS.ui.graphLayout(sim);
  ok(L.names.join() === 'master,feature2,feature1', 'one lane per branch, in order of appearance', L.names);
  ok(L.ffs.length === 2, 'layout keeps both merge diamonds');
  const lane = s => L.laneOf[L.lab[snap.commits.find(c => c.s === s).h]];
  ok(lane('c1') === 0 && lane('M4') === 0 && lane('F2') === 1 && lane('F1') === 2, 'commits sit on their own lanes', ['c1', 'M4', 'F2', 'F1'].map(lane));
  const x = s => L.gen[snap.commits.find(c => c.s === s).h];
  ok(x('F2') === x('c3') + 1 && x('F1') === x('F2') + 1 && x('M4') === x('F1') + 1, 'time still runs left to right', ['c3', 'F2', 'F1', 'M4'].map(x));

  // ---- the simulator tells the same story from its own reflog
  const ws = new GS.ui.Workspace({ files: { 'a.txt': 'a\n' } }); let t = 1792263856; ws.sim.now = () => t++;
  const run = (...c) => c.forEach(v => ws.run(v));
  const commit = m => { ws.write('g' + t + '.txt', m + '\n'); run('git add .', 'git commit -m "' + m + '"'); };
  run('git init -b master'); commit('c1'); commit('c2'); commit('c3');
  run('git switch -c feature2'); commit('F2'); run('git switch master', 'git merge feature2', 'git switch -c feature1'); commit('F1'); run('git switch master', 'git merge feature1'); commit('M4');
  const L2 = GS.ui.graphLayout(ws.sim);
  ok(L2.names.join() === 'master,feature2,feature1' && L2.ffs.length === 2, 'simulator layout matches real git', { names: L2.names, ffs: L2.ffs.length });
  const sSnap = GS.ui.snapshotFromSim(ws.sim, 'sim');
  ok(JSON.stringify(bySubject(sSnap, sSnap.born)) === JSON.stringify(bySubject(snap, snap.born)), 'branch-of-origin agrees between simulator and real git', { sim: bySubject(sSnap, sSnap.born), real: bySubject(snap, snap.born) });

  // ---- a real merge commit (--no-ff) joins two lanes and needs no diamond
  const m = repo();
  m.commit('a'); m.g('switch', '-q', '-c', 'topic'); m.commit('t1'); m.commit('t2'); m.g('switch', '-q', 'master'); m.commit('b'); m.g('merge', '-q', '--no-edit', 'topic');
  snap = await snapshot(m.dir); sim = live.simFromSnapshot(snap); L = GS.ui.graphLayout(sim);
  const mc = snap.commits.find(c => c.p.length === 2);
  ok(mc && L.lab[mc.h] === 'master', 'the merge commit is made on master', mc && L.lab[mc.h]);
  ok(L.names.join() === 'master,topic' && L.ffs.length === 0, 'two lanes, no fast-forward diamond', { n: L.names, f: L.ffs.length });
  ok(mc.p.every(p => L.set.has(p)) && L.lab[mc.p[1]] === 'topic', 'its second parent is on the topic lane');

  // ---- the branch was deleted after merging: the lane is still known
  const d = repo();
  d.commit('a'); d.g('switch', '-q', '-c', 'gone'); d.commit('g1'); d.g('switch', '-q', 'master'); d.g('merge', '-q', 'gone'); d.g('branch', '-d', 'gone');
  snap = await snapshot(d.dir); sim = live.simFromSnapshot(snap); L = GS.ui.graphLayout(sim);
  ok(L.names.join() === 'master,gone' && L.ffs.length === 1, 'a deleted branch keeps its lane and its merge', { n: L.names, f: L.ffs.length });

  // ---- a repository with no reflog (for example just cloned): fall back to the branch tips, never crash
  const c = repo(); c.commit('a'); c.commit('b'); c.g('switch', '-q', '-c', 'side'); c.commit('s1'); c.g('switch', '-q', 'master'); c.commit('c');
  snap = await snapshot(c.dir); snap.born = {}; snap.ff = []; sim = live.simFromSnapshot(snap); L = GS.ui.graphLayout(sim);
  ok(L.names[0] === 'master' && L.names.includes('side') && Object.keys(L.lab).length === snap.commits.length, 'without reflog data it falls back to branch tips', L.names);

  // ---- reflog replay: the starting branch is learned from the first checkout; detached commits get their own name
  const meta = reflogMeta([{ h: 'a', m: 'commit (initial): one' }, { h: 'b', m: 'commit: two' }, { h: 'b', m: 'checkout: moving from trunk to dev' }, { h: 'c', m: 'commit: three' }, { h: 'c', m: 'checkout: moving from dev to 1f876d1' }, { h: 'd', m: 'commit: four' }], 'dev', ['trunk', 'dev']);
  ok(meta.born.a === 'trunk' && meta.born.b === 'trunk' && meta.born.c === 'dev' && meta.born.d === '(detached)', 'reflog replay backfills the starting branch', meta.born);

  for (const v of [r, m, d, c]) { try { fs.rmSync(v.dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
