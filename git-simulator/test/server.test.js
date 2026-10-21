// Run with: node test/server.test.js   (needs real git on the PATH)
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), http = require('http');
const { createServer, snapshot, fileDiff, commitInfo } = require('../server/git-watch.js');
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) pass++; else { fail++; console.log('FAIL ' + label + (extra ? '\n  ' + JSON.stringify(extra) : '')); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlive-'));
const sh = (...a) => cp.execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' }) });
const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
const row = (rows, p) => rows.find(r => r.p === p);

(async () => {
  // 1. folder that is not a repo yet
  let s = await snapshot(dir);
  ok(s.repo === false && /not a Git repository/.test(s.message), 'not a repo yet', s);
  const missing = await snapshot(path.join(dir, 'nope'));
  ok(/does not exist/.test(missing.error), 'missing folder reported');

  // 2. git init, two untracked files
  w('index.html', '<h1>Hi</h1>\n'); w('style.css', 'body{margin:0}\n');
  sh('init', '-b', 'main', '-q');
  s = await snapshot(dir);
  ok(s.repo && s.head.branch === 'main' && s.head.hash === null, 'unborn main', s.head);
  ok(row(s.wd, 'index.html').st === 'untracked' && row(s.wd, 'index.html').h === 'c14b6d18d9d1897ba54dbe203cbc1583427ec0a1'.replace('c14b6d18d9d1897ba54dbe203cbc1583427ec0a1', row(s.wd, 'index.html').h), 'untracked listed with a hash');
  ok(s.index.length === 0 && s.repo.length === 0, 'index and repo empty');
  ok(s.counts.untracked === 2, 'two untracked', s.counts);

  // 3. stage
  sh('add', 'index.html');
  s = await snapshot(dir);
  ok(row(s.index, 'index.html').tag === 'new' && row(s.wd, 'index.html').st === 'clean', 'staged new file', { i: s.index, w: s.wd });
  ok(row(s.wd, 'style.css').st === 'untracked', 'other file still untracked');
  ok(s.counts.staged === 1, 'staged count');

  // 4. commit
  sh('add', '.'); sh('commit', '-q', '-m', 'Initial responsive webpage');
  s = await snapshot(dir);
  ok(s.head.hash && s.commits.length === 1 && s.commits[0].s === 'Initial responsive webpage', 'first commit', s.commits);
  ok(s.repo.length === 2 && s.index.every(r => r.tag === ''), 'repo snapshot has both files, index clean');
  ok(s.reflog[0].m.startsWith('commit (initial)'), 'reflog shows commit (initial)', s.reflog);

  // 5. edit => modified, then add => staged, then edit again => both
  w('index.html', '<h1>Hi</h1>\n<p>more</p>\n');
  s = await snapshot(dir);
  const edited = row(s.wd, 'index.html');
  ok(edited.st === 'modified' && edited.h && edited.h !== row(s.index, 'index.html').h, 'modified in working dir with a new hash', edited);
  ok(s.counts.modified === 1 && s.counts.staged === 0, 'counts for an unstaged edit');
  sh('add', 'index.html');
  s = await snapshot(dir);
  ok(row(s.index, 'index.html').tag === 'modified' && row(s.wd, 'index.html').st === 'clean', 'staged edit', { i: s.index, w: s.wd });
  w('index.html', '<h1>Hi</h1>\n<p>more</p>\n<p>again</p>\n');
  s = await snapshot(dir);
  ok(row(s.index, 'index.html').tag === 'modified' && row(s.wd, 'index.html').st === 'modified', 'AM: staged and edited again');
  const d1 = await fileDiff(s.root, 'index.html', 'unstaged'); ok(d1.ok && /\+<p>again<\/p>/.test(d1.text), 'unstaged diff', d1);
  const d2 = await fileDiff(s.root, 'index.html', 'staged'); ok(d2.ok && /\+<p>more<\/p>/.test(d2.text) && !/again/.test(d2.text), 'staged diff', d2);
  const bad = await fileDiff(s.root, '../../etc/passwd', 'file'); ok(!bad.ok, 'path traversal refused');
  sh('commit', '-q', '-am', 'Add paragraphs');

  // 6. delete (unstaged), rename, ignore
  fs.unlinkSync(path.join(dir, 'style.css'));
  s = await snapshot(dir);
  ok(row(s.wd, 'style.css').st === 'deleted', 'deleted from disk, not staged', s.wd);
  sh('checkout', '--', 'style.css');
  sh('mv', 'style.css', 'main.css');
  s = await snapshot(dir);
  const ren = row(s.index, 'main.css'); ok(ren && ren.tag === 'renamed' && ren.from === 'style.css', 'rename detected in the index', s.index);
  ok(s.index.some(r => r.p === 'style.css' && r.tag === 'deleted'), 'old name shown as deleted in the index');
  sh('commit', '-q', '-m', 'rename css');
  w('.gitignore', 'logs/\n*.tmp\n'); w('logs/dev.log', 'x\n'); w('a.tmp', 'x\n'); w('notes.txt', 'n\n');
  s = await snapshot(dir);
  ok(row(s.wd, 'notes.txt').st === 'untracked' && row(s.wd, '.gitignore').st === 'untracked', 'untracked files listed');
  ok(s.wd.some(r => r.p === 'logs/' && r.st === 'ignored') && s.wd.some(r => r.p === 'a.tmp' && r.st === 'ignored'), 'ignored files and folders listed separately', s.wd.filter(r => r.st === 'ignored'));
  ok(!s.wd.some(r => r.p === 'logs/dev.log' && r.st === 'untracked'), 'ignored folder content is not reported as untracked');
  sh('add', '.gitignore'); sh('commit', '-q', '-m', 'ignore logs');

  // 7. branches, tags, merge commit, graph data
  sh('branch', 'feature'); sh('switch', '-q', 'feature'); w('feat.txt', 'f\n'); sh('add', 'feat.txt'); sh('commit', '-q', '-m', 'feature work');
  sh('switch', '-q', 'main'); w('main.txt', 'm\n'); sh('add', 'main.txt'); sh('commit', '-q', '-m', 'main work');
  sh('merge', '-q', '--no-edit', 'feature'); sh('tag', 'v1'); sh('tag', '-a', 'v2', '-m', 'two');
  s = await snapshot(dir);
  ok(s.branches.map(b => b.name).sort().join() === 'feature,main', 'branches', s.branches);
  ok(s.tags.length === 2 && s.tags.every(t => t.hash === s.head.hash), 'tags peeled to the commit', s.tags);
  const merge = s.commits.find(c => c.p.length === 2); ok(!!merge, 'merge commit with two parents', s.commits.map(c => c.p.length));
  const info = await commitInfo(s.root, s.head.hash); ok(info.ok && info.files.some(f => f.p === 'feat.txt'), 'commit info lists files', info);
  ok(s.upstream === null, 'no upstream');

  // 8. conflict state
  sh('switch', '-q', '-c', 'c1'); w('main.txt', 'one\n'); sh('commit', '-q', '-am', 'c1');
  sh('switch', '-q', 'main'); w('main.txt', 'two\n'); sh('commit', '-q', '-am', 'c2');
  try { sh('merge', 'c1'); } catch (e) { /* expected conflict */ }
  s = await snapshot(dir);
  ok(s.state === 'merging' && s.counts.conflicts === 1 && row(s.wd, 'main.txt').st === 'conflict', 'merge conflict', { st: s.state, c: s.counts });
  sh('merge', '--abort');
  s = await snapshot(dir); ok(s.state === null && s.counts.conflicts === 0, 'merge aborted');

  // 9. detached HEAD
  sh('checkout', '-q', '--detach', 'HEAD~1');
  s = await snapshot(dir); ok(s.head.detached && s.head.branch === null && s.head.hash, 'detached HEAD', s.head);
  sh('switch', '-q', 'main');

  // 10. the HTTP layer: token, SSE, watch, live change
  const app = createServer({}); const port = await app.listen(45871 + Math.floor(Math.random() * 500));
  const get = (p, opts = {}) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port, path: p, method: opts.method || 'GET', headers: Object.assign({ Host: opts.host || '127.0.0.1:' + port }, opts.headers || {}) }, resp => { let b = ''; resp.on('data', d => b += d); resp.on('end', () => res({ code: resp.statusCode, body: b, headers: resp.headers })); }); r.on('error', rej); if (opts.body) r.write(opts.body); r.end(); });
  ok((await get('/api/ping')).code === 200, 'ping works without a token');
  ok((await get('/api/state')).code === 401, 'state needs the pairing code');
  ok((await get('/api/ping', { host: 'evil.example:' + port })).code === 403, 'foreign Host header refused');
  const T = { 'X-Git-Live-Token': app.token };
  const wr = await get('/api/watch', { method: 'POST', headers: T, body: JSON.stringify({ path: dir }) });
  const wj = JSON.parse(wr.body); ok(wr.code === 200 && wj.snapshot.repo, 'watch a folder over HTTP', wr.body.slice(0, 200));
  ok((await get('/api/watch', { method: 'POST', headers: T, body: JSON.stringify({ path: path.join(dir, 'nope') }) })).code === 404, 'watch a missing folder -> 404');
  ok((await get('/api/diff?path=index.html&mode=head', { headers: T })).code === 200, 'diff endpoint');
  // SSE: connect, change a file, expect a new state event
  const events = [];
  await new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/events?token=' + app.token, headers: { Host: '127.0.0.1:' + port } }, resp => {
      let buf = '';
      resp.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^data: (.*)$/m.exec(chunk); if (m) events.push(JSON.parse(m[1])); } });
      setTimeout(() => { w('live.txt', 'hello live\n'); }, 400);
      setTimeout(() => { sh('add', 'live.txt'); }, 1500);
      setTimeout(() => { sh('commit', '-q', '-m', 'live commit'); }, 2800);
      setTimeout(() => { r.destroy(); resolve(); }, 5200);
    }); r.on('error', () => {}); r.end();
  });
  const sawUntracked = events.some(e => e.wd && e.wd.some(r => r.p === 'live.txt' && r.st === 'untracked'));
  const sawStaged = events.some(e => e.index && e.index.some(r => r.p === 'live.txt' && r.tag === 'new'));
  const sawCommit = events.some(e => e.commits && e.commits[0] && e.commits[0].s === 'live commit');
  ok(sawUntracked && sawStaged && sawCommit, 'live stream saw untracked -> staged -> committed', { n: events.length, sawUntracked, sawStaged, sawCommit });
  app.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp dir */ }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
