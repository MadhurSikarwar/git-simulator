// Run with: node test/engine.test.js
const load = require('./load');
const GS = load();
let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  expected: ' + JSON.stringify(expected) + '\n  actual:   ' + JSON.stringify(actual));
}
function has(text, needle, label) {
  if (String(text).includes(needle)) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  missing: ' + JSON.stringify(needle) + '\n  in: ' + JSON.stringify(text));
}
function lacks(text, needle, label) {
  if (!String(text).includes(needle)) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  should not contain: ' + JSON.stringify(needle) + '\n  in: ' + JSON.stringify(text));
}

let clock = 1792263856;
function mk(files, identity) {
  const sim = new GS.Sim({ now: () => clock++, tz: 330, files: files || { 'hello.txt': 'Hello from Git\n', 'hello1.txt': 'second file\n' }, identity });
  const t = new GS.Terminal(sim);
  const run = line => { const r = t.run(line); r.text = GS.stripAnsi(r.lines); return r; };
  return { sim, t, run };
}

/* ---- real hashes from the handout ---- */
eq(GS.hashBlob('Hello from Git\n'), 'c14b6d18d9d1897ba54dbe203cbc1583427ec0a1', 'blob hash matches the handout');
eq(GS.sha1(GS.utf8('')), 'da39a3ee5e6b4b0d3255bfef95601890afd80709', 'sha1 empty');
eq(GS.sha1(GS.utf8('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d', 'sha1 abc');
eq(GS.sha1(GS.utf8('a'.repeat(1000))), '291e9a6c66994949b57ba5e650361e98fc36b1ba', 'sha1 long');
{
  const { run } = mk();
  eq(run('echo "Hello from Git" | git hash-object --stdin').text, 'c14b6d18d9d1897ba54dbe203cbc1583427ec0a1', 'hash-object --stdin pipeline');
  eq(run("printf 'blob 15\\0Hello from Git\\n' | sha1sum").text, 'c14b6d18d9d1897ba54dbe203cbc1583427ec0a1  -', 'printf | sha1sum handout demo');
  eq(run('git --version').text, 'git version 2.53.0.windows.1', 'version');
}

/* ---- first session: status / add / commit ---- */
{
  const { sim, run } = mk();
  has(run('git status').text, 'not a git repository', 'status before init');
  const init = run('git init');
  has(init.text, 'Initialized empty Git repository in', 'init');
  const st = run('git status');
  has(st.text, 'On branch main', 'on branch main');
  has(st.text, 'No commits yet', 'no commits yet');
  has(st.text, 'Untracked files:', 'untracked');
  has(st.text, 'hello.txt', 'lists hello.txt');
  has(st.text, 'nothing added to commit but untracked files present (use "git add" to track)', 'untracked footer');
  eq(run('git add hello.txt hello1.txt').text, '', 'add is silent');
  has(run('git status').text, 'new file:   hello.txt', 'staged new file');
  has(run('git status').text, '(use "git rm --cached <file>..." to unstage)', 'unborn unstage hint');
  const ls = run('git ls-files -s');
  has(ls.text, '100644 c14b6d18d9d1897ba54dbe203cbc1583427ec0a1 0\thello.txt', 'ls-files -s shows real blob');
  // typo from the handout
  const typo = run('git commit - m "Adding hello and hello1"');
  has(typo.text, "error: pathspec '-' did not match any file(s) known to git", 'typo error 1');
  has(typo.text, "error: pathspec 'm' did not match any file(s) known to git", 'typo error 2');
  has(typo.text, "error: pathspec 'Adding hello and hello1' did not match any file(s) known to git", 'typo error 3');
  eq(typo.ok, false, 'typo not ok');
  has(typo.tip || '', 'ONE token', 'typo tip');
  const c1 = run('git commit -m "Initial Commit."');
  has(c1.text, '[main (root-commit) ', 'root commit line');
  has(c1.text, '] Initial Commit.', 'subject');
  has(c1.text, '2 files changed, 2 insertions(+)', 'shortstat');
  has(c1.text, 'create mode 100644 hello.txt', 'create mode');
  has(run('git status').text, 'nothing to commit, working tree clean', 'clean');
  const head = run('cat .git/HEAD').text; eq(head, 'ref: refs/heads/main', '.git/HEAD');
  const ref = run('cat .git/refs/heads/main').text; eq(ref.length, 40, 'branch file has 40 hex chars');
  eq(sim.headHash(), ref, 'branch file equals HEAD commit');
  has(run('git cat-file -p HEAD').text, 'tree ', 'cat-file commit shows tree');
  has(run('git cat-file -p HEAD^{tree}').text, '100644 blob c14b6d18d9d1897ba54dbe203cbc1583427ec0a1\thello.txt', 'tree lists blob');
  eq(run('git cat-file -t HEAD').text, 'commit', 'type commit');
  eq(run('git cat-file -s c14b6d1').text, '15', 'blob size');
  // objects stored: 2 blobs + 1 tree + 1 commit
  eq(Object.keys(sim.s.git.objects).length, 4, 'object count after first commit');
  // editing
  sim.s.fs['hello.txt'] = 'Hello from Git\nline two\n';
  has(run('git status -s').text, ' M hello.txt', 'short status modified');
  const d = run('git diff');
  has(d.text, 'diff --git a/hello.txt b/hello.txt', 'diff header');
  has(d.text, '@@ -1 +1,2 @@', 'hunk header');
  has(d.text, '+line two', 'added line');
  const c2 = run('git commit -am "made some changes again"');
  has(c2.text, '1 file changed, 1 insertion(+)', 'commit -am');
  lacks(c2.text, 'root-commit', 'second commit not root');
  // parents
  const hc = sim.obj(sim.headHash()).data; eq(hc.parents.length, 1, 'has parent');
  // unchanged blob shared
  const t1 = sim.flatTree(sim.obj(hc.parents[0]).data.tree), t2 = sim.flatTree(hc.tree);
  eq(t1['hello1.txt'].hash, t2['hello1.txt'].hash, 'unchanged file shares blob across snapshots');
  const lg = run('git log --oneline');
  eq(lg.text.split('\n').length, 2, 'oneline has 2 lines');
  has(lg.text, '(HEAD -> main) made some changes again', 'oneline decoration');
  const full = run('git log');
  has(full.text, 'Author: Student <student@example.com>', 'log author');
  has(full.text, 'Date:   ', 'log date'); has(full.text, '    made some changes again', 'indented message');
  has(run('git log --oneline --reverse').text.split('\n')[0], 'Initial Commit.', 'reverse');
  has(run('git show HEAD~1:hello.txt').text, 'Hello from Git', 'show rev:path');
  has(run('git show HEAD').text, '+line two', 'show diff');
  const bad = run('git show HEAD : hello.txt'); has(bad.text, "fatal: ambiguous argument ':'", 'ambiguous colon'); has(bad.tip || '', 'No spaces around the colon', 'colon tip');
}

/* ---- delete, rename, ignore, undo ---- */
{
  const { sim, run } = mk();
  run('git init'); run('git add .'); run('git commit -m "one"');
  run('rm hello1.txt');
  const s1 = run('git status'); has(s1.text, 'deleted:    hello1.txt', 'deleted unstaged'); has(s1.text, '(use "git add/rm <file>..." to update what will be committed)', 'add/rm hint');
  has(run('git ls-files').text, 'hello1.txt', 'index still has file');
  run('git add hello1.txt');
  eq(run('git ls-files').text, 'hello.txt', 'index updated');
  const c = run('git commit -m "removed unused code"'); has(c.text, 'delete mode 100644 hello1.txt', 'delete mode');
  // rename via Rename-Item + add both
  run('Rename-Item hello.txt main.py');
  const s2 = run('git status'); has(s2.text, 'deleted:    hello.txt', 'rename step 1 deleted'); has(s2.text, 'main.py', 'rename step 1 untracked');
  run('git add hello.txt'); run('git add main.py');
  has(run('git status').text, 'renamed:    hello.txt -> main.py', 'rename detected');
  run('git mv main.py hello.java');
  has(run('git status').text, 'renamed:    hello.txt -> hello.java', 'rename with mv');
  const rc = run('git commit -m "Renamed python to java"');
  has(rc.text, '1 file changed, 0 insertions(+), 0 deletions(-)', 'rename numbers');
  has(rc.text, 'rename hello.txt => hello.java (100%)', 'rename summary');
  // ignore
  run('mkdir logs'); run('echo hello > logs/dev.log'); run('echo "/logs/" > .gitignore');
  has(run('git status').text, '.gitignore', 'gitignore untracked');
  lacks(run('git status').text, 'logs/', 'logs ignored');
  has(run('git check-ignore -v logs/dev.log').text, '.gitignore:1:/logs/\tlogs/dev.log', 'check-ignore -v');
  // tracked then ignored
  run('mkdir bin'); run('echo hello > bin/app.bin'); run('git add .'); run('git commit -m "added bin"');
  run('echo "/bin/" >> .gitignore'); run('git add .gitignore'); run('git commit -m "added bin to gitignore"');
  run('echo helloworld > bin/app.bin');
  has(run('git status').text, 'modified:   bin/app.bin', 'ignore has no effect on tracked file');
  const e1 = run('git rm --cached bin/'); has(e1.text, "fatal: not removing 'bin/' recursively without -r", 'rm needs -r');
  has(run('git rm --cached -r bin/').text, "rm 'bin/app.bin'", 'rm --cached -r');
  has(run('git status').text, 'deleted:    bin/app.bin', 'staged deletion');
  run('git commit -m "Remove bin"');
  lacks(run('git status').text, 'bin/', 'bin now ignored');
  has(run('git ls-tree HEAD~1').text, '040000 tree', 'ls-tree shows tree');
  has(run('git ls-tree').text, 'usage: git ls-tree', 'ls-tree usage');
  has(run('git rmm --cached bin/').text, "git: 'rmm' is not a git command", 'typo command');
  has(run('git rmm --cached bin/').text, '\trm', 'suggests rm');
  // undo group
  run('echo sky > file.js'); run('echo sky > file2.js');
  has(run('git status -s').text, '?? file.js', 'untracked short');
  run('git add file.js');
  has(run('git status -s').text, 'A  file.js', 'A short');
  run('echo ocean >> file.js');
  has(run('git status -s').text, 'AM file.js', 'AM short');
  run('git add file.js file2.js');
  run('git reset');
  has(run('git status -s').text, '?? file.js', 'reset un-stages new files');
  const r1 = run('git restore'); has(r1.text, 'fatal: you must specify path(s) to restore', 'restore needs path');
  const r2 = run('git restore --staged file.js'); has(r2.text, "error: pathspec 'file.js' did not match any file(s) known to git", 'restore --staged unknown');
  run('git add file.js file2.js'); run('git restore --staged file.js');
  has(run('git status -s').text, 'A  file2.js', 'file2 stays staged');
  run('git reset'); run('git add file.js'); run('git commit -m "adding file.js"');
  const r3 = run('git restore file2.js'); has(r3.text, "pathspec 'file2.js' did not match", 'restore untracked');
  const cl = run('git clean'); has(cl.text, 'clean.requireForce', 'clean needs force');
  has(run('git clean -nd').text, 'Would remove file2.js', 'clean dry run');
  has(run('git clean -fd').text, 'Removing file2.js', 'clean');
  eq(sim.s.fs['file2.js'], undefined, 'file2 deleted');
  lacks(run('ls').text, 'logs/', 'ls no slash');
  has(run('ls').text, 'logs', 'ls shows ignored dir');
  run('rm file.js'); has(run('git rm file.js').text, "rm 'file.js'", 'git rm after rm');
  has(run('git status -s').text, 'D  file.js', 'staged delete short');
  run('git commit -m "Deleted file.js"');
  const back = run('git restore --source=HEAD~1 file.js'); eq(back.text, '', 'restore --source silent');
  has(run('git status -s').text, '?? file.js', 'restored file is untracked');
  const rf = run('git reflog'); has(rf.text, 'HEAD@{0}: commit: Deleted file.js', 'reflog');
}

/* ---- branches, switching rewrites files, fast-forward, real merge, conflicts ---- */
{
  const { sim, run } = mk({ 'index.html': '<h1>Hi</h1>\n', 'style.css': 'body { margin: 0; }\n' });
  run('git init'); run('git add .'); run('git commit -m "Initial responsive webpage"');
  eq(run('git branch').text, '* main', 'branch list');
  eq(run('git branch feature').text, '', 'branch create silent');
  eq(run('git branch').text, '  feature\n* main', 'two branches (alphabetical, like real git)');
  eq(sim.s.git.refs['refs/heads/feature'], sim.s.git.refs['refs/heads/main'], 'new branch same commit');
  has(run('git checkout feature').text, "Switched to branch 'feature'", 'checkout');
  eq(run('cat .git/HEAD').text, 'ref: refs/heads/feature', 'HEAD follows');
  sim.s.fs['style.css'] = 'body { margin: 0; color: navy; }\n';
  run('git commit -am "feature: colour"');
  const featureTip = sim.headHash();
  has(run('git checkout main').text, "Switched to branch 'main'", 'back to main');
  eq(sim.s.fs['style.css'], 'body { margin: 0; }\n', 'checkout rewrote the working file');
  const mg = run('git merge feature');
  has(mg.text, 'Fast-forward', 'fast-forward'); has(mg.text, 'style.css | 2 +-', 'ff stat'); has(mg.text, '1 file changed, 1 insertion(+), 1 deletion(-)', 'ff shortstat');
  eq(sim.headHash(), featureTip, 'main moved to feature tip');
  eq(sim.s.fs['style.css'], 'body { margin: 0; color: navy; }\n', 'file restored by merge');
  has(run('git merge feature').text, 'Already up to date.', 'already up to date');
  has(run('git log --oneline').text, '(HEAD -> main, feature)', 'both labels');
  // dirty checkout protection
  run('git switch feature'); sim.s.fs['index.html'] = '<h1>feature edit</h1>\n'; run('git commit -am "feature: heading"');
  run('git switch main');
  sim.s.fs['index.html'] = '<h1>local edit</h1>\n';
  const blocked = run('git switch feature'); has(blocked.text, 'Your local changes to the following files would be overwritten by checkout', 'dirty checkout blocked'); has(blocked.text, '\tindex.html', 'names file');
  run('git restore index.html');
  // diverge -> true merge commit
  sim.s.fs['style.css'] = 'body { margin: 0; color: navy; }\n.card { padding: 1rem; }\n'; run('git commit -am "main: card"');
  const tm = run('git merge feature');
  has(tm.text, "Merge made by the 'ort' strategy.", 'ort merge');
  const mc = sim.obj(sim.headHash()).data; eq(mc.parents.length, 2, 'merge commit has two parents');
  eq(mc.message, "Merge branch 'feature'\n", 'merge message');
  eq(sim.s.fs['index.html'], '<h1>feature edit</h1>\n', 'merged index.html');
  has(sim.s.fs['style.css'], '.card', 'merged style.css kept main change');
  const gr = run('git log --oneline --graph').text; has(gr, '*   ', 'graph merge line'); has(gr, '|\\', 'graph fork'); has(gr, '|/', 'graph join');
  console.log('--- graph sample ---\n' + gr + '\n--------------------');
  // detached head
  const dh = run('git checkout HEAD~1'); has(dh.text, "You are in 'detached HEAD' state", 'detached advice'); has(dh.text, 'HEAD is now at', 'detached summary');
  has(run('git status').text, 'HEAD detached at', 'status detached');
  run('git switch -');
  has(run('git branch -d feature').text, 'Deleted branch feature', 'branch -d merged');
  has(run('git branch -d main').text, "cannot delete branch 'main'", 'cannot delete current');
}
{ // conflict
  const { sim, run } = mk({ 'a.txt': 'one\ntwo\nthree\n' });
  run('git init'); run('git add .'); run('git commit -m base');
  run('git switch -c other'); sim.s.fs['a.txt'] = 'one\nTWO from other\nthree\n'; run('git commit -am "other change"');
  run('git switch main'); sim.s.fs['a.txt'] = 'one\ntwo from main\nthree\n'; run('git commit -am "main change"');
  const m = run('git merge other');
  has(m.text, 'CONFLICT (content): Merge conflict in a.txt', 'conflict'); has(m.text, 'Automatic merge failed; fix conflicts and then commit the result.', 'conflict footer');
  has(sim.s.fs['a.txt'], '<<<<<<< HEAD\ntwo from main\n=======\nTWO from other\n>>>>>>> other\n', 'markers');
  has(run('git status').text, 'both modified:   a.txt', 'unmerged status');
  has(run('git ls-files -s').text, ' 1\ta.txt', 'stage 1'); has(run('git ls-files -s').text, ' 3\ta.txt', 'stage 3');
  has(run('git commit -m x').text, 'Committing is not possible because you have unmerged files', 'cannot commit');
  sim.s.fs['a.txt'] = 'one\nboth\nthree\n'; run('git add a.txt');
  has(run('git status').text, 'All conflicts fixed but you are still merging.', 'fixed');
  const cm = run('git commit -m "Merge other"'); has(cm.text, '] Merge other', 'merge commit');
  eq(sim.obj(sim.headHash()).data.parents.length, 2, 'two parents after conflict resolution');
  run('git switch other'); run('git switch main');
  sim.s.fs['a.txt'] = 'x\n'; run('git commit -am y'); run('git switch -c c2 HEAD~1'); sim.s.fs['a.txt'] = 'z\n'; run('git commit -am z'); run('git switch main');
  run('git merge c2'); has(run('git merge --abort').text, '', 'abort ok'); eq(run('git status').text.includes('merging'), false, 'aborted');
}

/* ---- commit message editor, identity, amend, plumbing, rm -rf .git ---- */
{
  const { sim, t, run } = mk(null, false);
  run('git init'); run('git add .');
  const noid = run('git commit -m x'); has(noid.text, 'Author identity unknown', 'identity unknown'); has(noid.tip || '', 'Git stamps', 'identity tip');
  run('git config --global user.name "Asha"'); run('git config --global user.email "asha@rvce.edu"');
  eq(run('git config user.name').text, 'Asha', 'config get');
  const ed = t.run('git commit');
  eq(!!ed.editor, true, 'editor requested'); has(ed.editor.text, '# On branch main', 'template');
  const done = t.finishEditor(ed, 'Initial commit from editor\n\nBody text here\n\n# comment\n');
  has(GS.stripAnsi(done.lines), '[main (root-commit) ', 'editor commit');
  has(run('git log').text, '    Body text here', 'body in log');
  has(run('git log').text, 'Author: Asha <asha@rvce.edu>', 'author');
  const empty = t.run('git commit --allow-empty'); const e2 = t.finishEditor(empty, '# only comments\n'); has(GS.stripAnsi(e2.lines), 'Aborting commit due to empty commit message.', 'empty aborts');
  // amend
  sim.s.fs['hello.txt'] = 'amended\n'; run('git add .');
  const old = sim.headHash(); has(run('git commit --amend -m "fixed message"').text, '] fixed message', 'amend');
  eq(sim.obj(sim.headHash()).data.parents.length, 0, 'amend keeps root'); eq(sim.s.git.objects[old] !== undefined, true, 'old commit still exists');
  // plumbing build of a commit
  run('echo plumbing > p.txt'); const bl = run('git hash-object -w p.txt').text; run('git update-index --add p.txt');
  const tree = run('git write-tree').text; const cm = run('git commit-tree ' + tree + ' -p HEAD -m "by hand"').text;
  eq(cm.length, 40, 'commit-tree hash'); run('git update-ref refs/heads/main ' + cm);
  has(run('git log --oneline').text, 'by hand', 'plumbing commit visible');
  // rm -rf .git
  run('rm -rf .git'); eq(sim.s.git, null, 'repo wiped'); has(run('git status').text, 'not a git repository', 'status after wipe');
}
{ // tags, config list, detached etc
  const { sim, run } = mk();
  run('git init'); run('git add .'); run('git commit -m a'); run('git tag v1'); run('git tag -a v2 -m "release two"');
  eq(run('git tag').text, 'v1\nv2', 'tag list'); has(run('git log --oneline').text, 'tag: v1', 'tag decoration');
  eq(run('git cat-file -t v2').text, 'tag', 'annotated tag is a tag object');
  has(run('git config --list').text, 'user.name=Student', 'config list');
  has(run('git push origin main').text, 'local only', 'push unsupported');
  has(run('git rev-parse --short HEAD').text, sim.headHash().slice(0, 7), 'rev-parse');
  has(run('find .git/objects -type f').text, '.git/objects/', 'find objects');
  has(run('ls -a').text, '.git', 'ls -a shows .git');
  const c = t => t;
}
{ // serialisation round trip
  const { sim, run } = mk();
  run('git init'); run('git add .'); run('git commit -m a');
  const copy = new GS.Sim({ state: JSON.parse(sim.toJSON()), tz: 330 });
  eq(copy.headHash(), sim.headHash(), 'state round-trips through JSON');
  const t2 = new GS.Terminal(copy); has(GS.stripAnsi(t2.run('git log --oneline').lines), ' a', 'log works on restored state');
}
{ // tab completion
  const { t } = mk();
  eq(t.complete('git sta').text, 'git status ', 'complete subcommand');
  eq(t.complete('cat hello.t').text, 'cat hello.txt ', 'complete file');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
