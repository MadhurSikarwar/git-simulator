/* Site: shared helpers + the Workspace (a simulator + terminal that views subscribe to). */
(function (GS) {
'use strict';
const U = GS.ui = {};

U.$ = (s, r) => (r || document).querySelector(s);
U.$$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
U.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
U.store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage may be blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* A colour derived from an object id, so equal content shows an equal colour everywhere. */
U.hashColor = h => {
  if (!h) return 'transparent';
  const n = parseInt(h.slice(0, 6), 16);
  return 'hsl(' + (n % 360) + ' 64% ' + (40 + ((n >> 9) % 14)) + '%)';
};
U.sw = h => '<i class="sw" style="background:' + U.hashColor(h) + '"></i>';

/* ANSI colour codes -> HTML (one span per line so line classes can mark errors and hints) */
U.ansi = function (text) {
  const esc = U.esc;
  return String(text).split('\n').map(line => {
    let cls = [], out = '', last = 0, m;
    const re = /\x1b\[([0-9;]*)m/g;
    const flush = t => { if (!t) return; out += cls.length ? '<span class="' + cls.join(' ') + '">' + esc(t) + '</span>' : esc(t); };
    while ((m = re.exec(line))) {
      flush(line.slice(last, m.index)); last = re.lastIndex;
      (m[1] === '' ? ['0'] : m[1].split(';')).forEach(c => {
        c = +c;
        if (c === 0) cls = [];
        else if (c === 1) cls.push('b');
        else if (c === 2) cls.push('d');
        else if (c >= 30 && c <= 37) { cls = cls.filter(x => !/^c\d+$/.test(x)); cls.push('c' + c); }
      });
    }
    flush(line.slice(last));
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
    let lc = '';
    if (/^(fatal|error):/.test(plain) || /^CONFLICT/.test(plain)) lc = ' l-err';
    else if (/^(hint|warning):/.test(plain)) lc = ' l-hint';
    return '<span class="ln' + lc + '">' + out + '</span>';
  }).join('\n');
};

/* Tracks which keys existed at the previous render, to flash what is new. */
U.fresher = function () {
  let prev = null, next = new Set();
  return {
    cls(k) { next.add(k); return prev && !prev.has(k) ? ' fresh' : ''; },
    begin() { next = new Set(); },
    end() { prev = next; },
    forget() { prev = null; }
  };
};

U.copy = function (text) {
  return new Promise(resolve => {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); resolve(ok);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => resolve(true), fallback);
      else fallback();
    } catch (e) { fallback(); }
  });
};

U.toast = function (msg) {
  let t = U.$('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(U.toast._t); U.toast._t = setTimeout(() => t.classList.remove('show'), 2200);
};

U.reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

/* ------------------------------------------------------------------ Workspace */
class Workspace {
  constructor(o = {}) {
    this.files = o.files || GS.sampleProject();
    this.identity = o.identity !== false;
    this.listeners = []; this.quiet = 0; this.last = null;
    this.reset(o.state);
  }
  reset(state) {
    this.sim = new GS.Sim({ state: state || undefined, files: this.files, identity: this.identity });
    this.term = new GS.Terminal(this.sim);
    this.last = null;
  }
  on(fn) { this.listeners.push(fn); return this; }
  emit(res, kind) { if (this.quiet) return; this.listeners.forEach(fn => fn(res, kind)); }
  run(line) { const res = this.term.run(line); this.last = res; this.emit(res, 'run'); return res; }
  write(path, content) {
    this.sim.s.fs[path] = content;
    this.term.log.push({ cmd: '# edit ' + path, out: '', raw: '', ok: true, sub: 'edit' });
    const res = { cmd: '# edit ' + path, lines: '', ok: true, ops: [], explain: 'You changed a file in the working directory. Git has not noticed yet: run git status to see it listed.', flow: ['wd-edit'], tip: null, sub: null, edited: path };
    this.last = res; this.emit(res, 'edit'); return res;
  }
  edit(key) {
    const e = GS.edits[key];
    const changed = GS.applyEdit(this.sim, key);
    if (!changed) return null;
    return this.write(e.file, this.sim.s.fs[e.file]);
  }
  /* throw away the repository and tell views to start fresh (no "new" flashes) */
  restart(state) { this.reset(state); this.emit(null, 'reset'); }
  /* run something without telling the views, then tell them once to re-sync */
  silently(fn) { this.quiet++; try { fn(); } finally { this.quiet--; } this.emit(null, 'sync'); }
}
U.Workspace = Workspace;
})(GS);
