> Project overview, quick start and troubleshooting: see `../README.md`. This file is the developer notes.

# Git, from the inside out: interactive lab site

One self-contained HTML site (no server, no install, works offline) built from the handout
"Git, from the inside out" and the Integrated Git Lab Exercise.

**Open `../git-from-the-inside-out.html` in any modern browser.**

Pages: Home (live demo), Learn (8 chapters with step-through stories), Lab (15 guided steps + free terminal),
Live repo (watch a REAL folder as you run git in cmd), Reference, Practice, Session (90-minute plan with a timer and demo script).

## How it works
`src/engine.js`  object database (blob / tree / commit / tag), index, refs, diff, merge. Real SHA-1 in Git's object format.
`src/git.js`     git commands with Git's own messages (init, add, commit, log, show, diff, rm, mv, restore, reset, clean,
                 branch, checkout, switch, merge, tag, reflog, config, check-ignore, plus cat-file, ls-files, ls-tree, hash-object,
                 write-tree, commit-tree, update-ref ...).
`src/shell.js`   terminal: tokenizer, pipes, redirects, ls/cat/echo/rm/mv/find, a virtual `.git` you can `cat` and `find`.
`src/lab.js`     sample project, guided steps, observation table, assessment checklist, error decoder, cheat sheet.
`src/ui-*.js`    views (areas, graph, .git explorer, snapshots), stories, pages, router.

## Live repo: watch a real folder
A web page cannot read an arbitrary folder, so a small helper does it:

    start-website.bat                 # double-click: starts the site together with the Live repo helper
    node git-watch.js                 # the same thing from cmd
    node git-watch.js "C:\path\to\folder"    # start already watching a folder

It opens http://localhost:4781 (the same site, already paired). Paste the folder path on the Live repo page, then run
git commands in cmd as usual. The page updates by itself: working directory, index, HEAD snapshot, history graph,
a feed of what changed, and the diff of any file you click.

* Needs Node 18+ and git on the PATH. No packages to install. Without Node, start-website.bat opens the site as a
  plain file: everything works except the real-folder mode.
* Read-only: it only runs `git status`, `ls-files`, `ls-tree`, `log`, `for-each-ref`, `hash-object`, `diff`, `show`, with
  `GIT_OPTIONAL_LOCKS=0`, so it never takes a lock your own git commands could trip over.
* Listens on 127.0.0.1 only. Every request needs the pairing code printed in cmd (built into the page the helper serves).
  The Host header is checked.
* If you open the site file directly instead, enter http://localhost:4781 and the pairing code on the Live repo page.
* The hosted (Artifact) copy cannot reach the helper; its Demo and "Mirror the lab" modes work anywhere.

## Build and test
    node build.js                 # writes ../git-from-the-inside-out.html and dist/artifact.html
    node test/engine.test.js      # git behaviour (hashes match the handout)
    node test/lab.test.js         # all 15 steps complete from their solutions
    node test/stories.test.js     # every scripted story command succeeds
    node test/server.test.js      # the live helper against real git (needs git)
    node test/live.test.js        # simulator vs real git: same three-area rows after every step
