# Git, from the inside out

An interactive website for teaching Git in a skill-lab session. It explains how Git is built (three places your
files live, the `.git` folder, blobs, trees, commits), lets students run the whole workflow in a safe simulated
repository, and can **watch a real folder live while you run `git` in cmd**.

It is built from the handout *"Git, from the inside out"* and the *Integrated Git Lab Exercise*
(init, status, add, commit, log, branch, checkout, merge). Everything runs in the browser. No account, no upload,
and no real repository is touched unless you point the Live page at one.

## Quick start

1. Double-click **`start-website.bat`**. A black window opens and your browser loads the site at
   `http://localhost:4781`. Keep the black window open while you use the site; close it to stop.
2. Click **Start the lab** and follow the 15 steps.

No Node.js? Double-click `start-website.bat` anyway: it opens the site as a plain file. Everything works except
watching a real folder. You can also open **`git-from-the-inside-out.html`** yourself in any modern browser.

> Needs for the Live repo page only: [Node.js](https://nodejs.org) 18 or newer and Git on the PATH.
> `start-website.bat` is for Windows. On macOS or Linux run `node git-watch.js` in this folder.

A hosted copy (private, shared from its page's Share menu) is at
<https://claude.ai/artifact/5ZLB1zr95GEaCkGyiZbAhJ>. It has everything except the real-folder mode, because a
hosted page cannot talk to a program on your computer.

## What is on the site

| Page | What it gives you |
| --- | --- |
| **Home** | A live demo of `add` and `commit` moving files between the three places, a hash playground, the 90-minute plan. |
| **Learn** | Eight chapters from the handout. Six have step-through "stories": real commands on a private repository, narrated, with the pictures changing beside them (Back and Next both work). |
| **Lab** | The guided exercise: a terminal on the left, the machinery on the right (three places, branch-lane history graph, `.git` explorer, object database). 15 steps plus 5 optional "Go further" steps. |
| **Live repo** | Point the site at a real folder and watch it change as you run `git` in cmd. Also has a scripted **Demo** and a **Mirror the lab** mode that need no setup. |
| **Reference** | Cheat sheet, "I want to…" lookup, `git status -s` codes, every error from the session decoded (with *Try it*), Windows PowerShell traps, glossary. A filter box searches all of it. |
| **Practice** | A quick check (8 questions with explanations) and the 10 handout exercises with reveal-the-answer. |
| **Session** | For the instructor: a 90-minute timer with the agenda, a pre-class checklist, the demo script (send each line to the lab terminal), questions for the room, FAQ. |

Top bar: **Dark** switches to a dark look (the site is light by default), **Projector** enlarges all text.

### The lab

Steps: check Git is installed, open the project folder, `git init`, `git status`, `git add .`, first commit,
modify the page, second commit, `git log --oneline`, create a `feature` branch, switch to it, commit on it,
switch back to `main`, `git merge feature`, show the whole story.

Extras: look inside `.git`, make a hash by hand, a real merge commit, resolve a merge conflict, undo safely.

Things that help in a live session:

* Each step lists the commands to type (click to copy into the terminal, or **Run**), what to watch for,
  a "Why it works" note, and a "Predict first" question on some steps.
* **Set up the repository for this step** rebuilds the repo exactly as it should be at the start of any step,
  so a student who is lost can jump back in.
* The project is the HTML/CSS page from the exercise ("My Full Stack Project"). Edit it with `nano index.html`,
  by clicking a file name, or with the one-click edit buttons. **Show page preview** renders it.
* **What just happened** explains each command in plain words and lists the low-level steps Git ran
  (`hash-object -w`, `update-index`, `write-tree`, `commit-tree`, `update-ref`).
* Mistakes are taught, not hidden. `git commit - m "msg"` produces the real pathspec errors, followed by a tip.
* **Observation table** captures each command's output and gives students a box for their own words.
* **Assessment** ticks the skill-assessment checklist from the real repository state (semantic HTML, stylesheet,
  Flexbox, media query, two commits, a feature branch, a merge). **Evidence** produces the commit history and
  command transcript to paste into a submission.
* Options: untick "Git name and email already set" to rehearse the *Author identity unknown* error.

## Live repo: watch a real folder

A web page cannot read an arbitrary folder by itself, so a small helper (`git-watch.js`) does it. It runs
read-only `git` commands on the folder you name and streams the result to the page.

1. Run `start-website.bat` (or `node git-watch.js`, optionally `node git-watch.js "C:\path\to\folder"`).
2. Open the **Live repo** page and paste the folder path. In Explorer: hold Shift, right-click the folder,
   **Copy as path** (the quotes are fine).
3. Work in cmd as usual: `git init`, `git add`, `git commit`, edit files, `git switch`, `git merge`…

What you see, updating on its own:

* **Three places**: working directory, index and last commit side by side. Each file has a colour square, and
  identical content has the same colour, so a file that is edited, staged and committed shows three colours.
  Tags: untracked, edited, deleted, conflict, ignored, new, modified, renamed.
* **Counts and state**: staged, changed-but-not-staged, untracked, conflicts, ignored; branch, HEAD, ahead/behind,
  and merge/rebase in progress.
* **What just changed**: a feed such as "index.html staged (git add)" or "Committed 597588b". The arrows between the
  three places light up to match. **Recent HEAD moves** comes from `git reflog`.
* **Diff**: click any file for its unstaged diff, staged diff, or diff against the last commit.
* **History**: a branch-lane graph. Each branch gets its own row, placed by where each commit was made (Git records
  that in the reflog), so you see a branch fork off, do its work, and join back. A real merge commit shows its two
  parents meeting; a fast-forward merge (which creates no commit) shows as a ◇ where the branch line joins.
  The graph fits its panel: as commits are added the spacing tightens (labels thin out, hashes of HEAD and branch tips
  stay), and it only scrolls when it is truly crowded. Click a commit to see the files it changed.

Safety:

* Read-only. It runs only `rev-parse`, `symbolic-ref`, `status`, `ls-files`, `ls-tree`, `for-each-ref`, `log`,
  `hash-object`, `diff`, `diff-tree` and `show`, with `GIT_OPTIONAL_LOCKS=0`, so it never takes a lock that could
  trip your own `git` commands. It never writes to your repository.
* It listens on `127.0.0.1` only, checks the `Host` header, and every request needs a **pairing code**. The page
  the helper serves already has the code. If you open the site file directly, paste the code printed in cmd.
* Large folders are capped (300 commits, 2000 rows per area, 400 untracked files).

Options: `node git-watch.js [folder] [--port 4781] [--no-open]`. If the port is busy it tries the next ones.

## Files in this folder

| File | Purpose |
| --- | --- |
| `start-website.bat` | One-click launcher (Windows). Starts the helper and opens the site; falls back to the plain file without Node. |
| `git-from-the-inside-out.html` | The whole website in one offline file (about 420 KB). |
| `git-watch.js` | The Live repo helper. No dependencies. |
| `git-simulator/` | Source code, build script and tests. See `git-simulator/README.md`. |

Keep the first three together: the launcher and the helper look for the website file next to themselves.

## How faithful is the simulator?

* Object ids are **real SHA-1** in Git's object format. Blob and tree hashes match what real Git prints for the
  same content (`echo "Hello from Git" | git hash-object --stdin` gives `c14b6d1…`, as in the handout).
  Commit hashes differ from real Git's because of timestamps and author.
* Messages and errors follow Git 2.53 output (`status`, `commit`, `log`, `merge`, `checkout` and so on).
* Commands: `init status add commit log show diff rm mv restore reset clean branch checkout switch merge tag
  reflog config check-ignore ls-files ls-tree cat-file hash-object rev-parse write-tree commit-tree update-index
  update-ref symbolic-ref`. Also `.gitignore`, rename detection, fast-forward and three-way merges with conflicts,
  detached HEAD, `commit --amend`, and the editor for `git commit` without `-m`.
* Shell: `ls cat echo printf touch rm mkdir mv cp find sha1sum`, pipes, `>` and `>>`, `&&`, Tab completion,
  history, `nano`/`code`/`vim` (opens an editor box), and a virtual `.git` you can `cat` and `find`.
* Not simulated: `clone fetch pull push remote stash rebase cherry-pick revert bisect blame`. They print a short
  "local only" message. The default branch is `main` (the handout's session used `master`).
* It was checked against real Git: the same 19-step sequence (init, add, commit, edit, rename, branch, merge,
  restore…) was run in both, and the three-area rows were compared after every step.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Live repo says the helper is not running | Run `start-website.bat` and use the page it opens. The hosted copy cannot reach the helper. |
| "Pairing code is not right" | Copy the code from the black window. Using the page the helper opens avoids this. |
| "Connection lost. Reconnecting…" after you restarted the helper | A new pairing code is made at every start. Reload the page the helper opens. |
| Folder shows "not a repository yet" | Run `git init` there. The page picks it up by itself. |
| "Git refuses this folder… safe.directory" | Run the `git config --global --add safe.directory …` command the page shows. |
| `start-website.bat` shows an error | Check that it sits next to `git-watch.js` and `git-from-the-inside-out.html`, and that Node and Git are on the PATH (`node --version`, `git --version` in cmd). |
| Port 4781 is busy | The helper uses the next free port and prints the address. |
| Lab progress disappeared | Progress is stored in the browser. A different browser, a private window or cleared site data starts fresh. |

## Development

Source is in `git-simulator/src` (plain JavaScript and CSS, no dependencies). Edit, then rebuild and test:

```
cd git-simulator
node build.js                # rewrites ../git-from-the-inside-out.html, ../git-watch.js, ../start-website.bat
node test/engine.test.js     # git behaviour, hashes from the handout        (166 checks)
node test/lab.test.js        # all 15 steps complete from their solutions     (52)
node test/stories.test.js    # every scripted story command succeeds          (60)
node test/server.test.js     # the live helper against real git               (40)
node test/live.test.js       # simulator vs real git, step by step            (137)
node test/graph.test.js      # branch lanes, fast-forward and real merges     (16)
```

The server and live tests create temporary repositories with the real `git` on your PATH.

## Credits

Teaching content follows the handout *"Git, from the inside out"* (Git 2.53 on Windows PowerShell) and the
Department of Computer Science & Engineering lab exercise. Fonts: Bricolage Grotesque, IBM Plex Sans and
JetBrains Mono from Google Fonts when online; system fonts are used offline.
