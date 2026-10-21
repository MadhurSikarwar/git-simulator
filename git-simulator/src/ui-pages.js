/* Site: content pages (Home, Learn, Reference, Practice, Session). */
(function (GS) {
'use strict';
const U = GS.ui; const { $, $$, esc } = U;
const P = U.pages = {};
const code = s => '<code>' + esc(s) + '</code>';
const tbl = (head, rows, cls) => `<div class="tbl-wrap"><table class="tbl ${cls || ''}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const callout = (kind, label, html) => `<aside class="callout ${kind}"><b class="co-l">${label}</b><div>${html}</div></aside>`;
const sendBtn = cmd => `<button type="button" class="mini-btn" data-send="${esc(cmd)}">Send to lab</button>`;
const labBtn = (id, label, setup) => `<button type="button" class="btn" data-lab-step="${id}"${setup ? ' data-setup="1"' : ''}>${label}</button>`;

/* ================================================================== HOME */
const HERO_SCRIPT = [
  { cmd: 'git init' },
  { cmd: 'git add hello.txt' },
  { write: ['hello.txt', 'Hello from Git\nA second line\n'], label: '(edit hello.txt)' },
  { cmd: 'git add hello.txt' },
  { cmd: 'git commit -m "Say hello"' },
  { pause: true }
];
P.home = {
  html() {
    return `
<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">Version control · Skill Lab session</p>
    <h1>Git, from the inside out</h1>
    <p class="lede">The commands we type, and the machinery under them. Watch every <code>add</code> and <code>commit</code> move real data between three places, with real hashes, in your browser.</p>
    <div class="cta"><a class="btn primary lg" href="#lab" data-go="lab">Start the lab</a><a class="btn lg" href="#learn" data-go="learn">Learn the ideas first</a></div>
    <p class="hero-facts"><span>15 guided lab steps</span><span>8 short chapters</span><span>Works offline</span></p>
    <div class="resume" data-resume hidden></div>
  </div>
  <figure class="hero-fig">
    <div class="hero-cmd" data-hero-cmd aria-live="polite"><span class="hc-p">$</span> <code>…</code></div>
    <div data-mount="hero-demo" class="hero-demo"></div>
    <figcaption>Fig. 1&nbsp;&nbsp;The three places, running live. <button type="button" class="mini-btn" data-hero-toggle>Pause</button><button type="button" class="mini-btn" data-hero-step>Step</button></figcaption>
  </figure>
</section>

<section class="band ideas">
  <div class="wrap">
    <p class="eyebrow">Three ideas to hold on to</p>
    <h2>Everything else is a consequence of these.</h2>
    <div class="idea-grid">
      <article class="idea"><span class="idea-n">1</span><h3>A commit is a snapshot of the whole project.</h3><p>It is not a list of edits. Git keeps the full picture of every file at that moment and works out the differences only when you ask.</p><a href="#learn-objects" data-go="learn" data-sub="objects" class="more">See it in chapter 4</a></article>
      <article class="idea"><span class="idea-n">2</span><h3>Everything is named by a hash of its content.</h3><p>Same content, same name. Change one character and the name changes completely. Try it:</p><div data-mount="hash-mini"></div></article>
      <article class="idea"><span class="idea-n">3</span><h3>Files travel through three areas.</h3><p>The working directory, the index (staging area) and the repository. Most Git commands only copy data from one area to the next.</p><a href="#learn-places" data-go="learn" data-sub="places" class="more">See it in chapter 2</a></article>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <p class="eyebrow">Your path through the session</p>
    <h2>Six pages, one workspace.</h2>
    <div class="path-grid">
      <a class="path" href="#learn" data-go="learn"><b>Learn</b><span>Eight chapters. Each one runs real commands beside the explanation, a step at a time.</span><i>Open</i></a>
      <a class="path main" href="#lab" data-go="lab"><b>Lab</b><span>The guided 15-step exercise: init, commit, branch, merge. A terminal on the left, the machinery on the right.</span><i>Open</i></a>
      <a class="path live" href="#live" data-go="live"><b>Live repo</b><span>Point it at a real folder, run git in cmd, and watch the three places change as it happens.</span><i>Open</i></a>
      <a class="path" href="#reference" data-go="reference"><b>Reference</b><span>Cheat sheet, error decoder, status codes, revision syntax and Windows traps.</span><i>Open</i></a>
      <a class="path" href="#practice" data-go="practice"><b>Practice</b><span>Ten exercises and a quick check. Predict first, then reveal.</span><i>Open</i></a>
      <a class="path" href="#session" data-go="session"><b>Session</b><span>For the instructor: the 90-minute plan with a timer, the demo script and the questions for the room.</span><i>Open</i></a>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <p class="eyebrow">The 90 minutes</p>
    <h2>A suggested shape for the session.</h2>
    <ol class="timeline" data-timeline></ol>
  </div>
</section>`;
  },
  mount(el, app) {
    this.el = el; this.app = app; this.script = 0;
    this.ws = new U.Workspace({ files: { 'hello.txt': 'Hello from Git\n' } });
    this.view = new U.AreasView($('[data-mount="hero-demo"]', el), this.ws, { caption: false });
    this.paused = U.reducedMotion();
    const tl = $('[data-timeline]', el);
    tl.innerHTML = P.AGENDA.map(a => `<li style="--w:${a.mins}"><span class="tl-t">${a.range}</span><b>${esc(a.title)}</b><span class="tl-d">${esc(a.where)}</span></li>`).join('');
    const tog = $('[data-hero-toggle]', el);
    tog.textContent = this.paused ? 'Play' : 'Pause';
    tog.addEventListener('click', () => { this.paused = !this.paused; tog.textContent = this.paused ? 'Play' : 'Pause'; });
    $('[data-hero-step]', el).addEventListener('click', () => this.tick(true));
    U.$$('[data-mount="hash-mini"]', el).forEach(m => new U.HashPlayground(m, null));
    this.tick(true);
  },
  tick(force) {
    if (!this.el || (!force && this.paused)) return;
    const it = HERO_SCRIPT[this.script % HERO_SCRIPT.length];
    const cmdEl = $('[data-hero-cmd] code', this.el);
    if (it.pause) { this.ws.restart(); cmdEl.textContent = 'start over'; this.script = 0; return; }
    if (it.cmd) { this.ws.run(it.cmd); cmdEl.textContent = it.cmd; }
    else if (it.write) { this.ws.write(it.write[0], it.write[1]); cmdEl.textContent = it.label; }
    this.script++;
  },
  show() {
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (!document.hidden) this.tick(false); }, 2300);
  },
  hide() { clearInterval(this.timer); },
  refresh() {
    const r = $('[data-resume]', this.el); if (!r || !GS.ui.Lab.progress) return;
    const pr = U.Lab.progress(); const nt = U.Lab.nextTodo && U.Lab.nextTodo();
    if (pr.done > 0 && nt) { r.hidden = false; r.innerHTML = `<span>Lab progress: <b>${pr.done} of ${pr.total}</b> steps.</span> <a href="#lab" data-go="lab" data-resume-step="${nt.step.id}">Continue at step ${nt.index + 1}: ${esc(nt.step.title)}</a>`; }
    else r.hidden = true;
  }
};

/* ================================================================== SESSION data (shared with Home) */
P.AGENDA = [
  { mins: 10, range: '0–10', title: 'The problem and the gist', where: 'Learn · chapter 1', what: 'Show the project_final_REAL folder joke, then the three ideas.', go: ['learn', 'problem'] },
  { mins: 15, range: '10–25', title: 'Three areas', where: 'Learn · chapter 2', what: 'Live demo: create two files, git status -s, add one, commit, status again.', go: ['learn', 'places'] },
  { mins: 15, range: '25–40', title: 'Look inside .git', where: 'Learn · chapters 3 and 4', what: 'cat .git/HEAD, find .git/objects, git cat-file -p on a commit and a tree.', go: ['learn', 'dotgit'] },
  { mins: 15, range: '40–55', title: 'Delete, rename, history', where: 'Lab · steps 6 to 9', what: 'Show that Git detects renames after the fact. Read git log.', go: ['lab', 'modify'] },
  { mins: 15, range: '55–70', title: 'Branch, merge, .gitignore', where: 'Lab · steps 10 to 14, Learn · chapter 7', what: 'Branch, change, merge. Let them ignore a file that is already committed.', go: ['lab', 'branch'] },
  { mins: 10, range: '70–80', title: 'Undo', where: 'Learn · chapter 6', what: 'Stress the safe group versus the destructive group.', go: ['learn', 'undo'] },
  { mins: 10, range: '80–90', title: 'Exercises and questions', where: 'Practice', what: 'The exercises, in pairs.', go: ['practice', null] }
];

/* ================================================================== LEARN */
const CHAPTERS = [
  { id: 'problem', title: 'The problem Git solves', lab: 'version', body: () => `
    <p>Every project starts as a folder of files. Then you change something and want to keep the old version as well, so you copy the folder. A week later you have <code>project_final</code>, <code>project_final2</code> and <code>project_final_REAL</code>, and nobody remembers which one has the fix from Tuesday.</p>
    <p>Git replaces that habit with a small database that sits next to your files. It remembers every saved state of the project, who saved it, when, and why. It costs almost nothing to keep.</p>
    <div data-mount="folders" class="widget"></div>
    <p>That lets you answer questions the copy-the-folder method cannot:</p>
    <ul class="qlist"><li>What exactly changed between yesterday and today?</li><li>Who changed this line, and what was the reason?</li><li>Can I go back to the version from before I broke it?</li><li>Can two people edit the same project at the same time without overwriting each other?</li></ul>
    <h3>Centralised and distributed</h3>
    <p>Older tools such as SVN keep the history on one server. You ask the server for a file, change it, and send it back. If the server is down, or you are on a train, you cannot see history or save a version. Git is <b>distributed</b>: every person's copy of the project contains the entire history. A server such as GitHub is just one more copy that people agree to share.</p>
    <div data-mount="distributed" class="widget"></div>
    ${callout('say', 'Say it like this', '<p><b>Git is not GitHub.</b> Git is the version-control tool that runs on your machine. GitHub is one website that hosts remote copies of Git repositories.</p>')}` },
  { id: 'places', title: 'Three places your files live', lab: 'add', body: () => `
    <p>Open the project folder and you see your files. Turn on hidden items and you also see a folder called <code>.git</code>. That one folder is the repository. Everything outside it is your working directory. Git moves content between three areas.</p>
    ${tbl(['Area', 'What it is', 'Who writes to it'], [['Working directory', 'Ordinary files on disk.', 'You, with an editor or the shell. Also ' + code('git restore') + ' and ' + code('git checkout') + '.'], ['Index (staging area)', 'A file, ' + code('.git/index') + ', listing the exact content of the next commit.', code('git add') + ', ' + code('git rm') + ', ' + code('git mv') + ', ' + code('git restore --staged') + ', ' + code('git reset')], ['Repository', 'Immutable objects in ' + code('.git/objects') + ', plus branch names in ' + code('.git/refs') + '.', code('git commit')]])}
    ${callout('say', 'Say it like this', '<p>Think of packing a parcel. The desk is your working directory, where things are messy and changing. The box on the table is the index: you decide what goes in it. Sealing the box and writing it into the delivery log is the commit. You cannot change a sealed box, you can only pack a new one.</p>')}
    <div data-mount="story:areas" class="widget"></div>
    <h3>Why a staging step at all?</h3>
    <p>It lets you choose which of your changes belong together in a commit. You may have edited five files but fixed two separate bugs. Stage the files for bug one, commit, then stage the rest for bug two.</p>
    <h3>Which command moves data where</h3>
    ${tbl(['Command', 'Effect'], [[code('git add <path>'), 'working directory → index'], [code('git commit'), 'index → new commit in the repository; the branch moves forward'], [code('git commit -a'), 'tracked changes in the working directory → index → commit (skips untracked files)'], [code('git restore --staged <path>'), 'last commit → index (un-stage; the working file is untouched)'], [code('git restore <path>'), 'index → working directory (throws away unstaged edits)'], [code('git restore --source=<rev> <path>'), 'any commit → working directory'], [code('git rm <path>'), 'deletes from the working directory and the index'], [code('git rm --cached <path>'), 'deletes from the index only; the file stays on disk (stops tracking)'], [code('git mv <a> <b>'), 'renames in the working directory and the index in one step'], [code('git reset'), 'last commit → index, for every path'], [code('git clean -f'), 'deletes untracked files from the working directory']])}` },
  { id: 'dotgit', title: 'Inside the .git folder', lab: 'init', body: () => `
    <p>Run <code>git init</code> in an empty folder and Git creates a small set of files and folders. The story below opens it up step by step. Click anything in the tree to read it.</p>
    <div data-mount="story:inside" class="widget"></div>
    ${tbl(['Entry', 'What it holds', 'Read it with'], [[code('HEAD'), 'The current branch, for example ' + code('ref: refs/heads/main'), code('cat .git/HEAD')], [code('config'), 'Per-repo settings: name, email, remotes, line-ending rules', code('git config --list --local')], [code('index'), 'The staging area (binary)', code('git ls-files -s')], [code('objects/'), 'Every file version, folder listing and commit ever saved', code('git cat-file -p <hash>')], [code('refs/heads/'), 'One tiny file per branch, containing a commit hash', code('cat .git/refs/heads/main')], [code('logs/'), 'The reflog: where HEAD and branches have been', code('git reflog')], [code('COMMIT_EDITMSG'), 'The last message typed in the editor', code('cat .git/COMMIT_EDITMSG')], [code('info/exclude'), 'Ignore rules that are private to your clone', code('cat .git/info/exclude')]])}
    ${callout('watch', 'Watch out', '<p>Never delete or hand-edit the <code>.git</code> folder to "tidy up". Delete it and you delete the whole history of the project, leaving only the current files. Copying a folder that contains <code>.git</code> copies the history with it.</p><p>In the lab you can see this for yourself: run <code>rm -rf .git</code>, watch the three places empty out, then press Reset lab.</p>')}` },
  { id: 'objects', title: 'Objects: blobs, trees and commits', lab: 'inside', body: () => `
    <p>Git is, at its core, a key-value store. The key is a hash, the value is some content. There are only four kinds of value.</p>
    ${tbl(['Object', 'Stores', 'Roughly like'], [['blob', 'The bytes of one file. No file name, no date, nothing else.', 'the contents of a file'], ['tree', 'A folder listing: for each entry a mode, a type, a hash and a name.', 'a directory'], ['commit', 'One tree hash, parent commit hash(es), author, committer, message.', 'a labelled snapshot'], ['tag', 'A named, optionally signed pointer to another object (often a commit).', 'a sticky note on a release']])}
    <h3>How an object gets its name</h3>
    <p>Git builds a small header (the word <code>blob</code>, a space, the length in bytes and a zero byte), puts the content after it, and runs SHA-1 over the whole thing. That 40-character result is the name. You can reproduce it by hand, and the lab terminal gives the same answers as real Git:</p>
    <pre class="codeblock">$ printf 'Hello from Git\\n' | git hash-object --stdin
c14b6d18d9d1897ba54dbe203cbc1583427ec0a1

$ printf 'blob 15\\0Hello from Git\\n' | sha1sum
c14b6d18d9d1897ba54dbe203cbc1583427ec0a1  -</pre>
    <div data-mount="hash" class="widget"></div>
    <p>Three practical consequences follow from "the name is the hash of the content":</p>
    <ul class="qlist"><li><b>Identical content is stored once.</b> Two files with the same text share one blob.</li><li><b>Objects never change.</b> If the content changes, the hash changes, so it is a new object. Old objects stay exactly as they were.</li><li><b>The hash is also a checksum.</b> If a disk error flips one bit in an object, its content no longer matches its name, and Git can tell.</li></ul>
    <h3>Commits, trees and blobs together</h3>
    <p>A commit does not contain files. It points at a tree, the top-level folder, and the tree points at blobs and at sub-trees. Step through it:</p>
    <div data-mount="story:objects" class="widget"></div>
    ${callout('say', 'Say it like this', '<p>A commit is a photograph of the whole folder, not a list of edits. A photograph that shares most of its pixels with the previous one. If a file did not change, the new photograph just points at the old file.</p>')}
    <h3>Snapshots, not diffs</h3>
    <p>Many people picture a Git history as a stack of patches. Internally it is not. Every commit points at a complete tree. When you run <code>git diff</code> or <code>git show</code>, Git takes the two trees you asked about and compares them at that moment. Differences are computed, never stored.</p>
    <p>The same is true for renames. Git has no "rename" record. When it compares an old tree and a new tree, it notices that one blob disappeared under one name and appeared under another, and judges the contents 100% similar. The default threshold is 50%.</p>
    <p>A commit's own hash is computed from all its lines, including the parent's hash. So changing an old commit changes its hash, which changes every later commit's hash too. That is why history in Git cannot be altered quietly.</p>` },
  { id: 'branches', title: 'Branches, HEAD and finding things', lab: 'branch', body: () => `
    <p>Hashes are hard to remember, so Git has names for them. A branch is the simplest possible name: a text file holding one commit hash. <code>HEAD</code> normally contains the name of a branch, not a hash, which is how Git knows which branch to move when you commit.</p>
    <div data-mount="story:branches" class="widget"></div>
    <p>Creating a branch costs one 41-byte file, which is why people make them freely. When you commit, Git writes the new commit and then changes that one file so it holds the new hash. That is all "the branch moves forward" means.</p>
    <h3>Ways to name a commit</h3>
    ${tbl(['Written as', 'Means', 'Example'], [[code('6e70d24'), 'A unique prefix of the hash. Four characters work if unambiguous.', code('git show 6e70')], [code('HEAD'), 'The commit your current branch points to.', code('git log')], [code('HEAD~1'), 'The parent of HEAD. ' + code('HEAD~2') + ' is the grandparent.', code('git ls-tree HEAD~1')], [code('main'), 'The commit that branch points to.', code('git log main')], [code('HEAD~1:style.css'), 'The file as it was in that commit. The form is ' + code('commit:path') + ', with no spaces.', code('git show HEAD~1:style.css')]])}
    ${callout('say', 'Say it like this', '<p>A <b>detached HEAD</b> is the case where HEAD holds a raw hash instead of a branch name, for example after checking out an old commit to look around. It is not an error. It only means new commits will not be reachable from a branch name unless you create one.</p>')}
    <h3>Fast-forward or merge commit</h3>
    <p>If the branch you are on has no new commits of its own, merging just slides its label forward (a <b>fast-forward</b>). If both branches have new work, Git writes a <b>merge commit</b> with two parents. If both changed the same lines, you get a <b>conflict</b> to resolve by hand. The Lab has an optional step for each.</p>` },
  { id: 'undo', title: 'Taking things back', lab: 'undo', body: () => `
    <p>Git has several undo commands and they are not equally safe. The story shows the difference between the two groups.</p>
    <div data-mount="story:undo" class="widget"></div>
    ${tbl(['Command', 'Changes the index?', 'Changes your files?', 'Reversible?'], GS.undoTable.map(r => [code(r.cmd), esc(r.index), esc(r.files), esc(r.rev)]), 'undo')}
    ${callout('say', 'Say it like this', '<p>Two groups. The first group, <code>restore --staged</code> and <code>reset</code>, only touches the index, so nothing is lost. The second group, <code>restore</code> and <code>clean</code>, touches your real files, so ask yourself whether Git has a copy before you press Enter.</p>')}
    ${callout('watch', 'Watch out', '<p>The safety net only covers things that were committed. Edits that never reached a commit are not in the object database. <code>git restore</code> on a modified file and <code>git clean -f</code> on an untracked file delete work that Git has no copy of. Both are permanent. Run <code>git clean -nd</code> first: <code>-n</code> is a dry run.</p>')}
    <p>For committed work the reflog is the net: <code>git reflog</code> lists every place HEAD has been, so even after a bad reset the old commit can usually be found.</p>` },
  { id: 'ignore', title: 'Ignoring files, and the tracked-file trap', lab: 'status', body: () => `
    <p>A <code>.gitignore</code> file lists things Git should not start watching. It cannot make Git stop watching something it already watches. For that you need <code>git rm --cached</code>.</p>
    <div data-mount="story:ignore" class="widget"></div>
    ${tbl(['Pattern', 'Matches'], [[code('logs/'), 'A directory named logs, anywhere in the project.'], [code('/logs/'), 'Only the logs directory at the top, next to .gitignore.'], [code('*.log'), 'Any file ending in .log, at any depth.'], [code('/main.log'), 'Only main.log in the top folder.'], [code('!keep.log'), 'Exception: do not ignore this file even if another rule would.'], [code('# note'), 'A comment line.']])}
    <p>The leading slash anchors the pattern to the top folder; the trailing slash means folders only. To see why a path is (or is not) ignored, ask Git: ${code('git check-ignore -v <path>')} prints <code>file:line:pattern</code>, and <code>--no-index</code> asks the question while ignoring that the file is already tracked.</p>
    ${callout('watch', 'Watch out', '<p>Untracking does not erase history. If a file held a password or a key, removing it from the next commit does not make it safe: the secret is still inside the earlier commits. Change the secret. This is the best argument for writing <code>.gitignore</code> <b>before</b> the first <code>git add .</code></p>')}` },
  { id: 'remotes', title: 'Where remotes fit', lab: null, body: () => `
    <p>Everything in the lab happens on one computer. No <code>remote</code>, <code>push</code> or <code>pull</code> is needed to learn how Git works. For completeness, here is where a server such as GitHub fits in. A remote is another repository with the same structure.</p>
    <div class="remote-fig" role="img" aria-label="Diagram: your computer has a working directory, index and local repository; push and fetch connect the local repository to a remote repository on a server">
      <div class="rf-box you"><span>Your computer</span><div class="rf-row"><i class="wd">Working directory</i><i class="idx">Index</i><i class="repo">Local repo<br><small>.git</small></i></div></div>
      <div class="rf-mid"><span>git push →</span><span>← git fetch</span><small>pull = fetch + merge</small></div>
      <div class="rf-box srv"><span>Remote</span><div class="rf-row"><i class="repo">Remote repo<br><small>e.g. on GitHub</small></i></div></div>
    </div>
    <ul class="qlist"><li><b>clone</b> copies a remote repository, whole history included, to your machine.</li><li><b>push</b> uploads the objects the remote is missing and moves a branch name over there.</li><li><b>fetch</b> downloads new objects and updates your record of the remote's branches, without touching your files.</li><li><b>pull</b> is a fetch followed by a merge into your current branch.</li></ul>
    <p>Because each copy is complete, everyday work (commit, log, diff, branch) is fast and needs no network. Only the sharing steps do. That is the design bargain: safety (immutable, content-named objects), speed (nearly everything is a local file read), cheap branching, and a safety net in the reflog.</p>` }
];
P.learn = {
  html() {
    return `<div class="page-head wrap"><p class="eyebrow">Learn</p><h2>How Git is built</h2><p class="lede">Eight short chapters. Each interactive panel runs real commands on its own private repository, so you can step forward and back without breaking anything.</p></div>
    <div class="learn wrap">
      <nav class="toc" aria-label="Chapters"><p class="toc-h">Chapters</p><ol>${CHAPTERS.map((c, i) => `<li><a href="#learn-${c.id}" data-ch="${c.id}"><span>${i + 1}</span>${esc(c.title)}</a></li>`).join('')}</ol></nav>
      <div class="chapters">${CHAPTERS.map((c, i) => `<article class="chapter" id="ch-${c.id}" data-ch-id="${c.id}"><header><p class="eyebrow">Chapter ${i + 1}</p><h3 class="ch-title">${esc(c.title)}</h3></header>${c.body()}${c.lab ? `<div class="ch-lab">${labBtn(c.lab, 'Practise this in the lab', true)}<span class="mini">Opens the lab with the repository set up for the matching step.</span></div>` : ''}</article>`).join('')}</div>
    </div>`;
  },
  mount(el, app) {
    this.el = el;
    $$('[data-mount]', el).forEach(m => mountWidget(m, app));
    const links = $$('.toc a', el);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => {
        es.forEach(en => { if (en.isIntersecting) { links.forEach(l => l.classList.toggle('on', l.dataset.ch === en.target.dataset.chId)); } });
      }, { rootMargin: '-20% 0px -70% 0px' });
      $$('.chapter', el).forEach(c => io.observe(c));
    }
    el.addEventListener('click', e => {
      const a = e.target.closest('.toc a'); if (!a) return;
      e.preventDefault(); this.scrollTo(a.dataset.ch);
    });
  },
  scrollTo(id) {
    const t = $('#ch-' + id, this.el); if (!t) return;
    const top = t.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top, behavior: U.reducedMotion() ? 'auto' : 'smooth' });
  },
  show(sub) { if (sub) setTimeout(() => this.scrollTo(sub), 60); }
};

