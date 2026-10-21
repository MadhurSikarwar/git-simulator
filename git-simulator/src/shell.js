/* Git Simulator: terminal. Tokenizer, a handful of shell commands, the
   virtual .git folder (so `cat .git/HEAD` and `find .git/objects` work),
   and dispatch to the git commands. No DOM access. */
(function (GS) {
'use strict';
const { A, paint, GitError, stripAnsi, short, normPath, utf8, gitDate } = GS;

/* ---------------------------------------------------------------- tokenizer */
function tokenize(line) {
  const toks = []; let cur = '', quoted = false, has = false, i = 0;
  const push = () => { if (has) toks.push({ s: cur, q: quoted }); cur = ''; quoted = false; has = false; };
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { push(); i++; continue; }
    if (ch === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) throw new Error("bash: unexpected EOF while looking for matching `''");
      cur += line.slice(i + 1, j); quoted = true; has = true; i = j + 1; continue;
    }
    if (ch === '"') {
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) { cur += line[i + 1]; i += 2; } else cur += line[i++];
      }
      if (i >= line.length) throw new Error('bash: unexpected EOF while looking for matching `"\'');
      i++; quoted = true; has = true; continue;
    }
    if (ch === '&' && line[i + 1] === '&') { push(); toks.push({ op: '&&' }); i += 2; continue; }
    if (ch === ';') { push(); toks.push({ op: ';' }); i++; continue; }
    if (ch === '|') { push(); toks.push({ op: '|' }); i++; continue; }
    if (ch === '>') { push(); if (line[i + 1] === '>') { toks.push({ op: '>>' }); i += 2; } else { toks.push({ op: '>' }); i++; } continue; }
    cur += ch; has = true; i++;
  }
  push();
  return toks;
}
GS.tokenize = tokenize;

/* ---------------------------------------------------------------- virtual .git */
function gitVfs(sim) {
  const g = sim.s.git; const f = {}; const dirs = new Set();
  if (!g) return { files: f, dirs };
  ['.git', '.git/hooks', '.git/info', '.git/logs', '.git/objects', '.git/objects/info', '.git/objects/pack', '.git/refs', '.git/refs/heads', '.git/refs/tags'].forEach(d => dirs.add(d));
  f['.git/HEAD'] = { c: (g.head.ref ? 'ref: ' + g.head.ref : g.head.hash) + '\n', note: 'which branch (or commit) you are on' };
  const cfg = ['[core]', '\trepositoryformatversion = 0', '\tfilemode = false', '\tbare = false', '\tlogallrefupdates = true', '\tignorecase = true'];
  const local = Object.entries(g.config);
  if (local.length) { const byS = {}; for (const [k, v] of local) { const [s, n] = k.split('.'); (byS[s] = byS[s] || []).push('\t' + n + ' = ' + v); } for (const [s, l] of Object.entries(byS)) cfg.push('[' + s + ']', ...l); }
  f['.git/config'] = { c: cfg.join('\n') + '\n', note: 'settings for this repo' };
  f['.git/description'] = { c: "Unnamed repository; edit this file 'description' to name the repository.\n", note: 'only used by GitWeb' };
  f['.git/info/exclude'] = { c: "# git ls-files --others --exclude-from=.git/info/exclude\n# Lines that start with '#' are comments.\n", note: 'a private .gitignore' };
  if (g.editMsg != null) f['.git/COMMIT_EDITMSG'] = { c: g.editMsg.replace(/\n*$/, '\n'), note: 'the last commit message' };
  if (Object.keys(g.index).length || Object.keys(g.conflicts || {}).length) f['.git/index'] = { bin: '(binary file) Read it with: git ls-files -s', note: 'the staging area (binary)' };
  if (g.reflog.length) f['.git/logs/HEAD'] = { c: g.reflog.map(r => (r.old || '0'.repeat(40)) + ' ' + r.hash + ' ' + (sim.config('user.name') || 'you') + ' <' + (sim.config('user.email') || '') + '> ' + r.ts + ' ' + GS.tzString(sim.tz) + '\t' + r.msg).join('\n') + '\n', note: 'the reflog: where HEAD has been' };
  if (g.mergeHead) { f['.git/MERGE_HEAD'] = { c: g.mergeHead + '\n', note: 'the commit being merged in' }; f['.git/MERGE_MSG'] = { c: (g.mergeMsg || '') + '\n' }; }
  for (const [ref, h] of Object.entries(g.refs)) {
    f['.git/' + ref] = { c: h + '\n', note: ref.startsWith('refs/tags/') ? 'a tag: one commit hash' : 'a branch: one commit hash' };
    const parts = ref.split('/'); for (let i = 1; i < parts.length; i++) dirs.add('.git/' + parts.slice(0, i).join('/'));
  }
  for (const [h, ob] of Object.entries(g.objects)) {
    const p = '.git/objects/' + h.slice(0, 2) + '/' + h.slice(2);
    f[p] = { bin: '(zlib-compressed binary) Read it with: git cat-file -p ' + short(h), obj: h, type: ob.type };
    dirs.add('.git/objects/' + h.slice(0, 2));
  }
  return { files: f, dirs };
}
GS.gitVfs = gitVfs;

