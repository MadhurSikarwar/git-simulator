/* Git Simulator: engine.
   A small but faithful model of Git's storage: working directory, index,
   object database (blob / tree / commit / tag), refs, HEAD and reflog.
   Object ids are real SHA-1 hashes computed with Git's own object format,
   so `git hash-object` here gives the same id as real Git for the same bytes.
   No DOM access in this file. */
var GS = (typeof GS !== 'undefined') ? GS : {};
(function (GS) {
'use strict';

/* ------------------------------------------------------------------ ANSI */
const ESC = '\x1b[';
const A = {
  r: ESC + '31m', g: ESC + '32m', y: ESC + '33m', b: ESC + '34m', m: ESC + '35m', c: ESC + '36m',
  bold: ESC + '1m', dim: ESC + '2m', x: ESC + '0m',
  bg: ESC + '1;32m', bc: ESC + '1;36m', by: ESC + '1;33m', br: ESC + '1;31m'
};
const paint = (code, s) => code + s + A.x;
const stripAnsi = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');
GS.A = A; GS.paint = paint; GS.stripAnsi = stripAnsi;

class GitError extends Error {
  constructor(msg, extra) { super(msg); this.name = 'GitError'; if (extra) Object.assign(this, extra); }
}
GS.GitError = GitError;

/* ------------------------------------------------------------------ bytes + SHA-1 */
const te = new TextEncoder();
const utf8 = s => te.encode(s);
function concat(...arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function sha1(bytes) {
  const l = bytes.length;
  const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(l / 0x20000000));
  dv.setUint32(padded.length - 4, (l << 3) >>> 0);
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Uint32Array(80);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const tmp = ((((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0);
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(x => x.toString(16).padStart(8, '0')).join('');
}
GS.sha1 = sha1; GS.utf8 = utf8;

const hashObject = (type, body) => sha1(concat(utf8(type + ' ' + body.length + '\0'), body));
const hashBlob = content => hashObject('blob', utf8(content));
GS.hashBlob = hashBlob;

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const short = h => (h || '').slice(0, 7);
GS.short = short;

/* ------------------------------------------------------------------ text helpers */
function splitLines(s) {
  if (!s) return [];
  return s.match(/[^\n]*\n|[^\n]+$/g) || [];
}
function lineCount(s) { return splitLines(s).length; }

/* LCS based diff over arrays of strings. Returns ops: {t:'=', a, b} | {t:'-', a} | {t:'+', b} */
function lcsOps(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const n = ea - s, m = eb - s;
  const ops = [];
  for (let i = 0; i < s; i++) ops.push({ t: '=', a: i, b: i });
  if (n * m > 4000000) {
    for (let i = 0; i < n; i++) ops.push({ t: '-', a: s + i });
    for (let j = 0; j < m; j++) ops.push({ t: '+', b: s + j });
  } else {
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[s + i] === b[s + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[s + i] === b[s + j]) { ops.push({ t: '=', a: s + i, b: s + j }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', a: s + i }); i++; }
      else { ops.push({ t: '+', b: s + j }); j++; }
    }
    while (i < n) { ops.push({ t: '-', a: s + i }); i++; }
    while (j < m) { ops.push({ t: '+', b: s + j }); j++; }
  }
  for (let k = 0; k < a.length - ea; k++) ops.push({ t: '=', a: ea + k, b: eb + k });
  return ops;
}
const matchPairs = (a, b) => lcsOps(a, b).filter(o => o.t === '=').map(o => [o.a, o.b]);

function similarity(aText, bText) {
  if (aText === bText) return 100;
  const A_ = splitLines(aText), B_ = splitLines(bText);
  const max = Math.max(aText.length, bText.length);
  if (!max) return 100;
  let common = 0;
  for (const [i] of matchPairs(A_, B_)) common += A_[i].length;
  return Math.floor(common * 100 / max);
}

/* Unified diff body (hunks) as ANSI text lines */
function hunksText(aText, bText, ctx = 3) {
  const a = splitLines(aText), b = splitLines(bText);
  const ops = lcsOps(a, b);
  const out = [];
  const aPos = [], bPos = [];
  let ai = 0, bi = 0;
  for (const o of ops) { aPos.push(ai); bPos.push(bi); if (o.t !== '+') ai++; if (o.t !== '-') bi++; }
  const changes = [];
  ops.forEach((o, i) => { if (o.t !== '=') changes.push(i); });
  if (!changes.length) return out;
  const groups = [];
  for (const idx of changes) {
    const start = Math.max(0, idx - ctx), end = Math.min(ops.length, idx + ctx + 1);
    const last = groups[groups.length - 1];
    if (last && start <= last.end) last.end = end; else groups.push({ start, end });
  }
  const fmt = (start, count) => count === 1 ? String(start + 1) : (count === 0 ? start + ',0' : (start + 1) + ',' + count);
  for (const g of groups) {
    const slice = ops.slice(g.start, g.end);
    const ac = slice.filter(o => o.t !== '+').length, bc = slice.filter(o => o.t !== '-').length;
    out.push(paint(A.c, '@@ -' + fmt(aPos[g.start], ac) + ' +' + fmt(bPos[g.start], bc) + ' @@'));
    for (const o of slice) {
      const text = o.t === '+' ? b[o.b] : a[o.a];
      const body = text.replace(/\n$/, '');
      const pre = o.t === '=' ? ' ' : o.t;
      out.push(o.t === '-' ? paint(A.r, pre + body) : o.t === '+' ? paint(A.g, pre + body) : pre + body);
      if (!text.endsWith('\n')) out.push('\\ No newline at end of file');
    }
  }
  return out;
}

/* Three-way text merge (diff3 style). Returns {text, conflict} */
function merge3(baseText, oursText, theirsText, oursLabel, theirsLabel) {
  const base = splitLines(baseText), a = splitLines(oursText), b = splitLines(theirsText);
  const ma = new Map(matchPairs(base, a)), mb = new Map(matchPairs(base, b));
  const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  const out = []; let conflict = false;
  let bi = 0, ai = 0, ci = 0;
  const nl = arr => arr.map((l, i) => (i === arr.length - 1 && !l.endsWith('\n')) ? l + '\n' : l);
  const emit = (bs, as, cs) => {
    if (eq(as, bs)) out.push(...cs);
    else if (eq(cs, bs) || eq(as, cs)) out.push(...as);
    else {
      conflict = true;
      out.push('<<<<<<< ' + oursLabel + '\n', ...nl(as), '=======\n', ...nl(cs), '>>>>>>> ' + theirsLabel + '\n');
    }
  };
  for (let i = 0; i <= base.length; i++) {
    let aj, bj;
    if (i === base.length) { aj = a.length; bj = b.length; }
    else if (ma.has(i) && mb.has(i)) { aj = ma.get(i); bj = mb.get(i); }
    else continue;
    emit(base.slice(bi, i), a.slice(ai, aj), b.slice(ci, bj));
    if (i < base.length) out.push(base[i]);
    bi = i + 1; ai = aj + 1; ci = bj + 1;
  }
  return { text: out.join(''), conflict };
}

/* ------------------------------------------------------------------ globs, pathspecs, .gitignore */
function globToRe(g, pathspec) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += pathspec ? '.*' : '[^/]*';
    } else if (ch === '?') re += pathspec ? '.' : '[^/]';
    else if (ch === '[') {
      const j = g.indexOf(']', i + 2);
      if (j > i) { re += '[' + g.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']'; i = j; }
      else re += '\\[';
    } else re += ch.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
const normPath = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
GS.normPath = normPath;
function specMatcher(spec) {
  const s = normPath(spec);
  if (s === '.' || s === '') return () => true;
  if (/[*?[]/.test(s)) { const re = globToRe(s, true); return p => re.test(p); }
  return p => p === s || p.startsWith(s + '/');
}
GS.specMatcher = specMatcher;

function parseIgnore(text) {
  const rules = [];
  (text || '').split(/\r?\n/).forEach((line, i) => {
    let l = line.replace(/\s+$/, '');
    if (!l || l[0] === '#') return;
    let neg = false, dirOnly = false;
    if (l[0] === '!') { neg = true; l = l.slice(1); }
    if (l.endsWith('/')) { dirOnly = true; l = l.slice(0, -1); }
    const anchored = l.includes('/');
    if (l[0] === '/') l = l.slice(1);
    rules.push({ neg, dirOnly, anchored, re: globToRe(l), raw: line.trim(), line: i + 1 });
  });
  return rules;
}
function ruleHit(rules, path, isDir) {
  let hit = null;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    const target = r.anchored ? path : path.slice(path.lastIndexOf('/') + 1);
    if (r.re.test(target)) hit = r;
  }
  return hit;
}

/* ------------------------------------------------------------------ dates */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tzString = tz => (tz < 0 ? '-' : '+') + String(Math.floor(Math.abs(tz) / 60)).padStart(2, '0') + String(Math.abs(tz) % 60).padStart(2, '0');
function gitDate(ts, tz) {
  const d = new Date((ts + tz * 60) * 1000);
  const p = n => String(n).padStart(2, '0');
  return DAYS[d.getUTCDay()] + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' ' + d.getUTCFullYear() + ' ' + tzString(tz);
}
GS.gitDate = gitDate;

/* ------------------------------------------------------------------ object serialisation */
function treeBody(entries) {
  const sorted = entries.slice().sort((x, y) => {
    const kx = x.name + (x.mode === '040000' ? '/' : ''), ky = y.name + (y.mode === '040000' ? '/' : '');
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  const parts = [];
  for (const e of sorted) parts.push(utf8(e.mode.replace(/^0+/, '') + ' ' + e.name + '\0'), hexToBytes(e.hash));
  return { sorted, bytes: concat(...parts) };
}
function commitText(c) {
  let s = 'tree ' + c.tree + '\n';
  for (const p of c.parents) s += 'parent ' + p + '\n';
  s += 'author ' + c.author + '\ncommitter ' + c.committer + '\n\n' + c.message;
  return s;
}
function tagText(t) {
  return 'object ' + t.object + '\ntype ' + t.type + '\ntag ' + t.tag + '\ntagger ' + t.tagger + '\n\n' + t.message;
}
function bodyOf(o) {
  if (o.type === 'blob') return utf8(o.data);
  if (o.type === 'tree') return treeBody(o.data).bytes;
  if (o.type === 'commit') return utf8(commitText(o.data));
  return utf8(tagText(o.data));
}
GS.bodyOf = bodyOf;

/* ================================================================== Sim */
class Sim {
  constructor(opts = {}) {
    this.now = opts.now || (() => Math.floor(Date.now() / 1000));
    this.tz = opts.tz != null ? opts.tz : -new Date().getTimezoneOffset();
    this.cwdLabel = opts.cwdLabel || 'C:/Users/student/my-project';
    this.s = opts.state || Sim.freshState(opts.files, opts.identity !== false);
    this.ops = [];
  }

  static freshState(files, identity = true) {
    return {
      fs: Object.assign({}, files || {}),
      dirs: [],
      git: null,
      global: identity ? { 'user.name': 'Student', 'user.email': 'student@example.com', 'init.defaultBranch': 'main' } : { 'init.defaultBranch': 'main' }
    };
  }

  /* ----- plumbing ops log (for the "under the hood" panel) ----- */
  op(p, t, k, h) { this.ops.push({ p, t, k, h }); }

  git() {
    if (!this.s.git) throw new GitError('fatal: not a git repository (or any of the parent directories): .git');
    return this.s.git;
  }
  hasRepo() { return !!this.s.git; }

  initRepo(branch) {
    if (this.s.git) return false;
    this.s.git = {
      head: { ref: 'refs/heads/' + branch }, refs: {}, objects: {}, index: {}, conflicts: {},
      config: {}, reflog: [], seq: 0, mergeHead: null, mergeMsg: null, editMsg: null
    };
    return true;
  }

  config(key) {
    const g = this.s.git;
    if (g && g.config[key] != null) return g.config[key];
    return this.s.global[key];
  }

  /* ----- objects ----- */
  obj(h) { return this.git().objects[h]; }
  writeBlob(content) {
    const g = this.git();
    const hash = hashBlob(content);
    const isNew = !g.objects[hash];
    if (isNew) g.objects[hash] = { type: 'blob', data: content };
    return { hash, isNew };
  }
  blobContent(h) { const o = this.git().objects[h]; return o ? o.data : ''; }
  writeTree(entries) {
    const g = this.git();
    const { sorted, bytes } = treeBody(entries);
    const hash = hashObject('tree', bytes);
    const isNew = !g.objects[hash];
    if (isNew) g.objects[hash] = { type: 'tree', data: sorted.map(e => ({ mode: e.mode, type: e.mode === '040000' ? 'tree' : 'blob', hash: e.hash, name: e.name })) };
    return { hash, isNew };
  }
  writeCommit(c) {
    const g = this.git();
    const hash = hashObject('commit', utf8(commitText(c)));
    const parts = c.committer.split(' ');
    g.seq += 1;
    g.objects[hash] = { type: 'commit', data: Object.assign({}, c, { time: parseInt(parts[parts.length - 2], 10), seq: g.seq }) };
    return hash;
  }
  writeTag(t) {
    const g = this.git();
    const hash = hashObject('tag', utf8(tagText(t)));
    g.objects[hash] = { type: 'tag', data: t };
    return hash;
  }
  objectSize(h) { return bodyOf(this.obj(h)).length; }

  /* build (and store) tree objects for a flat {path: {hash, mode}} map */
  buildTree(flat) {
    const root = { files: {}, dirs: {} };
    for (const [p, e] of Object.entries(flat)) {
      const parts = p.split('/'); let n = root;
      for (let i = 0; i < parts.length - 1; i++) { n.dirs[parts[i]] = n.dirs[parts[i]] || { files: {}, dirs: {} }; n = n.dirs[parts[i]]; }
      n.files[parts[parts.length - 1]] = e;
    }
    let created = 0;
    const rec = n => {
      const entries = [];
      for (const [name, e] of Object.entries(n.files)) entries.push({ mode: e.mode, hash: e.hash, name });
      for (const [name, d] of Object.entries(n.dirs)) entries.push({ mode: '040000', hash: rec(d), name });
      const r = this.writeTree(entries); if (r.isNew) created++;
      return r.hash;
    };
    const hash = rec(root);
    return { hash, created };
  }
  flatTree(treeHash, prefix = '', out = {}) {
    const o = this.obj(treeHash);
    if (!o) return out;
    for (const e of o.data) {
      if (e.type === 'tree') this.flatTree(e.hash, prefix + e.name + '/', out);
      else out[prefix + e.name] = { hash: e.hash, mode: e.mode };
    }
    return out;
  }
  commitFlat(commitHash) {
    if (!commitHash) return {};
    return this.flatTree(this.obj(commitHash).data.tree);
  }
  headFlat() { return this.commitFlat(this.headHash()); }
  indexFlat() { return this.git().index; }

  /* ----- refs / HEAD ----- */
  headHash() {
    const g = this.git();
    return g.head.ref ? (g.refs[g.head.ref] || null) : g.head.hash;
  }
  branchName() {
    const g = this.git();
    return g.head.ref ? g.head.ref.replace('refs/heads/', '') : null;
  }
  branches() {
    return Object.keys(this.git().refs).filter(r => r.startsWith('refs/heads/')).map(r => r.slice(11)).sort();
  }
  tags() {
    return Object.keys(this.git().refs).filter(r => r.startsWith('refs/tags/')).map(r => r.slice(10)).sort();
  }
  logReflog(newHash, msg) {
    const g = this.git();
    const old = g.reflog.length ? g.reflog[g.reflog.length - 1].hash : null;
    g.reflog.push({ old, hash: newHash, msg, ts: this.now(), br: this.branchName() });
  }
  setBranchTip(ref, hash) { this.git().refs[ref] = hash; this.op('update-ref', ref + ' → ' + short(hash), 'ref', hash); }
  moveHeadTo(hash, msg) {
    const g = this.git();
    if (g.head.ref) g.refs[g.head.ref] = hash; else g.head.hash = hash;
    this.logReflog(hash, msg);
  }
  decorations(hash) {
    const g = this.git(); const d = [];
    const hh = this.headHash();
    if (g.head.ref) {
      if (hh === hash) d.push({ kind: 'head', text: 'HEAD -> ' + this.branchName() });
    } else if (g.head.hash === hash) d.push({ kind: 'head', text: 'HEAD' });
    for (const b of this.branches()) {
      if (g.refs['refs/heads/' + b] === hash && !(g.head.ref === 'refs/heads/' + b)) d.push({ kind: 'branch', text: b });
    }
    for (const t of this.tags()) {
      if (this.peel(g.refs['refs/tags/' + t]) === hash || g.refs['refs/tags/' + t] === hash) d.push({ kind: 'tag', text: 'tag: ' + t });
    }
    return d;
  }
  decorString(hash) {
    const d = this.decorations(hash);
    if (!d.length) return '';
    const col = x => x.kind === 'head' ? A.bc : x.kind === 'branch' ? A.bg : A.by;
    return ' ' + A.y + '(' + d.map(x => col(x) + x.text + A.x).join(A.y + ', ') + A.y + ')' + A.x;
  }

  /* ----- revision resolution ----- */
  peel(h) {
    let o = this.git().objects[h];
    while (o && o.type === 'tag') { h = o.data.object; o = this.git().objects[h]; }
    return h;
  }
  lookupPath(treeHash, path) {
    const parts = normPath(path).split('/').filter(Boolean);
    let cur = { hash: treeHash, type: 'tree', mode: '040000' };
    for (const part of parts) {
      const o = this.obj(cur.hash);
      if (!o || o.type !== 'tree') return null;
      const e = o.data.find(x => x.name === part);
      if (!e) return null;
      cur = { hash: e.hash, type: e.type, mode: e.mode };
    }
    return cur;
  }
  unknownRev(spec) {
    return new GitError("fatal: ambiguous argument '" + spec + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'", { code: 'unknown-rev' });
  }
  resolveBase(name) {
    const g = this.git();
    if (name === 'HEAD' || name === '@') return this.headHash();
    for (const cand of ['refs/heads/' + name, 'refs/tags/' + name, name]) if (g.refs[cand]) return g.refs[cand];
    if (/^[0-9a-f]{4,40}$/i.test(name)) {
      const hits = Object.keys(g.objects).filter(h => h.startsWith(name.toLowerCase()));
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) throw new GitError("error: short object ID " + name + " is ambiguous\nfatal: ambiguous argument '" + name + "': unknown revision or path not in the working tree.");
    }
    return null;
  }
  resolveRev(spec) {
    this.git();
    const ci = spec.indexOf(':');
    if (ci > 0) {
      const rev = spec.slice(0, ci), path = spec.slice(ci + 1);
      const c = this.resolveRev(rev);
      const treeHash = this.obj(c).type === 'tree' ? c : this.obj(this.peel(c)).data.tree;
      const found = this.lookupPath(treeHash, path);
      if (!found) throw new GitError("fatal: path '" + path + "' does not exist in '" + rev + "'");
      return found.hash;
    }
    const m = /^([^~^]+)((?:[~^]\{[a-z]*\}|[~^]\d*)*)$/.exec(spec);
    if (!m) throw this.unknownRev(spec);
    let h = this.resolveBase(m[1]);
    if (!h) throw this.unknownRev(spec);
    const re = /([~^])(\{[a-z]*\}|\d*)/g; let mm;
    while ((mm = re.exec(m[2]))) {
      const kind = mm[1], arg = mm[2];
      if (arg.startsWith('{')) {
        const want = arg.slice(1, -1);
        h = this.peel(h);
        if (want === 'tree') h = this.obj(h).type === 'tree' ? h : this.obj(h).data.tree;
        continue;
      }
      h = this.peel(h);
      const o = this.obj(h);
      if (!o || o.type !== 'commit') throw this.unknownRev(spec);
      if (kind === '~') {
        let n = arg === '' ? 1 : parseInt(arg, 10);
        while (n-- > 0) { const p = this.obj(h).data.parents[0]; if (!p) throw this.unknownRev(spec); h = p; }
      } else {
        const n = arg === '' ? 1 : parseInt(arg, 10);
        if (n === 0) continue;
        const p = o.data.parents[n - 1]; if (!p) throw this.unknownRev(spec); h = p;
      }
    }
    return h;
  }
  resolveCommit(spec) {
    const h = this.peel(this.resolveRev(spec));
    const o = this.obj(h);
    if (!o || o.type !== 'commit') throw new GitError("fatal: '" + spec + "' does not point to a commit");
    return h;
  }
  tryResolveCommit(spec) { try { return this.resolveCommit(spec); } catch (e) { return null; } }

  /* ----- history walking ----- */
  ancestors(h) {
    const seen = new Set(); const st = [h];
    while (st.length) { const x = st.pop(); if (!x || seen.has(x)) continue; seen.add(x); for (const p of this.obj(x).data.parents) st.push(p); }
    return seen;
  }
  orderCommits(tips, exclude) {
    const skip = new Set();
    for (const e of exclude || []) for (const h of this.ancestors(e)) skip.add(h);
    const seen = new Set(), stack = tips.filter(Boolean), nodes = [], kids = new Map();
    while (stack.length) {
      const h = stack.pop();
      if (seen.has(h) || skip.has(h)) continue;
      seen.add(h); nodes.push(h);
      for (const p of this.obj(h).data.parents) { if (skip.has(p)) continue; kids.set(p, (kids.get(p) || 0) + 1); stack.push(p); }
    }
    const indeg = new Map(nodes.map(h => [h, kids.get(h) || 0]));
    const ready = nodes.filter(h => indeg.get(h) === 0);
    const cmp = (x, y) => { const a = this.obj(x).data, b = this.obj(y).data; return (b.time - a.time) || (b.seq - a.seq); };
    const out = [];
    while (ready.length) {
      ready.sort(cmp);
      const h = ready.shift(); out.push(h);
      for (const p of this.obj(h).data.parents) {
        if (!indeg.has(p)) continue;
        indeg.set(p, indeg.get(p) - 1);
        if (indeg.get(p) === 0) ready.push(p);
      }
    }
    return out;
  }
  allTips() {
    const g = this.git(); const tips = [];
    for (const [r, h] of Object.entries(g.refs)) { const p = this.peel(h); if (this.obj(p) && this.obj(p).type === 'commit') tips.push(p); }
    const hh = this.headHash(); if (hh) tips.push(hh);
    return [...new Set(tips)];
  }
  mergeBase(a, b) {
    const A_ = this.ancestors(a), B_ = this.ancestors(b);
    const common = [...A_].filter(h => B_.has(h));
    const best = common.filter(h => !common.some(o => o !== h && this.ancestors(o).has(h)));
    best.sort((x, y) => this.obj(y).data.seq - this.obj(x).data.seq);
    return best[0] || null;
  }

  /* ----- working directory ----- */
  files() { return Object.keys(this.s.fs).sort(); }
  wtHash(p) { const c = this.s.fs[p]; return c === undefined ? null : hashBlob(c); }
  ignoreRules() { return parseIgnore(this.s.fs['.gitignore'] || ''); }
  /* {ignored, rule} for a path, taking parent directories into account */
  ignoreInfo(path, rules) {
    rules = rules || this.ignoreRules();
    const comps = path.split('/');
    for (let i = 1; i < comps.length; i++) {
      const dir = comps.slice(0, i).join('/');
      const h = ruleHit(rules, dir, true);
      if (h && !h.neg) return { ignored: true, rule: h };
    }
    const h = ruleHit(rules, path, false);
    if (h && !h.neg) return { ignored: true, rule: h };
    return { ignored: false, rule: h };
  }
  isIgnored(path) { return this.ignoreInfo(path).ignored; }

  /* ----- diff between two flat trees ----- */
  diffFlat(a, b, opts = {}) {
    const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    let ch = [];
    for (const p of paths) {
      const ea = a[p], eb = b[p];
      if (!ea) ch.push({ st: 'A', path: p, newHash: eb.hash, mode: eb.mode });
      else if (!eb) ch.push({ st: 'D', path: p, oldHash: ea.hash, mode: ea.mode });
      else if (ea.hash !== eb.hash || ea.mode !== eb.mode) ch.push({ st: 'M', path: p, oldHash: ea.hash, newHash: eb.hash, mode: eb.mode });
    }
    if (opts.renames !== false) {
      const dels = ch.filter(c => c.st === 'D'), adds = ch.filter(c => c.st === 'A');
      const pairs = [];
      for (const d of dels) for (const ad of adds) {
        const sim = d.oldHash === ad.newHash ? 100 : similarity(this.blobContent(d.oldHash), this.blobContent(ad.newHash));
        if (sim >= 50) pairs.push({ d, ad, sim });
      }
      pairs.sort((x, y) => y.sim - x.sim);
      const usedD = new Set(), usedA = new Set(), renames = [];
      for (const pr of pairs) {
        if (usedD.has(pr.d) || usedA.has(pr.ad)) continue;
        usedD.add(pr.d); usedA.add(pr.ad);
        renames.push({ st: 'R', path: pr.ad.path, oldPath: pr.d.path, oldHash: pr.d.oldHash, newHash: pr.ad.newHash, mode: pr.ad.mode, sim: pr.sim });
      }
      ch = ch.filter(c => !usedD.has(c) && !usedA.has(c)).concat(renames);
      ch.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    }
    return ch;
  }
  changeCounts(c) {
    if (c.st === 'R' && c.oldHash === c.newHash) return { ins: 0, del: 0 };
    const oldT = c.oldHash ? this.blobContent(c.oldHash) : '', newT = c.newHash ? this.blobContent(c.newHash) : '';
    const ops = lcsOps(splitLines(oldT), splitLines(newT));
    return { ins: ops.filter(o => o.t === '+').length, del: ops.filter(o => o.t === '-').length };
  }
  plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  shortStat(changes) {
    let ins = 0, del = 0;
    for (const c of changes) { const k = this.changeCounts(c); ins += k.ins; del += k.del; }
    let s = ' ' + this.plural(changes.length, 'file') + ' changed';
    if (ins || (!del)) s += ', ' + this.plural(ins, 'insertion') + '(+)';
    if (del || (!ins)) s += ', ' + this.plural(del, 'deletion') + '(-)';
    return s.replace(/insertions?\(\+\)/, m => m).replace(/ 1 insertions/, ' 1 insertion');
  }
  summaryLines(changes) {
    const out = [];
    for (const c of changes) {
      if (c.st === 'A') out.push(' create mode ' + c.mode + ' ' + c.path);
      else if (c.st === 'D') out.push(' delete mode ' + c.mode + ' ' + c.path);
      else if (c.st === 'R') out.push(' rename ' + c.oldPath + ' => ' + c.path + ' (' + c.sim + '%)');
    }
    return out;
  }
  diffStat(changes) {
    if (!changes.length) return '';
    const rows = changes.map(c => {
      const k = this.changeCounts(c);
      return { name: c.st === 'R' ? c.oldPath + ' => ' + c.path : c.path, n: k.ins + k.del, ins: k.ins, del: k.del };
    });
    const nameW = Math.max(...rows.map(r => r.name.length));
    const numW = Math.max(...rows.map(r => String(r.n).length));
    const maxN = Math.max(...rows.map(r => r.n));
    const graphW = Math.max(10, 80 - nameW - numW - 6);
    const scale = maxN > graphW ? graphW / maxN : 1;
    const lines = rows.map(r => {
      let p = Math.round(r.ins * scale), m = Math.round(r.del * scale);
      if (r.ins && !p) p = 1; if (r.del && !m) m = 1;
      return ' ' + r.name.padEnd(nameW) + ' | ' + String(r.n).padStart(numW) + ' ' + A.g + '+'.repeat(p) + A.r + '-'.repeat(m) + A.x;
    });
    return lines.join('\n');
  }

  /* file diff text (git diff format) for a list of changes */
  diffText(changes, opts = {}) {
    const out = [];
    for (const c of changes) {
      const aName = c.st === 'R' ? c.oldPath : c.path, bName = c.path;
      out.push(paint(A.bold, 'diff --git a/' + aName + ' b/' + bName));
      if (c.st === 'A') out.push(paint(A.bold, 'new file mode ' + c.mode));
      if (c.st === 'D') out.push(paint(A.bold, 'deleted file mode ' + c.mode));
      if (c.st === 'R') {
        out.push(paint(A.bold, 'similarity index ' + c.sim + '%'));
        out.push(paint(A.bold, 'rename from ' + c.oldPath));
        out.push(paint(A.bold, 'rename to ' + c.path));
      }
      if (c.st === 'R' && c.oldHash === c.newHash) continue;
      const oh = c.oldHash ? short(c.oldHash) : '0000000', nh = c.newHash ? short(c.newHash) : '0000000';
      out.push(paint(A.bold, 'index ' + oh + '..' + nh + (c.st === 'M' || c.st === 'R' ? ' ' + c.mode : '')));
      out.push(paint(A.bold, '--- ' + (c.st === 'A' ? '/dev/null' : 'a/' + aName)));
      out.push(paint(A.bold, '+++ ' + (c.st === 'D' ? '/dev/null' : 'b/' + bName)));
      const oldT = c.oldHash ? this.blobContent(c.oldHash) : '', newT = c.newHash ? this.blobContent(c.newHash) : '';
      out.push(...hunksText(oldT, newT));
    }
    return out.join('\n');
  }

  /* ----- status ----- */
  status() {
    const g = this.git();
    const head = this.headFlat(), idx = g.index;
    const conflictPaths = Object.keys(g.conflicts || {}).sort();
    const staged = this.diffFlat(head, idx, { renames: true }).filter(c => !(g.conflicts && g.conflicts[c.path]));
    const unstaged = [];
    for (const p of Object.keys(idx).sort()) {
      const c = this.s.fs[p];
      if (c === undefined) unstaged.push({ y: 'D', path: p });
      else if (hashBlob(c) !== idx[p].hash) unstaged.push({ y: 'M', path: p });
    }
    const trackedSet = new Set([...Object.keys(idx), ...conflictPaths]);
    const trackedDirs = new Set();
    for (const p of trackedSet) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) trackedDirs.add(parts.slice(0, i).join('/')); }
    const rules = this.ignoreRules();
    const untracked = [], ignored = [], seen = new Set();
    for (const p of this.files()) {
      if (trackedSet.has(p)) continue;
      if (this.ignoreInfo(p, rules).ignored) { ignored.push(p); continue; }
      const parts = p.split('/'); let shown = p;
      for (let i = 1; i < parts.length; i++) {
        const d = parts.slice(0, i).join('/');
        if (!trackedDirs.has(d)) { shown = d + '/'; break; }
      }
      if (!seen.has(shown)) { seen.add(shown); untracked.push(shown); }
    }
    return { staged, unstaged, untracked, ignored, conflicts: conflictPaths, merging: !!g.mergeHead };
  }
  isClean() {
    const st = this.status();
    return !st.staged.length && !st.unstaged.length && !st.untracked.length && !st.conflicts.length;
  }
  /* paths with local changes relative to HEAD (index or worktree) */
  dirtyPaths() {
    const g = this.git(); const head = this.headFlat(); const out = new Set();
    for (const p of new Set([...Object.keys(head), ...Object.keys(g.index)])) {
      const h = head[p] && head[p].hash, i = g.index[p] && g.index[p].hash;
      if (h !== i) { out.add(p); continue; }
      if (i !== undefined && this.wtHash(p) !== i) out.add(p);
    }
    for (const p of Object.keys(g.conflicts || {})) out.add(p);
    return out;
  }

  /* ----- identity, commit creation ----- */
  identity() {
    const name = this.config('user.name'), email = this.config('user.email');
    if (!name || !email) {
      throw new GitError("Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email \"you@example.com\"\n  git config --global user.name \"Your Name\"\n\nto set your account's default identity.\nOmit --global to set the identity only in this repository.\n\nfatal: unable to auto-detect email address (got 'student@lab.(none)')", { code: 'identity' });
    }
    return name + ' <' + email + '>';
  }
  stamp() { const ts = this.now(); return this.identity() + ' ' + ts + ' ' + tzString(this.tz); }
  /* create a commit object and move the current branch (or detached HEAD) */
  createCommit(treeHash, parents, message, reflogMsg) {
    const who = this.stamp();
    const hash = this.writeCommit({ tree: treeHash, parents, author: who, committer: who, message: message.endsWith('\n') ? message : message + '\n' });
    this.op('commit-tree', 'commit ' + short(hash) + ' → tree ' + short(treeHash) + (parents.length ? ', parent ' + parents.map(short).join(' + ') : ', no parent (root commit)'), 'commit', hash);
    const g = this.git();
    this.moveHeadTo(hash, reflogMsg);
    this.op(g.head.ref ? 'update-ref' : 'update-ref HEAD', (g.head.ref || 'HEAD') + ' → ' + short(hash), 'ref', hash);
    return hash;
  }

  /* ----- apply a target tree to index + worktree (checkout / reset --hard / merge) ----- */
  checkoutConflicts(curFlat, tgtFlat) {
    const g = this.git(); const dirty = [], untrackedBlock = [];
    for (const p of new Set([...Object.keys(curFlat), ...Object.keys(tgtFlat)])) {
      const ch = curFlat[p] && curFlat[p].hash, th = tgtFlat[p] && tgtFlat[p].hash;
      if (ch === th) continue;
      const ie = g.index[p] && g.index[p].hash, wt = this.wtHash(p);
      if (ie === undefined && ch === undefined && wt !== null && wt !== th && th !== undefined) { untrackedBlock.push(p); continue; }
      const isDirty = ie !== ch || (ie !== undefined && wt !== ie) || (ie === undefined && ch !== undefined && wt !== null);
      if (isDirty && !(ie === th && (wt === th || (th === undefined && wt === null)))) dirty.push(p);
    }
    return { dirty, untrackedBlock };
  }
  applyTree(curFlat, tgtFlat) {
    const g = this.git(); const changedFiles = [];
    for (const p of new Set([...Object.keys(curFlat), ...Object.keys(tgtFlat)])) {
      const ch = curFlat[p] && curFlat[p].hash, th = tgtFlat[p] && tgtFlat[p].hash;
      if (ch === th) continue;
      if (th !== undefined) { this.s.fs[p] = this.blobContent(th); g.index[p] = { hash: th, mode: tgtFlat[p].mode }; }
      else { delete this.s.fs[p]; delete g.index[p]; }
      changedFiles.push(p);
    }
    return changedFiles;
  }

  /* serialise */
  toJSON() { return JSON.stringify(this.s); }
}

GS.Sim = Sim;
GS.lcsOps = lcsOps; GS.merge3 = merge3; GS.hunksText = hunksText; GS.splitLines = splitLines;
GS.parseIgnore = parseIgnore; GS.tzString = tzString; GS.EMPTY_TREE = EMPTY_TREE; GS.similarity = similarity;
GS.treeBody = treeBody; GS.commitText = commitText; GS.tagText = tagText;
})(GS);
if (typeof module !== 'undefined') module.exports = GS;