/* ------------------------------------------------------------------ widgets */
function mountWidget(m, app) {
  const kind = m.getAttribute('data-mount');
  if (kind.startsWith('story:')) new U.StoryPlayer(m, kind.slice(6), { openLab: id => app.openLab(id, true) });
  else if (kind === 'hash') new U.HashPlayground(m, null);
  else if (kind === 'folders') foldersWidget(m);
  else if (kind === 'distributed') distributedWidget(m);
}
function foldersWidget(m) {
  const names = ['project', 'project_final', 'project_final2', 'project_final_REAL', 'project_final_REAL_v2', 'project_FINAL_use_this_one'];
  const msgs = ['Add login page', 'Fix the Tuesday bug', 'Add dark mode', 'Update footer text', 'Merge feature branch', 'Tidy the stylesheet'];
  let n = 0;
  m.classList.add('w-folders');
  m.innerHTML = `<div class="wf-col"><h5>The copy-the-folder way</h5><button type="button" class="btn" data-copy>Save a copy</button><ul class="wf-list" aria-live="polite"></ul><p class="wf-q" hidden>Which one has Tuesday's fix?</p></div>
    <div class="wf-col"><h5>The Git way</h5><button type="button" class="btn primary" data-commit>Commit</button><ul class="wf-log" aria-live="polite"></ul><p class="wf-a" hidden>Ask Git: <code>git log --oneline</code></p></div>`;
  const list = $('.wf-list', m), log = $('.wf-log', m);
  const fire = () => {
    if (n >= names.length) { n = 0; list.innerHTML = ''; log.innerHTML = ''; }
    list.insertAdjacentHTML('beforeend', `<li class="fresh"><i aria-hidden="true"></i>${esc(names[n])}</li>`);
    const h = GS.hashBlob(msgs[n] + n).slice(0, 7);
    log.insertAdjacentHTML('beforeend', `<li class="fresh"><i style="background:${U.hashColor(h + '0')}"></i><code>${h}</code> ${esc(msgs[n])}</li>`);
    n++;
    $('.wf-q', m).hidden = n < 4; $('.wf-a', m).hidden = n < 4;
  };
  $('[data-copy]', m).addEventListener('click', fire);
  $('[data-commit]', m).addEventListener('click', fire);
}
function distributedWidget(m) {
  m.classList.add('w-dist');
  let down = false;
  const draw = () => {
    m.innerHTML = `<div class="wd-bar"><button type="button" class="btn ${down ? '' : 'warn'}" data-down>${down ? 'Bring the server back' : 'The server goes down'}</button></div>
    <div class="wd-grid">
      <div class="wd-col"><h5>Centralised (SVN)</h5><div class="wd-net"><div class="node srv ${down ? 'dead' : ''}">server<small>all the history</small></div><div class="clients"><div class="node cli">you<small>one file at a time</small></div><div class="node cli">teammate</div></div></div>
        <p class="wd-r ${down ? 'bad' : 'ok'}">${down ? 'You cannot look at history or save a version. Recovery depends on the server backups.' : 'Ask the server for a file, change it, send it back.'}</p></div>
      <div class="wd-col"><h5>Distributed (Git)</h5><div class="wd-net"><div class="node srv ${down ? 'dead' : ''}">GitHub<small>one more copy</small></div><div class="clients"><div class="node cli full">you<small>full history</small></div><div class="node cli full">teammate<small>full history</small></div></div></div>
        <p class="wd-r ok">${down ? 'Commit, log and diff still work: they are local. Any clone can restore the server.' : 'Every clone holds the whole history. The server is a shared copy.'}</p></div>
    </div>`;
    $('[data-down]', m).addEventListener('click', () => { down = !down; draw(); });
  };
  draw();
}

