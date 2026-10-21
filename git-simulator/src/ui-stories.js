/* Site: stories. A story is a short scripted run of real commands on its own
   private workspace, narrated step by step, with live views beside it. */
(function (GS) {
'use strict';
const U = GS.ui; const { esc, ansi } = U;

const objPath = (type, nth) => ws => {
  const g = ws.sim.s.git; if (!g) return null;
  const hs = Object.keys(g.objects).filter(h => g.objects[h].type === type);
  const h = hs[nth == null ? hs.length - 1 : nth]; return h ? { kind: 'file', path: '.git/objects/' + h.slice(0, 2) + '/' + h.slice(2) } : null;
};
const file = p => () => ({ kind: 'file', path: p });

const STORIES = {};

STORIES.areas = {
  title: 'One file, three places', views: ['areas'], lab: 'add',
  files: { 'hello.txt': 'Hello from Git\n', 'notes.txt': 'buy milk\n' },
  steps: [
    { t: 'Two files, no Git yet', say: 'Open a folder and you see your files. That is the <b>working directory</b>. Git is not watching anything, so the other two places do not exist.', run: [] },
    { t: 'git init creates the repository', say: 'A hidden <code>.git</code> folder appears next to your files. <b>That folder is the repository.</b> Your files were not touched.', run: ['git init'] },
    { t: 'Git can see the files but has never saved them', say: '<code>??</code> means <i>untracked</i>. Git knows the files exist and is waiting to be told which ones belong in the next snapshot.', run: ['git status -s'] },
    { t: 'git add copies a file into the index', say: 'The content of <code>hello.txt</code> was stored as a <b>blob</b> and its path was written into the <b>index</b>. Notice the coloured squares: the same content has the same colour in every place.', run: ['git add hello.txt'] },
    { t: 'Now keep typing', say: 'You add a second line to the file. The working copy now differs from the staged copy, so its hash (and colour) changed. <b>The index still holds the old text.</b>', run: [{ write: ['hello.txt', 'Hello from Git\nA second line\n'] }] },
    { t: 'One file, two versions', say: '<code>AM</code> reads as: <b>A</b>dded in the index, then <b>M</b>odified on disk. The left letter compares index with the last commit, the right letter compares disk with the index.', run: ['git status -s'] },
    { t: 'Stage it again', say: 'Running <code>git add</code> again writes the new text as a second blob and updates the index entry. Staging is a snapshot of the file <i>at the moment you add</i>.', run: ['git add hello.txt'] },
    { t: 'git commit seals the index', say: 'The index became a tree, and a commit pointed at that tree. The Repository column now shows the snapshot. <code>notes.txt</code> was never added, so it is not in it.', run: ['git commit -m "Add hello"'] },
    { t: 'All three agree', say: '<i>Working tree clean</i> means working directory, index and last commit are identical. The leftover <code>notes.txt</code> is still untracked: Git only saves what you add.', run: ['git status'] }
  ]
};

STORIES.inside = {
  title: 'Open the .git folder', views: ['tree'], lab: 'init',
  files: { 'hello.txt': 'Hello from Git\n' },
  steps: [
    { t: 'An ordinary folder', say: 'There is nothing hidden yet. Every Git repository starts as a normal folder with normal files.', run: [] },
    { t: 'git init', say: 'Git creates <code>.git</code>. <code>HEAD</code> says <code>ref: refs/heads/main</code>, but the branch file it points to does not exist yet. That is exactly why <code>git status</code> says <i>No commits yet</i>.', run: ['git init'], sel: file('.git/HEAD') },
    { t: 'git add writes a blob', say: 'One new file appeared under <code>objects/</code>: the blob. Its name is the SHA-1 of its content, split as <code>c1/4b6d18…</code> (two characters of folder, 38 of file). The <code>index</code> file also appeared.', run: ['git add hello.txt'], sel: objPath('blob') },
    { t: 'git commit writes a tree and a commit', say: 'Two more objects: the <b>tree</b> (the folder listing) and the <b>commit</b>. And <code>refs/heads/main</code> was created, holding the commit id. COMMIT_EDITMSG and the reflog recorded what happened.', run: ['git commit -m "first"'], sel: objPath('commit') },
    { t: 'A branch is a file', say: 'Read it. Forty characters and a newline: <b>the whole of the word "main"</b>. Committing just rewrites this file.', run: ['cat .git/refs/heads/main'], sel: file('.git/refs/heads/main') },
    { t: 'A commit is a few lines of text', say: 'A tree, optional parents, an author, a committer and a message. Click the tree hash to follow it.', run: ['git cat-file -p HEAD'], sel: objPath('commit') },
    { t: 'A tree lists blobs by name', say: 'File names live in the tree, not in the blob. Click the blob hash to read the file content back out of the database.', run: ['git cat-file -p HEAD^{tree}'], sel: objPath('tree') }
  ]
};

STORIES.objects = {
  title: 'Snapshots, not edits', views: ['snap', 'objects'], lab: 'inside',
  files: { 'hello.txt': 'Hello from Git\n', 'hello1.txt': 'Another file\n', 'copy.txt': 'Hello from Git\n' },
  steps: [
    { t: 'Stage the first file', say: 'One blob is stored. Its id is the hash of <code>blob 15</code> + a zero byte + <code>Hello from Git</code> + newline.', run: ['git init', 'git add hello.txt'] },
    { t: 'Stage a copy with the same text', say: '<code>copy.txt</code> has identical content, so it has the identical hash. <b>The object count did not change.</b> Two files, one stored blob.', run: ['git add copy.txt'] },
    { t: 'Stage the third file and commit', say: 'Read the snapshot on the left: the tree has three entries, two of them pointing at the same blob (same colour).', run: ['git add hello1.txt', 'git commit -m "Initial commit"'] },
    { t: 'Edit one file, commit again', say: 'Only <code>hello.txt</code> changed. The second snapshot is a complete picture too, yet <code>copy.txt</code> and <code>hello1.txt</code> point at the blobs they already had.', run: [{ write: ['hello.txt', 'Hello from Git\nedited\n'] }, 'git commit -am "Edit hello"'] },
    { t: 'What did that cost?', say: 'One new blob, one new tree and one new commit. Unchanged files are pointed at, not copied. That is why Git can keep thousands of snapshots cheaply, and why a rename costs almost nothing.', run: ['git log --oneline'] }
  ]
};

STORIES.branches = {
  title: 'Branches, HEAD and a merge', views: ['areas', 'graph', 'refs'], lab: 'branch',
  files: { 'index.html': '<h1>Home</h1>\n', 'style.css': 'body { margin: 0; }\n' },
  steps: [
    { t: 'Two commits on main', say: 'A normal start: <code>HEAD</code> points at <code>main</code>, and <code>main</code> points at the newest commit.', run: ['git init', 'git add .', 'git commit -m "Home page"', { write: ['index.html', '<h1>Home</h1>\n<p>Welcome</p>\n'] }, 'git commit -am "Add welcome text"'] },
    { t: 'git branch dev', say: 'This created <b>one tiny file</b>, <code>.git/refs/heads/dev</code>, containing the same hash as main. Nothing was copied, and <code>HEAD</code> did not move.', run: ['git branch dev'] },
    { t: 'git switch dev', say: '<code>HEAD</code> now says <code>ref: refs/heads/dev</code>. The files are unchanged because both branches are on the same commit.', run: ['git switch dev'] },
    { t: 'Commit on dev', say: 'The commit moved <b>only dev</b>, the branch HEAD is attached to. <code>main</code> stays where it was.', run: [{ write: ['style.css', 'body { margin: 0; color: navy; }\n'] }, 'git commit -am "Navy text"'] },
    { t: 'Back to main', say: 'Look at <code>style.css</code> in the working directory: the navy rule disappeared. Git rewrote the file to match <code>main</code>. The work is safe on <code>dev</code>.', run: ['git switch main'] },
    { t: 'Main moves on too', say: 'Now both branches have a commit the other lacks. The history has <b>diverged</b>.', run: [{ write: ['index.html', '<h1>Home</h1>\n<p>Welcome</p>\n<p>Contact us</p>\n'] }, 'git commit -am "Add contact line"'] },
    { t: 'git merge dev', say: 'Git compared both tips with their common ancestor, combined the changes, and wrote a <b>merge commit with two parents</b>. If main had not moved on, it would only have slid the label forward (a fast-forward).', run: ['git merge dev'] }
  ]
};

STORIES.undo = {
  title: 'Taking things back', views: ['areas'], lab: 'undo',
  files: { 'a.txt': 'keep me\n' },
  steps: [
    { t: 'A committed file', say: 'The starting point: <code>a.txt</code> is committed and clean.', run: ['git init', 'git add .', 'git commit -m "Add a.txt"'] },
    { t: 'Edit and stage', say: 'You change the file and stage it. The staged copy and the disk copy are the same text.', run: [{ write: ['a.txt', 'keep me\nplus an edit\n'] }, 'git add a.txt'] },
    { t: 'git restore --staged: safe', say: 'This copied the <i>last commit</i> back into the <b>index only</b>. Your edit is still on disk. Nothing was lost, so this group of commands is safe.', run: ['git restore --staged a.txt'] },
    { t: 'git restore: destructive', say: 'This copies the <i>index</i> over your <b>working file</b>. The edit was never committed or staged, so <b>Git has no copy and it is gone for good</b>. Ask "was this ever committed?" before pressing Enter.', run: ['git restore a.txt'] },
    { t: 'Committed work can come back', say: 'Delete the file and bring it back from history. Anything that reached a commit is safe because blobs never change.', run: [{ write: ['b.txt', 'second\n'] }, 'git add b.txt', 'git commit -m "Add b.txt"', 'git rm b.txt', 'git commit -m "Remove b.txt"', 'git restore --source=HEAD~1 b.txt'] }
  ]
};

STORIES.ignore = {
  title: 'The .gitignore trap', views: ['areas'], lab: 'status',
  files: { 'app.js': 'console.log(1)\n', 'secret.env': 'KEY=12345\n' },
  steps: [
    { t: 'Add everything (the mistake)', say: '<code>git add .</code> staged <code>secret.env</code> too. It is easy to do when <code>.gitignore</code> does not exist yet.', run: ['git init', 'git add .', 'git commit -m "Add everything"'] },
    { t: 'Now write the ignore rule', say: 'You add <code>secret.env</code> to <code>.gitignore</code>. The file still shows as tracked: <b>.gitignore only affects files Git is not already tracking.</b>', run: [{ write: ['.gitignore', 'secret.env\n'] }, { write: ['secret.env', 'KEY=67890\n'] }, 'git status -s'] },
    { t: 'Tell Git to forget the file', say: '<code>--cached</code> removes it from the index only. The file stays on disk, and from the next commit on, the ignore rule works.', run: ['git rm --cached secret.env', 'git add .gitignore', 'git commit -m "Stop tracking secret.env"', 'git status'] },
    { t: 'But the history remembers', say: 'The old commit still has the key. Removing a file does not rewrite the past. If it was a real secret, change it; cleaning history needs a dedicated tool.', run: ['git show HEAD~1:secret.env'] }
  ]
};

/* ------------------------------------------------------------------ player */
class StoryPlayer {
  constructor(root, key, o = {}) {
    this.def = STORIES[key]; this.key = key; this.root = root; this.o = o; this.k = 0;
    this.ws = new U.Workspace({ files: this.def.files });
    root.classList.add('story');
    root.innerHTML = `<div class="story-narr">
        <div class="story-top"><span class="story-count" data-c></span><span class="story-name">${esc(this.def.title)}</span></div>
        <h4 data-t></h4><p class="story-say" data-s></p>
        <div class="story-term" data-term aria-live="polite"></div>
        <div class="story-ctl">
          <button type="button" class="btn" data-back>Back</button>
          <button type="button" class="btn primary" data-next>Next</button>
          <span class="story-dots" data-dots></span>
          ${o.openLab ? `<button type="button" class="btn ghost" data-lab>Try it in the lab</button>` : ''}
        </div></div>
      <div class="story-vis" data-vis></div>`;
    const vis = U.$('[data-vis]', root);
    const mk = (cls, label) => { const d = document.createElement('div'); d.className = 'sv sv-' + cls; d.innerHTML = `<div class="sv-l">${label}</div><div class="sv-b"></div>`; vis.appendChild(d); return U.$('.sv-b', d); };
    this.views = {};
    for (const v of this.def.views) {
      if (v === 'areas') this.views.areas = new U.AreasView(mk('areas', 'The three places'), this.ws, { caption: false });
      if (v === 'graph') this.views.graph = new U.GraphView(mk('graph', 'History'), this.ws, { detail: false });
      if (v === 'refs') this.views.refs = new U.RefsView(mk('refs', 'Branch files and HEAD'), this.ws);
      if (v === 'tree') this.views.tree = new U.InspectView(mk('tree', 'The .git folder (click anything to read it)'), this.ws, { mode: 'git' });
      if (v === 'objects') this.views.objects = new U.InspectView(mk('objects', 'Object database'), this.ws, { mode: 'objects' });
      if (v === 'snap') this.views.snap = new U.SnapshotView(mk('snap', 'Snapshots: commit → tree → blobs'), this.ws, { max: 3 });
    }
    root.addEventListener('click', e => {
      if (e.target.closest('[data-next]')) this.next();
      else if (e.target.closest('[data-back]')) this.go(this.k - 1);
      else if (e.target.closest('[data-lab]')) o.openLab(this.def.lab);
      else { const d = e.target.closest('[data-dot]'); if (d) this.go(+d.dataset.dot); }
    });
    this.go(0);
  }
  runItems(items, log) {
    for (const it of items) {
      if (typeof it === 'string') { const r = this.ws.run(it); if (log) log.push({ cmd: it, html: ansi(r.lines), ok: r.ok }); }
      else if (it.write) { this.ws.write(it.write[0], it.write[1]); if (log) log.push({ cmd: '# edit ' + it.write[0], html: '', ok: true, edit: true }); }
      else if (it.edit) { this.ws.edit(it.edit); }
    }
  }
  go(k) {
    k = Math.max(0, Math.min(this.def.steps.length - 1, k));
    if (k === this.k + 1 && this.k >= 0 && this.started) { this.k = k; this.play(k, true); return; }
    // replay from scratch, quietly, up to k-1, then play step k with animation
    this.ws.quiet++;
    this.ws.reset();
    for (let i = 0; i < k; i++) this.runItems(this.def.steps[i].run, null);
    this.ws.quiet--;
    this.ws.emit(null, 'reset');
    this.k = k; this.started = true;
    this.play(k, true);
  }
  next() { if (this.k >= this.def.steps.length - 1) this.go(0); else this.go(this.k + 1); }
  play(k, animate) {
    const st = this.def.steps[k]; const log = [];
    this.runItems(st.run, log);
    if (st.sel) { const s = st.sel(this.ws); const v = this.views.tree || this.views.objects; if (s && this.views.tree) this.views.tree.select(s); }
    U.$('[data-c]', this.root).textContent = 'Step ' + (k + 1) + ' of ' + this.def.steps.length;
    U.$('[data-t]', this.root).textContent = st.t;
    U.$('[data-s]', this.root).innerHTML = st.say;
    U.$('[data-term]', this.root).innerHTML = log.length ? log.map(l => `<div class="st-cmd"><span class="st-p">$</span> ${esc(l.cmd)}</div>${l.html ? `<pre class="st-out">${l.html}</pre>` : ''}`).join('') : '<div class="st-cmd dim">Nothing to run. Look at the picture.</div>';
    U.$('[data-back]', this.root).disabled = k === 0;
    U.$('[data-next]', this.root).textContent = k === this.def.steps.length - 1 ? 'Replay' : 'Next';
    U.$('[data-dots]', this.root).innerHTML = this.def.steps.map((_, i) => `<button type="button" data-dot="${i}" class="${i === k ? 'on' : i < k ? 'past' : ''}" aria-label="Go to step ${i + 1}"></button>`).join('');
  }
}
GS.ui.StoryPlayer = StoryPlayer;
GS.ui.STORIES = STORIES;
})(GS);
