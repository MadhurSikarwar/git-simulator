/* Git Simulator: lab content. The sample project, guided steps, observation
   table, assessment checks, error decoder, cheat sheet and practice questions.
   Content follows the handout "Git, from the inside out" and the Integrated
   Git Lab Exercise. No DOM access. */
(function (GS) {
'use strict';

/* ------------------------------------------------------------ sample project */
const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Full Stack Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="site-header">
    <h1>My Full Stack Project</h1>
    <nav>
      <a href="#courses">Courses</a>
      <a href="#about">About</a>
    </nav>
  </header>
  <main>
    <section id="courses" class="cards">
      <article class="card">
        <h2>HTML</h2>
        <p>Structure a page with semantic tags.</p>
      </article>
      <article class="card">
        <h2>CSS</h2>
        <p>Style it with Flexbox and media queries.</p>
      </article>
    </section>
  </main>
  <footer>
    <p>Skill Lab, Dept. of Computer Science &amp; Engineering</p>
  </footer>
</body>
</html>
`;
const STYLE_CSS = `* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.site-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 5%;
  background: #1f3a5f;
  color: #fff;
}

nav a { color: #fff; margin-left: 1rem; }
main { flex: 1; padding: 2rem 5%; }
.cards { display: flex; gap: 1rem; flex-wrap: wrap; }
.card { flex: 1 1 14rem; padding: 1rem; border: 1px solid #ccd; border-radius: 8px; }
footer { padding: 1rem 5%; background: #eef; text-align: center; }

@media (max-width: 600px) {
  .site-header { flex-direction: column; }
  .cards { flex-direction: column; }
}
`;
GS.sampleProject = () => ({ 'index.html': INDEX_HTML, 'style.css': STYLE_CSS });

/* One-click edits for the lab (the same change a student would type). */
GS.edits = {
  addCard: {
    label: 'Add a "Git" course card', file: 'index.html',
    apply: t => t.replace('    </section>\n  </main>', '      <article class="card">\n        <h2>Git</h2>\n        <p>Save every version of the project.</p>\n      </article>\n    </section>\n  </main>')
  },
  hover: {
    label: 'Add a card hover colour', file: 'style.css',
    apply: t => t.replace('footer {', '.card:hover { background: #fff6dc; }\nfooter {')
  },
  footer: {
    label: 'Change the footer text', file: 'index.html',
    apply: t => t.replace('Skill Lab, Dept. of Computer Science &amp; Engineering', 'Skill Lab, RV College of Engineering')
  },
  headerA: {
    label: 'Make the header green', file: 'style.css',
    apply: t => t.replace(/background: #[0-9a-f]{6};\n  color: #fff;/, 'background: #0b5d3b;\n  color: #fff;')
  },
  headerB: {
    label: 'Make the header maroon', file: 'style.css',
    apply: t => t.replace(/background: #[0-9a-f]{6};\n  color: #fff;/, 'background: #7a1f3d;\n  color: #fff;')
  }
};
GS.applyEdit = (sim, key) => {
  const e = GS.edits[key]; const cur = sim.s.fs[e.file];
  if (cur === undefined) return false;
  const next = e.apply(cur);
  if (next === cur) return false;
  sim.s.fs[e.file] = next; return true;
};

/* ------------------------------------------------------------ derived lab state */
GS.labState = function (sim, term) {
  const has = sim.hasRepo();
  const g = has ? sim.s.git : null;
  const log = term ? term.log : [];
  const ran = re => log.some(l => l.ok && re.test(l.cmd.trim()));
  const base = has ? (Object.keys(g.refs).filter(r => r.startsWith('refs/heads/')).map(r => r.slice(11)).find(b => b === 'main' || b === 'master') || null) : null;
  const countOn = b => { if (!has || !g.refs['refs/heads/' + b]) return 0; return sim.ancestors(g.refs['refs/heads/' + b]).size; };
  const tip = b => (has ? g.refs['refs/heads/' + b] || null : null);
  const others = has ? sim.branches().filter(b => b !== base) : [];
  const dirty = has && sim.headHash() ? sim.dirtyPaths() : new Set();
  const reflog = has ? g.reflog : [];
  return {
    has, ran, base, others, tip, countOn, dirty,
    branch: has ? sim.branchName() : null,
    commits: has && sim.headHash() ? sim.ancestors(sim.headHash()).size : 0,
    clean: has && sim.headHash() ? sim.isClean() : false,
    indexCount: has ? Object.keys(g.index).length : 0,
    mergedFeature: reflog.some(r => /^merge /.test(r.msg) || /^commit \(merge\)/.test(r.msg)),
    featureCommit: reflog.some(r => /^commit/.test(r.msg) && r.br && base && r.br !== base),
    mainCommits: has && base && g.refs['refs/heads/' + base] ? sim.ancestors(g.refs['refs/heads/' + base]).size : 0
  };
};

/* ------------------------------------------------------------ guided steps */
const S = (o) => o;
GS.steps = [
  S({
    id: 'version', title: 'Check that Git is installed',
    goal: 'Before anything else, ask the machine which Git it has.',
    cmds: ['git --version'],
    watch: 'One line comes back. On a machine without Git you would see "command not found" instead.',
    why: 'git is a program installed on your computer. Nothing here touches the internet: Git works fully offline.',
    done: e => e.ran(/^git (--version|version)$/),
    solve: ['git --version']
  }),
  S({
    id: 'folder', title: 'Open the project folder',
    goal: 'Look at what is in the folder before Git knows about it. This is the project from the HTML/CSS exercise.',
    cmds: ['ls', 'ls -a'],
    watch: 'The Working directory column shows index.html and style.css. There is no .git yet, so the other two columns are empty and the history is blank.',
    why: 'Your working directory is just ordinary files on disk. Git adds a hidden .git folder next to them, and that folder is the repository.',
    done: e => e.ran(/^(ls|dir)\b/),
    solve: ['ls']
  }),
  S({
    id: 'init', title: 'Initialise the repository',
    goal: 'Turn the folder into a Git repository.',
    cmds: ['git init'],
    peek: ['ls -a', 'cat .git/HEAD', 'find .git'],
    watch: 'Open the ".git folder" tab: HEAD, config, objects/ and refs/ now exist. HEAD says ref: refs/heads/main, but there is no main file yet. That is why Git will say "No commits yet".',
    why: 'git init only creates the .git folder. Your files are untouched and Git is not tracking any of them yet.',
    done: e => e.has,
    solve: ['git init']
  }),
  S({
    id: 'status', title: 'Inspect with git status',
    goal: 'Ask Git what it sees.',
    cmds: ['git status'],
    watch: 'Both files are listed under "Untracked files". In the Working directory column they carry an "untracked" tag: Git knows they exist but has never saved them.',
    why: 'git status makes two comparisons (HEAD vs index, index vs working directory) and lists files that are in neither. Run it before and after every command until it becomes a habit.',
    done: e => e.has && e.ran(/^git status\b/),
    solve: ['git status']
  }),
  S({
    id: 'add', title: 'Stage the project files',
    goal: 'Choose what goes into the first snapshot.',
    cmds: ['git add .', 'git status'],
    peek: ['git ls-files -s', 'find .git/objects -type f'],
    watch: 'Watch the arrow from Working directory to Index. Each file becomes a blob in the object database, and the same coloured hash now appears in both columns. Two new files appear under .git/objects.',
    why: 'git add hashes the content, stores it as a blob, and writes "path → blob hash" into the index. If you edit the file after this, the staged copy is the old text until you add again.',
    predict: { q: 'You git add a file and then edit it again. What goes into the next commit?', a: 'The version you staged. The blob was written at add time, so your newer edit exists only in the working directory until you git add again. git status will show the file in both lists.' },
    done: e => e.indexCount >= 2,
    solve: ['git add .']
  }),
  S({
    id: 'commit1', title: 'Make the first commit',
    goal: 'Save the staged snapshot with a message.',
    cmds: ['git commit -m "Initial responsive webpage"'],
    peek: ['cat .git/refs/heads/main', 'git cat-file -p HEAD', 'git cat-file -p HEAD^{tree}'],
    watch: 'A commit appears in the history graph and the Repository column fills. The ".git folder" tab now shows refs/heads/main holding the commit id. Type -m as ONE token, with no space between the dash and the m.',
    why: 'git commit turns the index into tree objects, writes a commit that points at the top tree, and moves the branch file to the new commit. The first commit has no parent (root-commit).',
    done: e => e.commits >= 1,
    solve: ['git commit -m "Initial responsive webpage"']
  }),
  S({
    id: 'modify', title: 'Modify the webpage',
    goal: 'Change something real: add a third course card to index.html.',
    cmds: ['nano index.html', 'git status', 'git diff'],
    edit: 'addCard',
    watch: 'The file gets a "modified" tag in the Working directory column and its hash changes, because new content means a new hash. git diff shows the change line by line.',
    why: 'Git never stored a "diff". It compares the two snapshots at the moment you ask.',
    done: e => e.commits >= 2 || e.dirty.has('index.html'),
    solve: [{ edit: 'addCard' }]
  }),
  S({
    id: 'commit2', title: 'Stage and commit the second change',
    goal: 'Make a second, meaningful commit. Name what changed, not "update".',
    cmds: ['git add index.html', 'git commit -m "Add Git course card"'],
    watch: 'The new commit has the first one as its parent. In the Repository column only index.html changed colour: style.css still points at the same blob, so Git stored it once.',
    why: 'Unchanged files are pointed at, not copied. The second snapshot cost one new blob, one new tree and one new commit.',
    done: e => e.commits >= 2 && e.clean,
    solve: ['git add index.html', 'git commit -m "Add Git course card"']
  }),
  S({
    id: 'log', title: 'Read the history',
    goal: 'Show the compact commit history.',
    cmds: ['git log --oneline', 'git log'],
    watch: '(HEAD -> main) marks where you are. The short ids are the first seven characters of the 40-character commit hash. git log follows parent pointers from HEAD backwards.',
    why: 'Each commit stores its parent\'s hash, so history is a chain you can walk.',
    done: e => e.commits >= 2 && e.ran(/^git log\b.*--oneline|^git log --oneline/),
    solve: ['git log --oneline']
  }),
  S({
    id: 'branch', title: 'Create a feature branch',
    goal: 'Make a new line of development.',
    cmds: ['git branch feature', 'git branch'],
    peek: ['cat .git/refs/heads/main', 'cat .git/refs/heads/feature'],
    watch: 'A second label appears on the same commit in the graph. In ".git folder" a new file refs/heads/feature contains the same hash as main. HEAD did not move, so the star is still on main.',
    why: 'A branch is a 41-byte text file holding one commit hash. Creating one copies a hash; nothing else is copied. That is why Git branches are free.',
    predict: { q: 'Where does the name "main" physically live?', a: 'In a tiny text file, .git/refs/heads/main, containing one commit hash. HEAD is another tiny file that says which branch name you are on.' },
    done: e => e.has && e.others.length > 0,
    solve: ['git branch feature']
  }),
  S({
    id: 'switch', title: 'Switch to the feature branch',
    goal: 'Point HEAD at the new branch.',
    cmds: ['git checkout feature', 'git switch main', 'git switch feature'],
    peek: ['cat .git/HEAD'],
    watch: 'The HEAD pill in the graph jumps to feature, and .git/HEAD now reads ref: refs/heads/feature. Your files are unchanged because both branches are on the same commit.',
    why: 'Switching rewrites HEAD, then makes the index and working directory match that branch\'s latest commit.',
    done: e => e.branch && e.branch !== e.base && e.others.length > 0,
    solve: ['git checkout feature']
  }),
  S({
    id: 'featurecommit', title: 'Change something on the feature branch and commit it',
    goal: 'Give the feature branch a commit that main does not have yet.',
    cmds: ['nano style.css', 'git add style.css', 'git commit -m "Add card hover colour"'],
    edit: 'hover',
    watch: 'The feature label moves one commit ahead of main. The two branches have now diverged in length, but main is untouched.',
    why: 'A commit moves only the branch HEAD is attached to. main stays where it was.',
    done: e => e.featureCommit && e.clean,
    solve: [{ edit: 'hover' }, 'git add style.css', 'git commit -m "Add card hover colour"']
  }),
  S({
    id: 'back', title: 'Switch back to main',
    goal: 'Return to main and watch your files change.',
    cmds: ['git checkout main', 'cat style.css'],
    watch: 'The hover rule has disappeared from style.css in your working directory. Git rewrote the file to match main\'s latest commit. The work is safe: it is still on feature.',
    why: 'Your working directory always shows one commit\'s snapshot. Switching branches swaps which snapshot you are looking at.',
    done: e => e.branch === e.base && e.featureCommit,
    solve: ['git checkout main']
  }),
  S({
    id: 'merge', title: 'Merge the feature branch into main',
    goal: 'Bring the feature commit into main.',
    cmds: ['git merge feature', 'git log --oneline'],
    watch: 'Git says "Fast-forward". main had no new commits of its own, so Git just slid the main label forward to feature\'s commit. Both labels now sit on the same commit and the hover rule is back.',
    why: 'A fast-forward creates no new commit. When both branches have new work, Git makes a merge commit with two parents (try "Go further").',
    done: e => e.mergedFeature && e.branch === e.base,
    solve: ['git merge feature']
  }),
  S({
    id: 'finish', title: 'Show the whole story',
    goal: 'Draw the history, then collect your evidence.',
    cmds: ['git log --oneline --graph --all', 'git status'],
    watch: 'Open the Assessment tab: the checklist ticks itself from your repository, and Copy evidence gives you the commit history to submit.',
    why: 'You have now used every area: working directory, index and repository, plus branches and a merge.',
    done: e => e.ran(/^git log\b.*--graph/),
    solve: ['git log --oneline --graph --all']
  })
];
GS.CORE_STEPS = GS.steps.length;

/* Replay the canonical solution of steps [0, n) on a fresh simulator (used by "Set up step N for me"). */
GS.runSolveItem = (sim, term, item) => {
  if (typeof item === 'string') term.run(item);
  else if (item.edit) GS.applyEdit(sim, item.edit);
};
GS.replaySteps = (sim, term, n) => {
  for (let i = 0; i < n && i < GS.steps.length; i++) for (const item of GS.steps[i].solve) GS.runSolveItem(sim, term, item);
};


GS.bonus = [
  S({
    id: 'inside', title: 'Look inside .git', tag: 'Inside',
    goal: 'Read the repository with your own eyes: HEAD, a branch file, a commit, a tree and a blob.',
    cmds: ['cat .git/HEAD', 'cat .git/refs/heads/main', 'git cat-file -p HEAD', 'git cat-file -p HEAD^{tree}', 'git cat-file -t HEAD', 'find .git/objects -type f'],
    watch: 'A commit is a few lines of text: tree, parent, author, message. The tree lists blobs by hash. Click any object in the Objects tab to see the same output.',
    why: 'Everything is one of four object types, stored under the SHA-1 of its content. Nothing is hidden.',
    predict: { q: 'Two files have identical text. How many blobs does Git store, and how many entries does the tree have?', a: 'One blob, because the name is the hash of the content. The tree still has two entries, one per file name, both pointing at the same blob.' },
    done: e => e.ran(/^git cat-file -p\b/),
    solve: []
  }),
  S({
    id: 'hash', title: 'Make a hash by hand', tag: 'Inside',
    goal: 'Prove that the object id is just SHA-1 of a header plus the content.',
    cmds: ['echo "Hello from Git" | git hash-object --stdin', "printf 'blob 15\\0Hello from Git\\n' | sha1sum"],
    watch: 'Both commands print c14b6d18d9d1897ba54dbe203cbc1583427ec0a1. Change one letter and the whole id changes. The Objects tab has a hash playground.',
    why: 'Same content, same name. That is why identical files are stored once, and why a flipped bit is detectable.',
    done: e => e.ran(/hash-object --stdin/),
    solve: []
  }),
  S({
    id: 'realmerge', title: 'A real merge commit', tag: 'Merge',
    goal: 'Both branches get new work, then merge. Git must create a merge commit.',
    cmds: ['git switch -c footer', 'nano index.html', 'git commit -am "Change footer text"', 'git switch main', 'nano style.css', 'git commit -am "Make header green"', 'git merge footer'],
    edits: ['footer', 'headerA'],
    watch: 'This time there is no "Fast-forward". Git writes a new commit with two parents, and the graph shows the branches joining.',
    why: 'Git compares both tips with their common ancestor (the merge base) and combines the changes. Changes in different files or different places merge cleanly.',
    done: e => { return e.has && e.ran(/^git merge footer/) && e.mergedFeature; },
    solve: []
  }),
  S({
    id: 'conflict', title: 'Resolve a merge conflict', tag: 'Merge',
    goal: 'Change the same line on two branches, merge, and fix the markers.',
    cmds: ['git switch -c theme', 'nano style.css', 'git commit -am "Header green"', 'git switch main', 'nano style.css', 'git commit -am "Header maroon"', 'git merge theme'],
    edits: ['headerA', 'headerB'],
    watch: 'Git stops and writes both versions into the file between <<<<<<< and >>>>>>>. git status lists "both modified". Edit the file, git add it, then git commit. git merge --abort backs out.',
    why: 'Git never guesses between two edits of the same lines. Index stages 1, 2 and 3 (see git ls-files -s) hold the base, ours and theirs.',
    done: e => e.has && e.ran(/^git merge theme/),
    solve: []
  }),
  S({
    id: 'undo', title: 'Undo safely', tag: 'Undo',
    goal: 'Feel the difference between the safe group and the destructive group.',
    cmds: ['nano index.html', 'git add index.html', 'git restore --staged index.html', 'git restore index.html', 'git clean -nd'],
    edit: 'addCard',
    watch: 'restore --staged and reset only touch the index, so nothing is lost. restore <file> and clean overwrite or delete files that Git has no copy of.',
    why: 'Before any command that touches your files, ask: was this content ever committed? Preview deletions with git clean -nd.',
    predict: { q: 'You delete a file with rm. Does Git know yet?', a: 'No. The index still lists it. git status shows it as "deleted" under "Changes not staged". Only git add <file> or git rm tells Git.' },
    done: e => e.ran(/^git restore\b/),
    solve: []
  })
];

/* ------------------------------------------------------------ observation table */
GS.observations = [
  { key: 'init', op: 'Initialise repository', cmd: 'git init', match: /^git init\b/,
    model: 'Git printed "Initialized empty Git repository". A hidden .git folder appeared. HEAD points at main, but no commit exists yet.' },
  { key: 'status', op: 'Check status', cmd: 'git status', match: /^git status\b/,
    model: 'The files were listed as untracked (or as staged / modified later). git status shows the branch name and compares HEAD, index and working directory.' },
  { key: 'add', op: 'Stage files', cmd: 'git add .', match: /^git add\b/,
    model: 'No output, but the files moved from untracked to "Changes to be committed". Each file became a blob and an entry in the index.' },
  { key: 'commit', op: 'Commit changes', cmd: 'git commit -m "..."', match: /^git commit\b/,
    model: 'Git printed the branch, a short commit id, the message and "N files changed". A commit id is a SHA-1 hash of the commit contents.' },
  { key: 'log', op: 'View history', cmd: 'git log --oneline', match: /^git log\b.*--oneline/,
    model: 'One line per commit, newest first: short id, (HEAD -> main) on the latest, then the message.' },
  { key: 'branch', op: 'Create / switch branch', cmd: 'git branch / git checkout', match: /^git (branch|checkout|switch)\b/,
    model: 'git branch lists branches and marks the current one with a star. git checkout printed "Switched to branch" and HEAD now points at the other branch.' },
  { key: 'merge', op: 'Merge branch', cmd: 'git merge feature', match: /^git merge\b/,
    model: 'Git printed "Fast-forward" (or "Merge made by the ort strategy") and a summary of changed files. main now contains the feature commit.' }
];

/* ------------------------------------------------------------ assessment checks */
const sem = html => ['header', 'nav', 'main', 'footer'].filter(t => new RegExp('<' + t + '[\\s>]').test(html));
GS.assessment = [
  { id: 'title', text: 'Page is titled "My Full Stack Project"', how: 'Edit index.html: <title> and the main heading.', test: (sim) => /<title>\s*My Full Stack Project\s*<\/title>/.test(sim.s.fs['index.html'] || '') },
  { id: 'semantic', text: 'Semantic HTML (header, nav, main, footer)', how: 'Use semantic tags instead of generic <div>s.', test: sim => sem(sim.s.fs['index.html'] || '').length === 4 },
  { id: 'external', text: 'External stylesheet linked from the page', how: '<link rel="stylesheet" href="style.css">', test: sim => /<link[^>]+rel=["']stylesheet["'][^>]+href=["']style\.css["']/.test(sim.s.fs['index.html'] || '') && sim.s.fs['style.css'] !== undefined },
  { id: 'flex', text: 'Layout uses Flexbox', how: 'display: flex in style.css.', test: sim => /display:\s*flex/.test(sim.s.fs['style.css'] || '') },
  { id: 'responsive', text: 'Responsive sizing (viewport meta, rem/% units)', how: 'Viewport meta tag plus relative units.', test: sim => /name=["']viewport["']/.test(sim.s.fs['index.html'] || '') && /\d(rem|%|vw|vh)/.test(sim.s.fs['style.css'] || '') },
  { id: 'media', text: 'At least one media query', how: '@media (max-width: 600px) { ... }', test: sim => /@media/.test(sim.s.fs['style.css'] || '') },
  { id: 'init', text: 'Project is a Git repository', how: 'git init', test: (sim, e) => e.has },
  { id: 'two', text: 'At least two meaningful commits on main', how: 'Messages that say what changed (8+ characters).', test: (sim, e) => {
      if (!e.has || !e.base) return false;
      const tipH = e.tip(e.base); if (!tipH) return false;
      const msgs = [...sim.ancestors(tipH)].map(h => sim.obj(h).data).filter(c => c.parents.length < 2).map(c => c.message.trim());
      return msgs.length >= 2 && msgs.filter(m => m.length >= 8).length >= 2;
    } },
  { id: 'feature', text: 'A feature branch with its own commit', how: 'git branch feature, git checkout feature, edit, commit.', test: (sim, e) => e.featureCommit },
  { id: 'merged', text: 'Feature branch merged into main', how: 'git checkout main, then git merge feature.', test: (sim, e) => e.mergedFeature && e.branch === e.base },
  { id: 'clean', text: 'Working tree is clean (nothing left uncommitted)', how: 'git status says "working tree clean".', test: (sim, e) => e.clean }
];

/* ------------------------------------------------------------ errors decoded (handout Part 4) */
GS.errors = [
  { typed: 'git commit - m "msg"', said: "pathspec '-' / 'm' / 'msg' did not match", means: 'The space split -m in two. Leftover words are treated as file paths.', fix: 'git commit -m "msg"', try: 'git commit - m "msg"' },
  { typed: 'git rmm --cached bin/', said: "'rmm' is not a git command", means: 'Typo. Git suggests the nearest real command.', fix: 'git rm --cached -r bin/', try: 'git rmm --cached bin/' },
  { typed: 'git rm --cached bin/', said: "not removing 'bin/' recursively without -r", means: 'A directory needs -r, as a guard against removing a whole tree by accident.', fix: 'add -r', try: 'git rm --cached bin/' },
  { typed: 'git rm -r --cached logs/', said: "pathspec 'logs/' did not match any files", means: 'Nothing under logs/ was ever tracked, so there is nothing to untrack.', fix: 'Nothing to fix. Use .gitignore.', try: 'git rm -r --cached logs/' },
  { typed: 'git ls-tree', said: 'usage: git ls-tree ...', means: 'It needs a commit or tree to list.', fix: 'git ls-tree HEAD', try: 'git ls-tree' },
  { typed: 'git restore', said: 'you must specify path(s) to restore', means: 'A safety check: restore overwrites files, so it wants explicit targets.', fix: 'git restore <path>', try: 'git restore' },
  { typed: 'git restore --staged file.js', said: "pathspec ... did not match any file(s) known to git", means: 'The path is in neither the last commit nor the index: already unstaged, never added, or misspelled.', fix: 'Check git status -s first.', try: 'git restore --staged nofile.js' },
  { typed: 'git restore file2.js', said: 'same message', means: 'The file is untracked. There is no saved copy to restore from.', fix: 'Delete it, or git clean.', try: 'git restore untracked-file.js' },
  { typed: 'git clean', said: 'clean.requireForce is true and -f not given', means: 'Safety: untracked files cannot be recovered.', fix: 'git clean -nd, then git clean -fd', try: 'git clean' },
  { typed: 'git show HEAD : file', said: "ambiguous argument ':'", means: 'Spaces around the colon. It must be one word.', fix: 'git show HEAD:file', try: 'git show HEAD : index.html' },
  { typed: 'git commit (no identity)', said: 'Author identity unknown', means: 'Git stamps your name and email into every commit and has none yet.', fix: 'git config --global user.name "You"', try: null }
];

/* ------------------------------------------------------------ cheat sheet (handout Part 7, Table 13) */
GS.cheat = [
  { head: 'Look', items: ['git status', 'git status -s', 'git diff', 'git diff --staged', 'git log', 'git log --oneline', 'git log --oneline --graph --all', 'git show HEAD', 'git ls-files', 'git branch'] },
  { head: 'Save', items: ['git add <path>', 'git add .', 'git commit -m "msg"', 'git commit -am "msg"', 'git mv <old> <new>', 'git rm <path>', 'git rm --cached -r <path>'] },
  { head: 'Branch', items: ['git branch <name>', 'git switch <name>', 'git switch -c <name>', 'git checkout <name>', 'git merge <name>', 'git merge --abort', 'git branch -d <name>'] },
  { head: 'Undo (safe)', items: ['git restore --staged <path>', 'git reset'] },
  { head: 'Undo (destructive)', items: ['git restore <path>', 'git clean -nd', 'git clean -fd', 'git reset --hard'] },
  { head: 'Inside', items: ['git cat-file -p HEAD', 'git ls-tree HEAD', 'git ls-files -s', 'git reflog', 'cat .git/HEAD', 'find .git/objects -type f'] }
];
GS.undoTable = [
  { cmd: 'git restore --staged <path>', index: 'Yes, one path', files: 'No', rev: 'Yes, add again', safe: true },
  { cmd: 'git reset', index: 'Yes, every path', files: 'No', rev: 'Yes, add again', safe: true },
  { cmd: 'git rm --cached <path>', index: 'Yes, drops the path', files: 'No', rev: 'Yes', safe: true },
  { cmd: 'git rm <path>', index: 'Yes', files: 'Yes, deletes it', rev: 'Yes, if it was committed', safe: null },
  { cmd: 'git restore <path>', index: 'No', files: 'Yes, overwrites edits', rev: 'No', safe: false },
  { cmd: 'git clean -f', index: 'No', files: 'Yes, deletes untracked', rev: 'No', safe: false }
];

/* ------------------------------------------------------------ practice (handout Part 8) */
GS.practice = [
  { q: 'Predict the status: create a.txt, git add a.txt, append a line to a.txt, then create b.txt. What does git status -s print?', a: 'AM a.txt and ?? b.txt. The index has the first version (A), the disk has a later edit (M), and b.txt is unknown to Git.' },
  { q: 'You staged notes.txt but do not want it in this commit. Un-stage it without losing your edits.', a: 'git restore --staged notes.txt. The file on disk is untouched.' },
  { q: 'You deleted report.txt in the file explorer. It was committed last week. Get it back. What changes if it was never committed?', a: 'git restore report.txt copies it back from the index (which still has it). If it was never committed or staged, Git has no copy and the file is gone.' },
  { q: '.gitignore contains *.log, yet app.log still appears in git status as modified. Why? What do you run?', a: 'The file is already tracked, and .gitignore only affects untracked files. Run git rm --cached app.log and commit. The rule then applies.' },
  { q: 'Print hello.java as it was two commits ago, without changing any file.', a: 'git show HEAD~2:hello.java' },
  { q: 'Explain the output of git commit - m "fix". Why does Git mention three paths?', a: 'The space turned -m into - and m. Git reads loose words after commit as file paths. Three words (-, m, fix) gave three failed paths. Fix: -m as one token.' },
  { q: 'x.txt and y.txt have identical content. How many blob objects does Git store? How many entries does the tree have?', a: 'One blob, because the object name is a hash of the content. The tree still has two entries, one per file name, both pointing to the same blob.' },
  { q: 'After three commits on main and then git branch dev, which commit do HEAD, main and dev point to? Which files in .git changed?', a: 'All three point at the same commit. HEAD still contains ref: refs/heads/main. Only one new file appears, .git/refs/heads/dev, holding that commit\'s hash.' },
  { q: 'You want to delete all untracked files in a project. What do you run first, and why?', a: 'git clean -nd. The -n flag is a dry run that lists what would be removed. Clean permanently deletes files Git has no copy of, so look first, then run git clean -fd.' },
  { q: 'Compare renaming with a file manager plus two git add commands against git mv. Is the commit different?', a: 'No. The end result is identical: a commit that records a rename. Git detects renames by comparing content, so git mv is only a shortcut that stages both sides for you.' }
];

GS.glossary = {
  blob: 'The bytes of one file. No name, no date. Named by the SHA-1 of its content.',
  tree: 'A folder listing: mode, type, hash and name for each entry.',
  commit: 'A tree hash, parent hash(es), author, committer and message.',
  tag: 'A named pointer to another object, often a commit.'
};
})(GS);
if (typeof module !== 'undefined') module.exports = GS;