/* ================================================================== REFERENCE */
const REF = {
  want: [['See what state things are in', 'git status -s', 'Two-letter codes, see the status table'], ['See unstaged changes', 'git diff', 'Working directory versus index'], ['See staged changes', 'git diff --staged', 'Index versus last commit'], ['Stage one file / everything', 'git add <path> / git add .', 'add . stages all, including things you may not want'], ['Commit with a short message', 'git commit -m "msg"', 'No space between - and m'], ['Commit tracked changes in one go', 'git commit -am "msg"', 'Does not include new files'], ['Unstage a file, keep my edits', 'git restore --staged <path>', 'Safe'], ['Unstage everything', 'git reset', 'Safe, mixed mode'], ['Throw away my edits to a file', 'git restore <path>', 'Permanent for uncommitted work'], ['Delete a tracked file', 'git rm <path>', 'Deletes and stages in one step'], ['Rename a tracked file', 'git mv <old> <new>', 'Or rename and add both'], ['Stop tracking but keep the file', 'git rm --cached -r <path>', 'Then add it to .gitignore'], ['Check why a file is ignored', 'git check-ignore -v <path>', 'Add --no-index for tracked files'], ['Preview untracked deletion', 'git clean -nd', 'Then git clean -fd to do it'], ['See what is tracked', 'git ls-files', 'Prints the index'], ['See history', 'git log --oneline', 'Add --reverse, or --graph'], ['See one commit', 'git show <hash>', 'Message plus diff'], ['See a file as it was', 'git show HEAD~1:<path>', 'commit:path, no spaces'], ['List a folder as it was', 'git ls-tree HEAD~1', 'Needs a commit'], ['Get an old version of a file back', 'git restore --source=HEAD~1 <path>', 'Add --staged --worktree to also stage'], ['Find where HEAD has been', 'git reflog', 'The safety net for committed work'], ['Start a branch / move to it', 'git switch -c <name>', 'Or git branch <name> then git switch <name>'], ['Combine a branch into this one', 'git merge <name>', 'git merge --abort backs out']],
  status: [['??', 'Untracked. Not in the index, not in the last commit.', '?? file2.js'], ['A', 'Added to the index, working file identical to it.', 'A  file.js'], ['AM', 'Added to the index, then edited again. Index and disk differ.', 'AM file.js'], ['M (right)', 'Tracked file edited, not yet staged.', ' M index.html'], ['M (left)', 'Modification staged.', 'M  index.html'], ['D (left)', 'Deletion staged.', 'D  file.js'], ['D (right)', 'Deleted from disk, deletion not staged.', ' D file.js'], ['R', 'Rename staged (detected by content).', 'R  old -> new'], ['UU', 'Both modified: merge conflict.', 'UU style.css']],
  traps: [['echo text > file', 'Windows PowerShell 5.1 saves UTF-16. Git calls the file binary, and a .gitignore written this way is unreadable to Git.', 'Out-File -Encoding utf8, Set-Content, an editor, or PowerShell 7'], ['A backtick `', 'It is PowerShell\'s escape character, not a quote.', 'Remove it. Use it only for line continuation at the end of a line.'], ['rm file', 'Alias for Remove-Item. Git is not informed.', 'git rm file'], ['Rename-Item, mv', 'Git sees a delete plus an untracked file until both are staged.', 'git mv old new'], ['ls', 'Alias for Get-ChildItem. Hidden items are not shown.', 'ls -Force'], ['git show HEAD^{tree}', 'PowerShell treats braces specially.', "Quote it: git show 'HEAD^{tree}'"], ['HEAD^ in cmd.exe', 'In cmd.exe the caret is the escape character.', 'Type HEAD^^ or use HEAD~1, which works everywhere']],
  notErr: [['warning: LF will be replaced by CRLF the next time Git touches it', 'Line-ending conversion notice on Windows. The commit still worked.'], ['Binary files ... differ', 'Git found zero bytes and will not show a text diff. Usually a UTF-16 file.'], ['No commits yet', 'Normal in a new repo. The branch file does not exist until the first commit.'], ['nothing to commit, working tree clean', 'Success. All three areas agree.']],
  gloss: [['Repository (repo)', 'The project plus its full history. On disk, the hidden .git folder is the history.'], ['Working directory', 'The normal files and folders you open in your editor.'], ['Index / staging area', 'A list of what will go into the next commit. Filled by git add.'], ['Commit', 'One saved snapshot, with an author, a date, a message and a pointer to its parent commit.'], ['Hash (commit id)', 'The 40-character name of an object, like 6e70d243f9c6… Seven characters are usually enough.'], ['Branch', 'A movable name that points at a commit.'], ['HEAD', 'Git\'s "you are here" marker. Normally it points at the current branch.'], ['Tracked / untracked', 'Tracked: Git already knows the file (in the index or last commit). Untracked: it does not.'], ['Staged', 'Added to the index, so it will be part of the next commit.'], ['Blob', 'A stored file\'s content, named by the hash of that content.'], ['Tree', 'A stored folder listing: names, modes and hashes of blobs and sub-trees.'], ['Pathspec', 'The file or folder arguments you give a Git command. Loose words after a command are read as pathspecs.'], ['Tree-ish / rev', 'Anything Git can resolve to a commit or tree: a hash, HEAD, HEAD~1, a branch name.'], ['Root commit', 'A commit with no parent. The first one in a repository.'], ['Ref', 'A name pointing at a hash: branches, tags, HEAD.'], ['Detached HEAD', 'HEAD holds a raw commit hash instead of a branch name.'], ['Reflog', 'A local log of where HEAD and branches have moved. A recovery tool.'], ['Porcelain / plumbing', 'Everyday commands (add, commit) versus the low-level ones they are built from (hash-object, write-tree).'], ['Ignored', 'An untracked file matched by .gitignore, so Git leaves it out of status and out of add .'], ['Remote', 'Another copy of the repository, usually on a server.']]
};
P.reference = {
  html() {
    return `<div class="page-head wrap"><p class="eyebrow">Reference</p><h2>Look it up</h2><p class="lede">Everything used in the session, indexed by what you are trying to do. Type to filter every table at once.</p>
      <div class="ref-search"><label for="ref-q">Filter</label><input id="ref-q" type="search" placeholder="Try: undo, rename, ignore, detached, pathspec" autocomplete="off"><span class="mini" data-ref-count></span></div></div>
    <div class="wrap ref">
      <section class="ref-sec" data-t="four rules"><h3>Four rules that would have saved time</h3>
        <ol class="rules"><li>Write <code>.gitignore</code> <b>before</b> the first <code>git add .</code></li><li>Type <code>-m</code> as one token. Check <code>git status -s</code> before and after every commit.</li><li>Before any command that touches your files (<code>restore</code>, <code>clean</code>), ask whether the content was ever committed.</li><li>On Windows PowerShell 5.1, do not create text files with <code>></code>.</li></ol></section>
      <section class="ref-sec" data-t="cheat sheet commands"><h3>Cheat sheet</h3><div class="cheat-grid">${GS.cheat.map(g => `<div class="cheat-g"><h4>${esc(g.head)}</h4>${g.items.map(c => `<button type="button" class="cmdchip solo" data-send="${esc(c)}" title="Send to the lab terminal"><code>${esc(c)}</code></button>`).join('')}</div>`).join('')}</div><p class="mini">Click a command to send it to the lab terminal.</p></section>
      <section class="ref-sec" data-t="i want to lookup"><h3>I want to…</h3>${tbl(['I want to…', 'Command', 'Notes'], REF.want.map(r => [esc(r[0]), code(r[1]), esc(r[2])]))}</section>
      <section class="ref-sec" data-t="status codes short"><h3>Reading <code>git status -s</code></h3><p>Two columns before each path. The left one (X) is index versus last commit. The right one (Y) is working directory versus index. A space means no change in that column.</p>${tbl(['Code', 'Meaning', 'Looks like'], REF.status.map(r => [code(r[0]), esc(r[1]), '<code class="pre">' + esc(r[2]) + '</code>']))}</section>
      <section class="ref-sec" data-t="errors decoded error messages"><h3>Every error from the session, decoded</h3><p>Git errors are nearly always specific. Read the first line and the word after "pathspec", and you can usually tell what it thinks you meant.</p>${tbl(['What was typed', 'What Git said', 'What it means', 'Fix', ''], GS.errors.map(r => [code(r.typed), esc(r.said), esc(r.means), code(r.fix), r.try ? `<button type="button" class="mini-btn" data-send="${esc(r.try)}" data-run="1">Try it</button>` : '']))}
        <h4>Messages that look like errors but are not</h4>${tbl(['Message', 'Meaning'], REF.notErr.map(r => [code(r[0]), esc(r[1])]))}</section>
      <section class="ref-sec" data-t="windows powershell traps"><h3>Git on Windows PowerShell: the traps</h3><p>Roughly half of the surprises in a Windows session come from the shell, not from Git.</p>${tbl(['In PowerShell', 'What actually happens', 'Do this instead'], REF.traps.map(r => [code(r[0]), esc(r[1]), esc(r[2])]))}<p class="mini">To see which PowerShell you are using, run <code>$PSVersionTable.PSVersion</code>. Version 5.x writes UTF-16 with <code>></code>. Version 7 and later writes UTF-8.</p></section>
      <section class="ref-sec" data-t="glossary vocabulary terms"><h3>Glossary</h3>${tbl(['Term', 'Meaning'], REF.gloss.map(r => [`<b>${esc(r[0])}</b>`, esc(r[1])]))}</section>
    </div>`;
  },
  mount(el, app) {
    this.el = el;
    const input = $('#ref-q', el); const count = $('[data-ref-count]', el);
    const filter = () => {
      const v = input.value.trim().toLowerCase(); let shown = 0, total = 0;
      $$('.ref-sec', el).forEach(sec => {
        const secHit = !v || (sec.dataset.t || '').includes(v);
        let any = 0;
        $$('tbody tr, .cheat-g, .rules li', sec).forEach(r => { total++; const hit = secHit || r.textContent.toLowerCase().includes(v); r.hidden = !hit; if (hit) { any++; shown++; } });
        sec.hidden = v && !secHit && !any;
      });
      count.textContent = v ? shown + ' of ' + total + ' entries match' : '';
    };
    input.addEventListener('input', filter);
  }
};

