/* Site: shell, router, modals. Boots the whole site. */
(function (GS) {
'use strict';
const U = GS.ui; const { $, $$, esc } = U;
const App = U.App = {};
const ROUTES = ['home', 'learn', 'lab', 'live', 'reference', 'practice', 'session'];
const LABELS = { home: 'Home', learn: 'Learn', lab: 'Lab', live: 'Live repo', reference: 'Reference', practice: 'Practice', session: 'Session' };

const SHELL = `
<a class="skip" href="#home" data-skip>Skip to content</a>
<header class="nav" id="nav">
  <div class="nav-in">
    <a class="nav-brand" href="#home" data-go="home" aria-label="Git, from the inside out: home">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="7" fill="var(--accent)"/><path d="M10 8v16M10 13c0 4 12 1 12 7" stroke="var(--accent-ink)" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="10" cy="8" r="2.8" fill="var(--accent-ink)"/><circle cx="10" cy="24" r="2.8" fill="var(--accent-ink)"/><circle cx="22" cy="20" r="2.8" fill="var(--accent-ink)"/></svg>
      <span>Git, from the inside out</span>
    </a>
    <nav class="nav-links" aria-label="Pages">
      ${ROUTES.map(r => `<a href="#${r}" data-go="${r}" data-route="${r}">${LABELS[r]}${r === 'lab' ? ' <span class="nav-badge" data-progress>0/15</span>' : ''}</a>`).join('')}
    </nav>
    <button type="button" class="btn nav-proj" id="btn-theme" aria-pressed="false" title="Switch between the light and the dark look">Dark</button>
    <button type="button" class="btn nav-proj" id="btn-proj" aria-pressed="false" title="Larger text for a projector">Projector</button>
  </div>
</header>
<main id="main" tabindex="-1">${ROUTES.map(r => `<div class="page${r === 'lab' ? ' page-lab' : ''}" id="page-${r}" data-page="${r}" hidden></div>`).join('')}</main>
<footer class="site-foot"><div class="wrap"><p>Built from the handout "Git, from the inside out". Everything runs in this page: nothing is uploaded and no real repository is touched.</p><p class="mini">Hashes are real SHA-1 values in Git's own object format, so they match what a real Git prints for the same content.</p></div></div></footer>

<div class="modal" id="modal-edit" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="me-title">
    <div class="modal-h"><h2 id="me-title">Editor</h2><button type="button" class="mini-btn" id="me-x" aria-label="Close editor">Close</button></div>
    <p class="modal-hint" id="me-hint"></p>
    <div class="modal-name" id="me-name-wrap" hidden><label for="me-name">File name</label><input id="me-name" type="text" placeholder="notes.txt" spellcheck="false" autocomplete="off"></div>
    <label class="sr" for="me-text">File content</label>
    <textarea id="me-text" spellcheck="false" rows="16"></textarea>
    <div class="modal-f"><span class="mini">Ctrl+S saves, Esc cancels</span><span class="grow"></span><button type="button" class="btn" id="me-cancel">Cancel</button><button type="button" class="btn primary" id="me-save">Save</button></div>
  </div>
</div>
<div class="modal" id="modal-text" hidden>
  <div class="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="mt-title">
    <div class="modal-h"><h2 id="mt-title">Text</h2><button type="button" class="mini-btn" id="mt-x" aria-label="Close">Close</button></div>
    <p class="modal-hint" id="mt-note"></p>
    <label class="sr" for="mt-text">Text</label>
    <textarea id="mt-text" readonly spellcheck="false" rows="20"></textarea>
    <div class="modal-f"><span class="mini" id="mt-status"></span><span class="grow"></span><button type="button" class="btn" id="mt-close">Close</button><button type="button" class="btn primary" id="mt-copy">Copy to clipboard</button></div>
  </div>
</div>`;

/* ------------------------------------------------------------------ modals */
U.editor = function (o) {
  const m = $('#modal-edit'); const ta = $('#me-text'); const prev = document.activeElement;
  $('#me-title').textContent = o.title || 'Editor'; $('#me-hint').textContent = o.hint || '';
  $('#me-name-wrap').hidden = !o.nameField; $('#me-name').value = '';
  ta.value = o.text || ''; $('#me-save').textContent = o.saveLabel || 'Save';
  m.hidden = false; document.body.classList.add('modal-open');
  let onKey;
  const close = () => { m.hidden = true; document.body.classList.remove('modal-open'); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus({ preventScroll: true }); };
  const save = () => { const t = ta.value, n = $('#me-name').value; close(); if (o.onSave) o.onSave(t, n); };
  const cancel = () => { close(); if (o.onCancel) o.onCancel(); };
  onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  $('#me-save').onclick = save; $('#me-cancel').onclick = cancel; $('#me-x').onclick = cancel;
  document.addEventListener('keydown', onKey);
  setTimeout(() => (o.nameField ? $('#me-name') : ta).focus(), 30);
};
U.showText = function (o) {
  const m = $('#modal-text'); const ta = $('#mt-text'); const prev = document.activeElement;
  $('#mt-title').textContent = o.title || ''; $('#mt-note').textContent = o.note || ''; ta.value = o.text || ''; $('#mt-status').textContent = '';
  m.hidden = false; document.body.classList.add('modal-open');
  let onKey;
  const close = () => { m.hidden = true; document.body.classList.remove('modal-open'); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus({ preventScroll: true }); };
  onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  $('#mt-x').onclick = close; $('#mt-close').onclick = close;
  $('#mt-copy').onclick = () => U.copy(o.text || '').then(ok => {
    $('#mt-status').textContent = ok ? 'Copied.' : 'Copy was blocked here. The text is selected: press Ctrl+C.';
    if (!ok) { ta.focus(); ta.select(); }
  });
  setTimeout(() => { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; }, 30);
};

/* ------------------------------------------------------------------ router */
function parseHash() {
  const h = (location.hash || '').replace(/^#/, '');
  const i = h.indexOf('-'); const page = i < 0 ? h : h.slice(0, i); const sub = i < 0 ? null : h.slice(i + 1);
  return { page: ROUTES.includes(page) ? page : 'home', sub: ROUTES.includes(page) ? sub : null };
}
const mounted = {};
App.cur = null;
App.show = function (page, sub) {
  if (App.cur === page && App.curSub === sub) return;
  const prev = App.cur;
  if (prev && prev !== page && U.pages[prev] && U.pages[prev].hide) U.pages[prev].hide();
  App.cur = page; App.curSub = sub;
  $$('.page').forEach(p => { p.hidden = p.dataset.page !== page; });
  const el = $('#page-' + page);
  if (!mounted[page]) {
    mounted[page] = true;
    if (page === 'lab') U.Lab.mount(el, App);
    else { el.innerHTML = U.pages[page].html(); U.pages[page].mount(el, App); }
  }
  const pg = U.pages[page]; if (pg && pg.show) pg.show(sub);
  $$('.nav-links a').forEach(a => { const on = a.dataset.route === page; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (!(page === 'learn' && sub)) window.scrollTo(0, 0);
  if (page === 'lab') setTimeout(() => U.Lab.focus(), 40);
  document.body.dataset.page = page;
};
App.go = function (page, sub) {
  const h = sub ? page + '-' + sub : page;
  try { if (location.hash.replace(/^#/, '') !== h) location.hash = h; } catch (e) { /* hash may be locked in a sandbox */ }
  App.show(page, sub || null);
};
App.openLab = function (stepId, setup) {
  App.go('lab');
  if (stepId) U.Lab.openStep(stepId, !!setup);
};
App.send = function (cmd, run) { App.go('lab'); U.Lab.send(cmd, !!run); };
App.setProgress = function (done, total) {
  $$('[data-progress]').forEach(b => { b.textContent = done + '/' + total; b.classList.toggle('some', done > 0); });
  if (U.pages.home && U.pages.home.el) U.pages.home.refresh();
};

/* ------------------------------------------------------------------ boot */
App.start = function () {
  const host = document.getElementById('app') || document.body;
  host.innerHTML = SHELL;
  const proj = U.store.get('gitlab.proj', false);
  document.documentElement.classList.toggle('proj', !!proj);
  const applyTheme = dark => { if (dark) document.documentElement.setAttribute('data-site-theme', 'dark'); else document.documentElement.removeAttribute('data-site-theme'); const tb = $('#btn-theme'); tb.setAttribute('aria-pressed', String(!!dark)); tb.textContent = dark ? 'Light' : 'Dark'; };
  applyTheme(U.store.get('gitlab.theme', 'light') === 'dark');
  $('#btn-theme').addEventListener('click', () => { const dark = !document.documentElement.hasAttribute('data-site-theme'); applyTheme(dark); U.store.set('gitlab.theme', dark ? 'dark' : 'light'); });
  const pb = $('#btn-proj'); pb.setAttribute('aria-pressed', String(!!proj));
  pb.addEventListener('click', () => {
    const on = !document.documentElement.classList.contains('proj');
    document.documentElement.classList.toggle('proj', on); pb.setAttribute('aria-pressed', String(on)); U.store.set('gitlab.proj', on);
  });
  document.addEventListener('click', e => {
    const resume = e.target.closest('[data-resume-step]');
    if (resume) { e.preventDefault(); App.openLab(resume.dataset.resumeStep, false); return; }
    const labBtn = e.target.closest('[data-lab-step]');
    if (labBtn) { e.preventDefault(); App.openLab(labBtn.dataset.labStep, !!labBtn.dataset.setup); return; }
    const send = e.target.closest('[data-send]');
    if (send) { e.preventDefault(); App.send(send.dataset.send, !!send.dataset.run); return; }
    const go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); App.go(go.dataset.go, go.dataset.sub || null); return; }
    if (e.target.closest('[data-skip]')) { e.preventDefault(); $('#main').focus(); }
  });
  window.addEventListener('hashchange', () => { const p = parseHash(); App.show(p.page, p.sub); });
  document.addEventListener('visibilitychange', () => { /* home demo checks document.hidden itself */ });
  const p = parseHash();
  // the lab keeps its own state; mount it quietly first so the nav badge is right on every page
  mounted.lab = true; U.Lab.mount($('#page-lab'), App);
  App.show(p.page, p.sub);
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', App.start); else App.start();
})(GS);