function fsView(sim) {
  const files = {}, dirs = new Set(sim.s.dirs || []);
  for (const [p, c] of Object.entries(sim.s.fs)) {
    files[p] = { c };
    const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const gv = gitVfs(sim);
  Object.assign(files, gv.files); gv.dirs.forEach(d => dirs.add(d));
  for (const d of [...dirs]) { const parts = d.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
  return { files, dirs };
}
GS.fsView = fsView;

/* ---------------------------------------------------------------- helpers */
function lev(a, b) {
  const m = a.length, n = b.length; const d = [];
  for (let i = 0; i <= m; i++) { d.push([i]); }
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const TIPS = [
  [/pathspec '-' did not match/, "The space split -m into two words ('-' and 'm'). Git treats leftover words as file paths, so it complains about each one. Type -m as ONE token: git commit -m \"message\"."],
  [/is not a git command/, 'That is a typo. Git suggests the nearest real command; try it, or look in the Cheat sheet tab.'],
  [/not removing '.*' recursively without -r/, 'A directory needs -r as a guard against deleting a whole tree by accident: git rm --cached -r <folder>.'],
  [/pathspec '.*' did not match any file\(s\) known to git/, 'That path is in neither the last commit nor the index. It may be untracked, already unstaged, or misspelled. Run git status -s and look at the left-hand letters.'],
  [/pathspec '.*' did not match any files/, 'Nothing matched that name. Check the spelling, and run ls to see what is really in the folder.'],
  [/you must specify path\(s\) to restore/, 'restore overwrites files, so it wants explicit targets: git restore <path>. To un-stage everything use git reset.'],
  [/clean\.requireForce/, 'clean deletes files Git has never saved, so it refuses without -f. Preview first with git clean -nd, then run git clean -fd.'],
  [/ambiguous argument ':'/, 'No spaces around the colon. The form is commit:path with no gaps, e.g. git show HEAD~1:.gitignore.'],
  [/usage: git ls-tree/, 'ls-tree needs a commit or tree to list, e.g. git ls-tree HEAD.'],
  [/Author identity unknown/, 'Git stamps your name and email into every commit. Set them once with the two git config --global lines shown above, then repeat the commit.'],
  [/not a git repository/, 'This folder has no .git directory yet. Run git init first.'],
  [/would be overwritten by checkout/, 'Git refuses to switch because the other branch has a different version of a file you have unsaved changes in. Commit them first (git add + git commit), or throw them away with git restore <file>.'],
  [/would be overwritten by merge/, 'You have uncommitted changes in a file the merge wants to change. Commit or restore them first, then merge again.'],
  [/ambiguous argument '.*': unknown revision/, 'Git could not turn that word into a commit, branch or file. Check the spelling, or look at git log --oneline and git branch.'],
  [/is not a valid branch name/, 'Branch names cannot contain spaces or characters like ~ ^ : ? * [.'],
  [/a branch named '.*' already exists/, 'That branch name is taken. Use git switch <name> to move to it, or choose another name.'],
  [/Committing is not possible because you have unmerged files/, 'The merge left conflict markers in your files. Open each file, keep what you want, delete the <<<<<<< ======= >>>>>>> lines, then git add the file and git commit.'],
  [/There is no merge to abort/, 'You are not in the middle of a merge, so there is nothing to abort.'],
  [/Nothing specified, nothing added/, 'git add needs to know what to stage. Use git add <file>, or git add . for everything (check .gitignore first).'],
  [/changes staged in the index|local modifications/, 'git rm protects work that is not saved in a commit. Use --cached to keep the file on disk, or -f if you really want it gone.'],
  [/The following paths are ignored/, '.gitignore is hiding that path on purpose. git add -f would override it, but think first: ignored files are usually build output or secrets.'],
  [/not fully merged/, 'That branch has commits that are not on your current branch. Merge it first, or use git branch -D if you really want to discard it.']
];
function tipFor(msg) { for (const [re, t] of TIPS) if (re.test(msg)) return t; return null; }

const SHELL_CMDS = ['ls', 'cat', 'echo', 'printf', 'touch', 'rm', 'mkdir', 'mv', 'cp', 'pwd', 'clear', 'cd', 'nano', 'vim', 'vi', 'code', 'notepad', 'find', 'sha1sum', 'whoami', 'date', 'help', 'git', 'tree', 'wc', 'head'];
const ALIASES = { dir: 'ls', ll: 'ls', gci: 'ls', 'get-childitem': 'ls', type: 'cat', gc: 'cat', 'get-content': 'cat', del: 'rm', 'remove-item': 'rm', 'rename-item': 'mv', 'move-item': 'mv', cls: 'clear', ni: 'touch', 'new-item': 'touch', md: 'mkdir', copy: 'cp', 'copy-item': 'cp', edit: 'nano', emacs: 'nano', pico: 'nano' };

/* ---------------------------------------------------------------- Terminal */
class Terminal {
  constructor(sim) { this.sim = sim; this.log = []; this.history = []; this.r = null; }

  prompt() {
    const sim = this.sim; let branch = '';
    if (sim.s.git) {
      const g = sim.s.git;
      branch = g.head.ref ? sim.branchName() : short(g.head.hash || '') || 'HEAD';
      if (g.mergeHead) branch += '|MERGING';
      if (!g.head.ref) branch = '(' + (short(g.head.hash) || 'HEAD') + '...)';
    }
    return { user: 'student@lab', shell: 'MINGW64', path: '~/my-project', branch };
  }

  newResult(cmd) { return { cmd, lines: '', ok: true, ops: [], explain: '', flow: [], tip: null, editor: null, clear: false, sub: null }; }

  run(line) {
    const sim = this.sim; const raw = line;
    const r = this.newResult(raw);
    this.r = r; sim.ops = [];
    const trimmed = line.trim();
    if (!trimmed) { return r; }
    let toks;
    try { toks = tokenize(trimmed); } catch (e) { r.lines = e.message; r.ok = false; return this.finish(r); }
    const seqs = []; let cur = [];
    for (const t of toks) { if (t.op === ';' || t.op === '&&') { seqs.push({ toks: cur, join: t.op }); cur = []; } else cur.push(t); }
    seqs.push({ toks: cur, join: null });
    const outs = []; let prevJoin = null; let lastOk = true;
    for (const sq of seqs) {
      if (prevJoin === '&&' && !lastOk) break;
      const res = this.runPipeline(sq.toks, r);
      if (res.raw) outs.push(res.raw === '\n' ? '' : res.raw.replace(/\n$/, ''));
      lastOk = res.ok; prevJoin = sq.join;
      if (r.editor) break;
    }
    r.lines = outs.join('\n');
    r.ok = lastOk;
    return this.finish(r);
  }

  finish(r) {
    r.ops = this.sim.ops.slice();
    if (!r.ok && !r.tip) r.tip = tipFor(stripAnsi(r.lines));
    if (r.ok && /nothing to commit|nothing added to commit|no changes added to commit/.test(r.lines) && r.cmd.includes('commit')) r.tip = 'Nothing is staged. Edit a file, git add it, then commit. (git status shows where each file stands.)';
    this.log.push({ cmd: r.cmd, out: stripAnsi(r.lines), raw: r.lines, ok: r.ok, sub: r.sub });
    return r;
  }

  /* called by the UI after the editor modal is saved */
  finishEditor(res, text) {
    const sim = this.sim; const r = this.newResult(res.cmd + ' (editor saved)');
    this.r = r; sim.ops = [];
    r.sub = res.sub;
    try { const out = res.editor.done(text); r.lines = out || ''; r.ok = true; }
    catch (e) { if (e instanceof GitError) { r.lines = e.message; r.ok = false; if (e.code && !r.tip) r.tip = tipFor(e.message); } else throw e; }
    // carry over metadata set by the git command during done()
    r.flow = r.flow.length ? r.flow : (res.flow || []);
    r.explain = r.explain || res.explain || '';
    r.ops = sim.ops.slice();
    if (!r.ok && !r.tip) r.tip = tipFor(r.lines);
    this.log.push({ cmd: r.cmd, out: stripAnsi(r.lines), raw: r.lines, ok: r.ok, sub: r.sub });
    return r;
  }

  runPipeline(toks, r) {
    const stages = []; let cur = [];
    for (const t of toks) { if (t.op === '|') { stages.push(cur); cur = []; } else cur.push(t); }
    stages.push(cur);
    let stdin = null; let res = { raw: '', ok: true };
    for (const st of stages) {
      // redirects
      let redir = null; const args = [];
      for (let i = 0; i < st.length; i++) {
        const t = st[i];
        if (t.op === '>' || t.op === '>>') { const target = st[i + 1]; if (!target || target.op) return { raw: "bash: syntax error near unexpected token `newline'", ok: false }; redir = { mode: t.op, file: normPath(target.s) }; i++; }
        else if (t.op) return { raw: "bash: syntax error near unexpected token `" + t.op + "'", ok: false };
        else args.push(t);
      }
      if (!args.length) { if (redir) { this.writeFile(redir.file, '', redir.mode); } continue; }
      res = this.exec(args, stdin, r);
      if (redir) {
        const text = stripAnsi(res.raw);
        try { this.writeFile(redir.file, text, redir.mode); res = { raw: '', ok: res.ok }; }
        catch (e) { res = { raw: e.message, ok: false }; }
      }
      stdin = stripAnsi(res.raw);
    }
    return res;
  }

  writeFile(path, text, mode) {
    if (path.startsWith('.git/') || path === '.git') throw new Error('bash: ' + path + ': Permission denied');
    const fs = this.sim.s.fs;
    fs[path] = mode === '>>' ? (fs[path] || '') + text : text;
  }

  expandGlobs(args) {
    const out = [];
    for (const a of args) {
      if (!a.q && /[*?]/.test(a.s)) {
        const m = GS.specMatcher(a.s);
        const hits = Object.keys(this.sim.s.fs).filter(m).sort();
        if (hits.length) { out.push(...hits); continue; }
      }
      out.push(a.s);
    }
    return out;
  }

  exec(args, stdin, r) {
    let name = args[0].s; const lower = name.toLowerCase();
    if (ALIASES[lower]) name = ALIASES[lower]; else name = lower === name ? name : name;
    if (name === 'git') return this.runGit(args.slice(1).map(a => a.s), stdin, r);
    const argv = this.expandGlobs(args.slice(1));
    const sim = this.sim;
    const ok = raw => ({ raw, ok: true }), bad = raw => ({ raw, ok: false });
    const nl = s => (s === '' ? '' : s + '\n');
    switch (name) {
      case 'echo': {
        let a = argv.slice(), noNl = false, esc = false;
        while (a[0] === '-n' || a[0] === '-e') { if (a[0] === '-n') noNl = true; else esc = true; a.shift(); }
        let s = a.join(' ');
        if (esc) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        return ok(s + (noNl ? '' : '\n'));
      }
      case 'printf': {
        if (!argv.length) return bad('printf: usage: printf format [arguments]');
        let fmt = argv[0]; const rest = argv.slice(1); let k = 0;
        fmt = fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\0/g, '\0').replace(/\\\\/g, '\\');
        fmt = fmt.replace(/%s/g, () => (rest[k++] || ''));
        return ok(fmt);
      }
      case 'sha1sum': {
        const data = stdin == null ? '' : stdin;
        return ok(GS.sha1(utf8(data)) + '  -\n');
      }
      case 'cat': {
        if (!argv.length) return ok(stdin || '');
        const v = fsView(sim); let out = '', good = true;
        for (const f of argv) {
          const p = normPath(f); const e = v.files[p];
          if (e) out += e.bin ? e.bin + '\n' : e.c;
          else if (v.dirs.has(p)) { out += 'cat: ' + f + ': Is a directory\n'; good = false; }
          else { out += 'cat: ' + f + ': No such file or directory\n'; good = false; }
        }
        return { raw: out, ok: good };
      }
      case 'head': {
        const f = argv.find(a => !a.startsWith('-')); const v = fsView(sim);
        const text = f ? (v.files[normPath(f)] || {}).c : stdin;
        if (text == null) return bad('head: cannot open \'' + f + '\' for reading: No such file or directory');
        return ok(text.split('\n').slice(0, 10).join('\n').replace(/\n*$/, '\n'));
      }
      case 'wc': {
        const f = argv.find(a => !a.startsWith('-')); const v = fsView(sim);
        const text = f ? (v.files[normPath(f)] || {}).c : stdin;
        if (text == null) return bad('wc: ' + f + ': No such file or directory');
        const lines = (text.match(/\n/g) || []).length;
        return ok(argv.includes('-c') ? utf8(text).length + (f ? ' ' + f : '') + '\n' : argv.includes('-l') ? lines + (f ? ' ' + f : '') + '\n' : lines + ' ' + text.split(/\s+/).filter(Boolean).length + ' ' + utf8(text).length + (f ? ' ' + f : '') + '\n');
      }
      case 'ls': return this.cmdLs(argv);
      case 'tree': return this.cmdFind(argv.length ? argv : ['.'], true);
      case 'find': return this.cmdFind(argv, false);
      case 'touch': {
        if (!argv.length) return bad('touch: missing file operand');
        for (const f of argv.filter(a => !a.startsWith('-'))) { const p = normPath(f); if (p.startsWith('.git')) return bad('touch: cannot touch \'' + f + '\': Permission denied'); if (sim.s.fs[p] === undefined) sim.s.fs[p] = ''; }
        return ok('');
      }
      case 'mkdir': {
        const names = argv.filter(a => !a.startsWith('-')); if (!names.length) return bad('mkdir: missing operand');
        for (const n of names) { const p = normPath(n); const v = fsView(sim); if ((v.dirs.has(p) || v.files[p]) && !argv.includes('-p')) return bad("mkdir: cannot create directory '" + n + "': File exists"); sim.s.dirs = sim.s.dirs || []; if (!sim.s.dirs.includes(p)) sim.s.dirs.push(p); }
        return ok('');
      }
      case 'rm': {
        const flags = argv.filter(a => a.startsWith('-')).join(''); const names = argv.filter(a => !a.startsWith('-'));
        if (!names.length) return bad('rm: missing operand');
        const rec = /r|R/.test(flags), force = /f/.test(flags); const out = []; let good = true;
        for (const n of names) {
          const p = normPath(n);
          if (p === '.git') { if (!rec) { out.push("rm: cannot remove '.git': Is a directory"); good = false; continue; } if (sim.s.git) { sim.s.git = null; r.explain = 'You deleted the .git folder. That folder IS the repository: all commits, branches and objects are gone. Only the current files remain. (Use Reset in the toolbar to start over.)'; r.flow = ['wipe']; } continue; }
          if (p.startsWith('.git/')) { out.push("rm: cannot remove '" + n + "': Permission denied (the simulator protects the inside of .git; use git commands)"); good = false; continue; }
          if (sim.s.fs[p] !== undefined) { delete sim.s.fs[p]; r.flow = ['wd-del']; continue; }
          const v = fsView(sim);
          if (v.dirs.has(p)) {
            if (!rec) { out.push("rm: cannot remove '" + n + "': Is a directory"); good = false; continue; }
            for (const f of Object.keys(sim.s.fs)) if (f.startsWith(p + '/')) delete sim.s.fs[f];
            sim.s.dirs = (sim.s.dirs || []).filter(d => d !== p && !d.startsWith(p + '/')); r.flow = ['wd-del']; continue;
          }
          if (!force) { out.push("rm: cannot remove '" + n + "': No such file or directory"); good = false; }
        }
        if (good && !r.explain && r.flow.length) r.explain = 'rm talks to your operating system, not to Git. The file vanished from the working directory but Git has not been told, so git status will show it as deleted (not staged). Use git rm, or git add <file>, to tell Git.';
        return { raw: nl(out.join('\n')), ok: good };
      }
      case 'mv': {
        if (argv.length < 2) return bad('mv: missing destination file operand after \'' + (argv[0] || '') + "'");
        const [a, b] = [normPath(argv[0]), normPath(argv[1])];
        if (sim.s.fs[a] === undefined) return bad("mv: cannot stat '" + argv[0] + "': No such file or directory");
        sim.s.fs[b] = sim.s.fs[a]; delete sim.s.fs[a];
        if (sim.s.git) { r.explain = 'mv renamed the file on disk only. Git sees one file vanish and an unknown file appear. After you stage both, it notices the contents match and calls it a rename. (git mv does the staging for you.)'; r.flow = ['wd-del']; }
        return ok('');
      }
      case 'cp': {
        if (argv.length < 2) return bad('cp: missing destination file operand');
        const [a, b] = [normPath(argv[0]), normPath(argv[1])];
        if (sim.s.fs[a] === undefined) return bad("cp: cannot stat '" + argv[0] + "': No such file or directory");
        sim.s.fs[b] = sim.s.fs[a]; return ok('');
      }
      case 'pwd': return ok('/c/Users/student/my-project\n');
      case 'cd': return ok('');
      case 'whoami': return ok('student\n');
      case 'date': return ok(gitDate(sim.now(), sim.tz) + '\n');
      case 'clear': r.clear = true; return ok('');
      case 'nano': case 'vim': case 'vi': case 'code': case 'notepad': {
        const f = argv.find(a => !a.startsWith('-')); if (!f || f === '.') return ok(name === 'code' ? '(In this simulator, open a file with: code index.html — or click a file in the Working directory panel.)\n' : '');
        const p = normPath(f);
        if (p.startsWith('.git/')) return bad(name + ': ' + f + ': read-only inside the simulator');
        r.editor = { kind: 'file', file: p, title: p, text: sim.s.fs[p] !== undefined ? sim.s.fs[p] : '', hint: 'Edit the file, then Save. The change lives only in your working directory until you git add it.', done: text => { sim.s.fs[p] = text; r.flow = ['wd-edit']; r.explain = 'You edited a file in the working directory. Git has not noticed yet: run git status to see it listed as modified (if tracked) or untracked.'; return ''; } };
        return ok('');
      }
      case 'help': return ok('Simulator terminal. Git commands: ' + GS.git.KNOWN.join(', ') + '.\nShell: ls, cat, echo, printf, touch, rm, mv, cp, mkdir, find, nano <file> (opens the editor), clear.\nTry: git --version\nTab completes commands and file names. Up/Down recalls history.\n');
      case 'exit': case 'logout': return ok('(Close this browser tab to leave the simulator.)\n');
      default: {
        const hit = SHELL_CMDS.concat(Object.keys(ALIASES)).find(c => c === name);
        void hit;
        return bad('bash: ' + args[0].s + ': command not found');
      }
    }
  }

  cmdLs(argv) {
    const sim = this.sim; const flags = argv.filter(a => /^-/.test(a)).join('').toLowerCase();
    const paths = argv.filter(a => !/^-/.test(a));
    const all = /a|force/.test(flags), long = /l/.test(flags);
    const v = fsView(sim);
    const dir = paths.length ? normPath(paths[0]) : '';
    if (dir && v.files[dir]) return { raw: dir + '\n', ok: true };
    if (dir && !v.dirs.has(dir)) return { raw: "ls: cannot access '" + paths[0] + "': No such file or directory\n", ok: false };
    const prefix = dir ? dir + '/' : '';
    const entries = new Map();
    for (const p of Object.keys(v.files)) if (p.startsWith(prefix)) { const rest = p.slice(prefix.length); const first = rest.split('/')[0]; entries.set(first, rest.includes('/') ? 'dir' : 'file'); }
    for (const d of v.dirs) if (d.startsWith(prefix)) { const rest = d.slice(prefix.length); if (rest) entries.set(rest.split('/')[0], 'dir'); }
    let names = [...entries.keys()].filter(n => all || !n.startsWith('.'));
    names.sort((a, b) => a.replace(/^\./, '').toLowerCase().localeCompare(b.replace(/^\./, '').toLowerCase()));
    const color = n => entries.get(n) === 'dir' ? paint(A.bc.replace('36', '34'), n) : n;
    if (long) {
      const d = new Date(sim.now() * 1000); const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
      const rows = names.map(n => { const isDir = entries.get(n) === 'dir'; const size = isDir ? 0 : utf8((v.files[prefix + n] || { c: '' }).c || '').length; return (isDir ? 'drwxr-xr-x' : '-rw-r--r--') + ' 1 student 197121 ' + String(size).padStart(5) + ' ' + mo + ' ' + String(d.getUTCDate()).padStart(2) + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' ' + color(n); });
      return { raw: rows.length ? rows.join('\n') + '\n' : '', ok: true };
    }
    if (all) names = ['.', '..'].concat(names);
    return { raw: names.length ? names.map(n => (n === '.' || n === '..') ? paint(A.b, n) : color(n)).join('  ') + '\n' : '', ok: true };
  }

  cmdFind(argv, treeMode) {
    const sim = this.sim; const v = fsView(sim);
    const start = normPath(argv.find(a => !a.startsWith('-')) || '.') || '.';
    const typeF = argv.includes('-type') ? argv[argv.indexOf('-type') + 1] : null;
    const base = start === '.' ? '' : start;
    if (base && !v.files[base] && !v.dirs.has(base)) return { raw: "find: '" + start + "': No such file or directory\n", ok: false };
    const all = [];
    for (const d of v.dirs) if (!base || d === base || d.startsWith(base + '/')) all.push({ p: d, dir: true });
    for (const f of Object.keys(v.files)) if (!base || f === base || f.startsWith(base + '/')) all.push({ p: f, dir: false });
    if (!base) all.push({ p: '', dir: true });
    all.sort((a, b) => (a.p < b.p ? -1 : 1));
    let lines = all.filter(e => !typeF || (typeF === 'f' ? !e.dir : e.dir)).map(e => (start === '.' ? (e.p ? './' + e.p : '.') : e.p));
    if (treeMode) {
      lines = all.filter(e => e.p && e.p !== base).map(e => { const rel = base ? e.p.slice(base.length + 1) : e.p; const depth = rel.split('/').length - 1; return '  '.repeat(depth) + '|-- ' + rel.split('/').pop() + (e.dir ? '/' : ''); });
      lines.unshift(start);
    }
    return { raw: lines.join('\n') + '\n', ok: true };
  }

  runGit(argv, stdin, r) {
    const sim = this.sim; const G = GS.git;
    let sub = argv[0];
    if (sub === '--version' || sub === '-v' || sub === 'version') { r.sub = 'git --version'; r.explain = 'This prints the version of the Git program installed on the machine. If you get "command not found", Git is not installed (or not on the PATH).'; return { raw: G.version() + '\n', ok: true }; }
    if (sub === undefined || sub === '--help' || sub === '-h' || sub === 'help') { r.sub = 'git help'; return { raw: G.help() + '\n', ok: true }; }
    r.sub = 'git ' + sub;
    if (argv.includes('--help') && sub !== 'help') return { raw: 'No manual pages in the simulator. See the Cheat sheet tab for ' + 'git ' + sub + '.\n', ok: true };
    const fn = G[sub];
    if (G.UNSUPPORTED[sub]) return { raw: 'This simulator is local only (like the handout session: no remote needed). git ' + sub + ' ' + G.UNSUPPORTED[sub] + '.\n', ok: false };
    if (typeof fn !== 'function' || ['KNOWN', 'UNSUPPORTED', 'version', 'help'].includes(sub)) {
      let best = null, bd = 99;
      for (const k of G.KNOWN) { const d = lev(sub, k); if (d < bd) { bd = d; best = k; } }
      const near = best && bd <= Math.max(2, Math.floor(sub.length / 3)) ? "\n\nThe most similar command is\n\t" + best : '';
      return { raw: "git: '" + sub + "' is not a git command. See 'git --help'." + near + '\n', ok: false };
    }
    const noRepoOk = ['init', 'config', 'hash-object'];
    try {
      if (!sim.s.git && !noRepoOk.includes(sub)) throw new GitError('fatal: not a git repository (or any of the parent directories): .git');
      const ctx = { r, stdin };
      const out = fn(sim, argv.slice(1), ctx);
      return { raw: out === '' || out == null ? '' : out + '\n', ok: true };
    } catch (e) {
      if (e instanceof GitError) {
        r.explain = r.explain && e.plain ? '' : '';
        if (e.code === 'quiet') return { raw: '', ok: false };
        return { raw: e.message + '\n', ok: false, plain: !!e.plain };
      }
      throw e;
    }
  }

  /* ---------------------------------------------------------------- tab completion */
  complete(text) {
    const sim = this.sim; const parts = text.split(' ');
    const last = parts[parts.length - 1]; const first = parts[0];
    let cands = [];
    if (parts.length === 1) cands = SHELL_CMDS;
    else if (first === 'git' && parts.length === 2) cands = GS.git.KNOWN.concat(['--version']);
    else {
      const v = fsView(sim); const files = new Set();
      for (const p of Object.keys(sim.s.fs)) { files.add(p); }
      for (const d of (sim.s.dirs || [])) files.add(d + '/');
      if (/^\.git/.test(last)) { for (const p of Object.keys(v.files)) files.add(p); }
      else files.add('.git/');
      cands = [...files];
      if (first === 'git' && sim.s.git && ['checkout', 'switch', 'branch', 'merge', 'log', 'show', 'diff', 'reset', 'tag'].includes(parts[1])) cands = cands.concat(sim.branches(), sim.tags(), ['HEAD', 'HEAD~1']);
      if (first === 'git' && ['commit', 'reset', 'log', 'status', 'add', 'branch', 'diff', 'restore', 'rm', 'clean', 'merge', 'show'].includes(parts[1])) {
        const flagMap = { commit: ['-m', '-am', '--amend'], log: ['--oneline', '--graph', '--all', '--reverse'], status: ['-s', '-sb'], add: ['.', '-A'], branch: ['-a', '-d', '-D', '-m', '-v'], diff: ['--staged'], restore: ['--staged', '--source=HEAD~1'], rm: ['--cached', '-r'], clean: ['-n', '-nd', '-fd', '-f'], merge: ['--no-ff', '--abort'], reset: ['--soft', '--mixed', '--hard'] };
        cands = cands.concat(flagMap[parts[1]] || []);
      }
    }
    const matches = [...new Set(cands)].filter(c => c.startsWith(last) && c !== last).sort();
    if (!matches.length) return { text, options: [] };
    let pre = matches[0];
    for (const m of matches) { while (!m.startsWith(pre)) pre = pre.slice(0, -1); }
    const newText = parts.slice(0, -1).concat([pre.length > last.length ? pre : last]).join(' ') + (matches.length === 1 && !pre.endsWith('/') ? ' ' : '');
    return { text: newText, options: matches.length > 1 ? matches : [] };
  }
}
GS.Terminal = Terminal;
GS.tipFor = tipFor;
})(GS);
if (typeof module !== 'undefined') module.exports = GS;