/* ================================================================== PRACTICE */
const QUIZ = [
  { q: 'You git add a file and then edit it again. What goes into the next commit?', o: ['The new text you just typed', 'The text you staged', 'Both versions', 'Nothing until you git add again'], a: 1, why: 'The blob was written at add time, so the staged copy is the old text. git status shows the file in both lists until you add again.' },
  { q: 'You delete a file with rm. Does Git know yet?', o: ['Yes, it watches the folder', 'No, the index still lists it', 'Only after a commit'], a: 1, why: 'rm talks to the operating system. git status shows "deleted" under "Changes not staged" until you git add or git rm it.' },
  { q: 'Where does the name main physically live?', o: ['Inside every commit', 'In .git/HEAD', 'In a 41-byte file under .git/refs/heads', 'In the index'], a: 2, why: 'A branch is a text file holding one commit hash. HEAD is a different file that names which branch you are on.' },
  { q: 'Two files have identical text. How many blobs does Git store?', o: ['One', 'Two', 'It depends on the file names'], a: 0, why: 'The blob name is the hash of its content. The tree has two entries, one per file name, both pointing at the same blob.' },
  { q: 'Which is safer: git reset or git restore <file>?', o: ['git reset: it only touches the index', 'git restore <file>: it asks first', 'They are equally safe'], a: 0, why: 'reset un-stages and leaves your files alone. restore <file> overwrites your working copy with Git\'s staged copy, discarding edits Git never saved.' },
  { q: '.gitignore lists *.log, yet app.log (already committed) shows as modified. What fixes it?', o: ['Edit .gitignore harder', 'git rm --cached app.log, then commit', 'git clean -fd'], a: 1, why: '.gitignore only affects files Git is not already tracking. --cached untracks the file and keeps it on disk.' },
  { q: 'What does git branch feature do?', o: ['Copies all your files into a new folder', 'Creates a tiny file with the current commit hash', 'Switches you to a new branch'], a: 1, why: 'Only one 41-byte file is created. HEAD does not move, so you are still on the old branch until you git switch.' },
  { q: 'Why does git commit - m "fix" fail?', o: ['A commit message needs at least two words', 'The space split -m in two, and Git reads the loose words as file paths', 'git commit needs -a'], a: 1, why: 'Three loose words (-, m, fix) gave three failed pathspecs. Type -m as one token.' }
];
P.practice = {
  html() {
    return `<div class="page-head wrap"><p class="eyebrow">Practice</p><h2>Predict first, then check</h2><p class="lede">Do these in pairs. For each one, say the answer out loud before you reveal it, then confirm it in the lab.</p></div>
    <div class="wrap practice">
      <section><h3>Quick check <span class="score" data-score></span></h3><div class="quiz" data-quiz></div></section>
      <section><h3>Ten exercises</h3><ol class="exs">${GS.practice.map((p, i) => `<li class="ex"><div class="ex-q"><span class="ex-n">${i + 1}</span><p>${esc(p.q)}</p></div><div class="ex-a"><button type="button" class="linkbtn" data-ans="${i}" aria-expanded="false">Show the answer</button><p hidden>${esc(p.a)}</p></div></li>`).join('')}</ol>
      <div class="ex-lab"><button type="button" class="btn primary" data-go="lab">Open the lab to try them</button></div></section>
    </div>`;
  },
  mount(el, app) {
    this.el = el;
    const saved = U.store.get('gitlab.quiz.v1', {});
    const box = $('[data-quiz]', el);
    box.innerHTML = QUIZ.map((qz, i) => `<fieldset class="qz" data-i="${i}"><legend>${i + 1}. ${esc(qz.q)}</legend>${qz.o.map((o, j) => `<button type="button" class="qz-o" data-j="${j}">${esc(o)}</button>`).join('')}<p class="qz-why" hidden></p></fieldset>`).join('');
    const paint = () => {
      let right = 0, tried = 0;
      $$('.qz', box).forEach(f => {
        const i = +f.dataset.i; const ans = saved[i];
        $$('.qz-o', f).forEach(b => { const j = +b.dataset.j; b.classList.toggle('picked', ans === j); b.classList.toggle('right', ans != null && j === QUIZ[i].a); b.classList.toggle('wrong', ans === j && j !== QUIZ[i].a); b.disabled = ans != null; });
        const w = $('.qz-why', f); w.hidden = ans == null; if (ans != null) { w.textContent = (ans === QUIZ[i].a ? 'Correct. ' : 'Not quite. ') + QUIZ[i].why; tried++; if (ans === QUIZ[i].a) right++; }
      });
      $('[data-score]', el).textContent = tried ? right + ' of ' + QUIZ.length + ' correct' : '';
    };
    box.addEventListener('click', e => { const b = e.target.closest('.qz-o'); if (!b) return; saved[+b.closest('.qz').dataset.i] = +b.dataset.j; U.store.set('gitlab.quiz.v1', saved); paint(); });
    paint();
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-ans]'); if (!a) return;
      const p = a.nextElementSibling; p.hidden = !p.hidden; a.textContent = p.hidden ? 'Show the answer' : 'Hide the answer'; a.setAttribute('aria-expanded', String(!p.hidden));
    });
  }
};

