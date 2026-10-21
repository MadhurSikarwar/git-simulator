// Run with: node test/stories.test.js  (every scripted story command must succeed)
const load = require('./load');
const GS = load();
let pass = 0, fail = 0;
const ok = (c, label) => { if (c) pass++; else { fail++; console.log('FAIL ' + label); } };
for (const [key, def] of Object.entries(GS.ui.STORIES)) {
  const ws = new GS.ui.Workspace({ files: def.files });
  def.steps.forEach((st, i) => {
    for (const it of st.run) {
      if (typeof it === 'string') { const r = ws.run(it); ok(r.ok, key + ' step ' + (i + 1) + ': ' + it + ' -> ' + r.lines); }
      else if (it.write) ws.write(it.write[0], it.write[1]);
    }
    if (st.sel) { const s = st.sel(ws); ok(s && s.path, key + ' step ' + (i + 1) + ' selection resolves'); }
  });
  console.log(key, 'ok, objects:', Object.keys(ws.sim.s.git ? ws.sim.s.git.objects : {}).length);
}
// specific expectations
{
  const def = GS.ui.STORIES.objects; const ws = new GS.ui.Workspace({ files: def.files });
  ws.run('git init'); ws.run('git add hello.txt'); const n1 = Object.keys(ws.sim.s.git.objects).length;
  ws.run('git add copy.txt'); ok(Object.keys(ws.sim.s.git.objects).length === n1, 'identical content adds no object');
}
{
  const def = GS.ui.STORIES.ignore; const ws = new GS.ui.Workspace({ files: def.files });
  def.steps.slice(0, 2).forEach(st => st.run.forEach(it => typeof it === 'string' ? ws.run(it) : ws.write(it.write[0], it.write[1])));
  ok(/ M secret.env/.test(ws.term.log[ws.term.log.length - 1].out), 'ignored-but-tracked file still shows modified: ' + JSON.stringify(ws.term.log[ws.term.log.length - 1].out));
  def.steps.slice(2).forEach(st => st.run.forEach(it => typeof it === 'string' ? ws.run(it) : ws.write(it.write[0], it.write[1])));
  ok(/KEY=12345/.test(ws.term.log[ws.term.log.length - 1].out), 'history still has the old secret');
}
{ // branches story ends in a real merge commit
  const def = GS.ui.STORIES.branches; const ws = new GS.ui.Workspace({ files: def.files });
  def.steps.forEach(st => st.run.forEach(it => typeof it === 'string' ? ws.run(it) : ws.write(it.write[0], it.write[1])));
  ok(ws.sim.obj(ws.sim.headHash()).data.parents.length === 2, 'branches story ends with a merge commit');
}
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
