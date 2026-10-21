// Run with: node test/lab.test.js
const load = require('./load');
const GS = load();
let pass = 0, fail = 0;
const ok = (c, label) => { if (c) pass++; else { fail++; console.log('FAIL ' + label); } };

// Walk the guided lab with each step's canonical solution; every step must flip from not-done to done.
const sim = new GS.Sim({ now: (() => { let t = 1792263856; return () => t++; })(), tz: 330, files: GS.sampleProject() });
const term = new GS.Terminal(sim);
GS.steps.forEach((st, i) => {
  const before = st.done(GS.labState(sim, term));
  for (const item of st.solve) GS.runSolveItem(sim, term, item);
  const after = st.done(GS.labState(sim, term));
  ok(!before || i === 0 && false, 'step ' + (i + 1) + ' (' + st.id + ') should not be done before its solution');
  ok(after, 'step ' + (i + 1) + ' (' + st.id + ') should be done after its solution');
});
const e = GS.labState(sim, term);
const results = GS.assessment.map(a => [a.id, a.test(sim, e)]);
results.forEach(([id, r]) => ok(r, 'assessment ' + id));
console.log('log:\n' + term.run('git log --oneline --graph --all').lines.replace(/\x1b\[[0-9;]*m/g, ''));
console.log('files on main:', Object.keys(sim.s.fs).join(', '), '| clean:', sim.isClean());

// replaySteps gives the same result on a fresh simulator
const sim2 = new GS.Sim({ now: () => 1792263856, tz: 330, files: GS.sampleProject() });
const term2 = new GS.Terminal(sim2);
GS.replaySteps(sim2, term2, 6);
ok(sim2.hasRepo() && sim2.commitCount === undefined, 'replay builds repo');
ok(GS.labState(sim2, term2).commits === 1, 'replay 6 steps -> 1 commit');

// observation matchers hit the right commands
const log = term.log;
GS.observations.forEach(o => ok(log.some(l => l.ok && o.match.test(l.cmd)), 'observation ' + o.key + ' has a matching command'));

// bonus: real merge + conflict flows
function bonus(cmds, edits) {
  const s = new GS.Sim({ now: (() => { let t = 1792263856; return () => t++; })(), tz: 0, files: GS.sampleProject() });
  const t = new GS.Terminal(s);
  for (const c of cmds) { if (typeof c === 'string') t.run(c); else GS.applyEdit(s, c.edit); }
  return { s, t };
}
const rm = bonus(['git init', 'git add .', 'git commit -m "first commit"', 'git switch -c footer', { edit: 'footer' }, 'git commit -am "Change footer text"', 'git switch main', { edit: 'headerA' }, 'git commit -am "Make header green"']);
const m1 = rm.t.run('git merge footer'); ok(/ort/.test(m1.lines), 'real merge uses ort: ' + m1.lines);
const cf = bonus(['git init', 'git add .', 'git commit -m "first commit"', 'git switch -c theme', { edit: 'headerA' }, 'git commit -am "Header green"', 'git switch main', { edit: 'headerB' }, 'git commit -am "Header maroon"']);
const m2 = cf.t.run('git merge theme'); ok(/CONFLICT \(content\): Merge conflict in style.css/.test(m2.lines), 'bonus conflict: ' + m2.lines);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