/* ================================================================== SESSION */
const DEMO = [
  ['ls -a', 'There is no .git yet. Only two ordinary files.'],
  ['git init', 'Now point out the hidden folder.'],
  ['ls -a', ''],
  ['cat .git/HEAD', 'A branch name, not a hash. The branch file does not exist yet.'],
  ['echo "Hello from Git" > hello.txt', 'Create a file the Git way: it is untracked.'],
  ['git status -s', '?? means untracked.'],
  ['git add hello.txt', ''],
  ['find .git/objects -type f', 'One new object: the blob.'],
  ['git ls-files -s', 'The index entry: mode, blob hash, stage 0, path.'],
  ['git commit -m "first"', ''],
  ['find .git/objects -type f', 'Now also a tree and a commit.'],
  ['cat .git/refs/heads/main', 'The branch is a hash in a file.'],
  ['git cat-file -p HEAD', 'commit → tree'],
  ['git cat-file -p HEAD^{tree}', 'tree → blob']
];
const ROOM = [
  ['After git add, you edit the file again. What is in the next commit?', 'The staged version. The blob was written at add time.'],
  ['You delete a file with rm. Does Git know yet?', 'No. The index still lists it.'],
  ['Where does the name main physically live?', 'In a 41-byte file, .git/refs/heads/main.'],
  ['If two files have the same text, how many blobs exist?', 'One.'],
  ['Which is safer: git reset or git restore <file>, and why?', 'reset. It only touches the index.']
];
const FAQ = [
  ['Is Git the same as GitHub?', 'No. Git is the version-control tool that runs on your machine. GitHub is one website that hosts remote copies of Git repositories.'],
  ['Why do we need a staging area?', 'It lets you choose what goes into each commit. You may have edited five files for two different reasons, and you can commit them as two clean commits.'],
  ['Does Git store the differences between versions?', 'No. It stores snapshots and computes differences when asked.'],
  ['Why is the branch called master and not main?', 'It is only a default name. Git itself still creates master unless you set init.defaultBranch, while many hosting sites default to main. Either works. The lab uses main.'],
  ['Can I get back a commit after a bad reset?', 'Usually yes. The commit still exists and git reflog will show its hash. Uncommitted work is a different story.'],
  ['I committed a password. I deleted it in the next commit. Is it safe?', 'No. The earlier commit still contains it. Change the password. Cleaning history needs a dedicated tool and is a separate topic.'],
  ['Why are hashes so long?', 'They are 40 hex characters so that two different contents effectively never collide. You almost never type more than 7.']
];
P.session = {
  html() {
    return `<div class="page-head wrap"><p class="eyebrow">Session</p><h2>Running the 90 minutes</h2><p class="lede">A timer, a demo script that fits the architecture, and the questions to put to the room. The projector switch in the top bar enlarges everything.</p></div>
    <div class="wrap session">
      <section class="s-timer"><div class="timer-card">
        <div class="timer-time" data-time aria-live="off">90:00</div>
        <div class="timer-now" data-now>Ready to start</div>
        <div class="timer-btns"><button type="button" class="btn primary" data-t-start>Start timer</button><button type="button" class="btn" data-t-reset>Reset</button></div>
        <div class="timer-bar"><i data-t-bar></i></div></div>
        <ol class="agenda" data-agenda>${P.AGENDA.map((a, i) => `<li data-i="${i}"><span class="ag-t">${a.range} min</span><div><b>${esc(a.title)}</b><p>${esc(a.what)}</p><span class="mini">${esc(a.where)}</span></div><button type="button" class="mini-btn" data-agenda-go="${i}">Open</button></li>`).join('')}</ol></section>
      <section><h3>Before class</h3><ul class="checklist" data-check>${['Open the Lab page and press Reset lab.', 'Decide whether the identity is already set. Untick it in Options to rehearse the "Author identity unknown" error.', 'Switch on Projector mode.', 'Tell the room it works offline: nothing here needs the internet or a Git install.', 'Ask everyone to open the same page, so each person has their own private repository.', 'Optional, for the Live repo page: double-click start-website.bat in the folder with the site file, then paste the path of the practice folder on the Live repo page.'].map((t, i) => `<li><label><input type="checkbox" data-c="${i}"> ${esc(t)}</label></li>`).join('')}</ul></section>
      <section><h3>A demo script that fits the architecture</h3><p>Doing the same few steps live, with a look inside <code>.git</code> after each, lands the architecture far better than slides. Send each line to the lab terminal and run it.</p>
        <ol class="demo">${DEMO.map(d => `<li><code>${esc(d[0])}</code><span>${esc(d[1])}</span><div><button type="button" class="mini-btn" data-send="${esc(d[0])}">Send</button><button type="button" class="mini-btn" data-send="${esc(d[0])}" data-run="1">Run</button></div></li>`).join('')}</ol>
        <p class="mini">Start from <b>Reset lab</b>. The lab folder already contains index.html and style.css, so the demo's hello.txt shows up next to them.</p></section>
      <section><h3>Questions to ask the room</h3><ul class="room">${ROOM.map((r, i) => `<li><p>${esc(r[0])}</p><button type="button" class="linkbtn" data-room="${i}">Reveal</button><p class="room-a" hidden>${esc(r[1])}</p></li>`).join('')}</ul></section>
      <section><h3>Questions that usually come up</h3><div class="faq">${FAQ.map(f => `<details><summary>${esc(f[0])}</summary><p>${esc(f[1])}</p></details>`).join('')}</div></section>
      <section><h3>Not covered, worth a follow-up</h3><p>Fixing the last commit with <code>git commit --amend</code> (the simulator supports it), <code>git stash</code>, rebasing, tags in depth, and working with a remote. The simulator is local-only on purpose.</p></section>
    </div>`;
  },
  mount(el, app) {
    this.el = el; this.app = app;
    const KEY = 'gitlab.session.v1'; const st = U.store.get(KEY, { checks: {}, left: 5400, running: false });
    this.st = st; this.KEY = KEY; this.total = 5400; if (st.running) st.running = false;
    const render = () => {
      const left = Math.max(0, st.left); const elapsed = this.total - left; const m = Math.floor(left / 60), s = left % 60;
      $('[data-time]', el).textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      $('[data-t-bar]', el).style.width = Math.min(100, elapsed / this.total * 100) + '%';
      const min = elapsed / 60; let cur = -1, acc = 0;
      P.AGENDA.forEach((a, i) => { if (min >= acc && min < acc + a.mins) cur = i; acc += a.mins; });
      $$('.agenda li', el).forEach((li, i) => { li.classList.toggle('now', i === cur && (st.running || elapsed > 0)); li.classList.toggle('past', cur >= 0 ? i < cur : elapsed >= this.total); });
      $('[data-now]', el).textContent = left === 0 ? 'Time is up' : (st.running || elapsed > 0) ? (cur >= 0 ? 'Now: ' + P.AGENDA[cur].title : '') + (st.running ? '' : ' (paused)') : 'Ready to start';
      $('[data-t-start]', el).textContent = st.running ? 'Pause' : (elapsed > 0 ? 'Resume' : 'Start timer');
    };
    this.render = render;
    $('[data-t-start]', el).addEventListener('click', () => {
      st.running = !st.running; clearInterval(this.iv);
      if (st.running) this.iv = setInterval(() => { st.left = Math.max(0, st.left - 1); if (st.left === 0) { st.running = false; clearInterval(this.iv); } render(); U.store.set(KEY, st); }, 1000);
      render(); U.store.set(KEY, st);
    });
    $('[data-t-reset]', el).addEventListener('click', () => { clearInterval(this.iv); st.running = false; st.left = this.total; render(); U.store.set(KEY, st); });
    $$('[data-c]', el).forEach(cb => { cb.checked = !!st.checks[cb.dataset.c]; cb.addEventListener('change', () => { st.checks[cb.dataset.c] = cb.checked; U.store.set(KEY, st); }); });
    el.addEventListener('click', e => {
      const g = e.target.closest('[data-agenda-go]');
      if (g) { const a = P.AGENDA[+g.dataset.agendaGo]; if (a.go[0] === 'lab') app.openLab(a.go[1], false); else app.go(a.go[0], a.go[1]); return; }
      const r = e.target.closest('[data-room]'); if (r) { const p = r.nextElementSibling; p.hidden = !p.hidden; r.textContent = p.hidden ? 'Reveal' : 'Hide'; }
    });
    render();
  }
};
})(GS);
