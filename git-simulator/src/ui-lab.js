/* Site: the Lab page. Guided steps + terminal + live views, on one persistent workspace. */
(function (GS) {
'use strict';
const U = GS.ui; const { $, $$, esc, ansi } = U;
const KEY = 'gitlab.lab.v3';
const Lab = GS.ui.Lab = {};
let ws, S, root, areas, graph, inspGit, inspObj;
const q = sel => $(sel, root);

const TEMPLATE = `
<div class="page-head lab-head">
  <div>
    <p class="eyebrow">Lab</p>
    <h2>Run the whole workflow</h2>
    <p class="lede">Follow the guided steps, or type anything. Every command runs on a simulated repository, and the pictures beside it show what it did.</p>
  </div>
  <div class="lab-actions">
    <details class="opts"><summary>Options</summary>
      <div class="opts-pop">
        <label class="chk"><input type="checkbox" id="opt-tips" checked> Explain errors with a tip</label>
        <label class="chk"><input type="checkbox" id="opt-identity" checked> Git name and email already set</label>
        <p class="mini">Untick the second box to rehearse the "Author identity unknown" error a fresh lab PC shows on the first commit.</p>
      </div>
    </details>
    <button type="button" class="btn" id="lab-evidence">Evidence</button>
    <button type="button" class="btn warn" id="lab-reset">Reset lab</button>
  </div>
</div>
<div class="layout">
  <div class="col col-left">
    <section class="panel guide" id="lab-guide" aria-label="Lab guide"></section>
    <section class="panel term" aria-label="Terminal">
      <div class="term-bar"><span class="term-title">Terminal</span><span class="term-hint">Tab completes. Up and Down recall. Try <code>nano index.html</code>.</span><button type="button" class="mini-btn" id="term-clear">Clear</button></div>
      <div class="term-out" id="term-out" role="log" aria-live="polite" tabindex="-1"></div>
      <form class="term-in" id="term-form" autocomplete="off">
        <label for="term-cmd" class="prompt" id="term-prompt">$</label>
        <input id="term-cmd" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Type a command" placeholder="type a command, for example git --version">
      </form>
    </section>
  </div>
  <div class="col col-right">
    <section class="panel areas-panel" aria-label="Where your files live">
      <div class="panel-h"><h3>Three places your files live</h3></div>
      <div id="lab-areas"></div>
    </section>
    <section class="panel graph-panel" aria-label="Commit history">
      <div class="panel-h"><h3>History</h3><p class="panel-sub">Each circle is a commit. Click one to read it.</p></div>
      <div id="lab-graph"></div>
    </section>
    <section class="panel inspector" aria-label="Inspector">
      <div class="tabs" role="tablist" id="lab-tabs">
        <button role="tab" type="button" data-tab="git">.git folder</button>
        <button role="tab" type="button" data-tab="objects">Objects</button>
        <button role="tab" type="button" data-tab="obs">Observation table</button>
        <button role="tab" type="button" data-tab="assess">Assessment</button>
        <button role="tab" type="button" data-tab="cheat">Cheat sheet</button>
      </div>
      <div class="pane" data-pane="git"></div>
      <div class="pane" data-pane="objects"><div data-obj-view></div><div class="hp-wrap"><h4>Hash playground</h4><div data-hash></div></div></div>
      <div class="pane" data-pane="obs"></div>
      <div class="pane" data-pane="assess"></div>
      <div class="pane" data-pane="cheat"></div>
    </section>
  </div>
</div>`;

/* ------------------------------------------------------------------ persistence */
const save = U.debounce(() => {
  if (!ws) return;
  U.store.set(KEY, {
    sim: ws.sim.s, log: ws.term.log.slice(-80), identity: ws.identity,
    ui: { step: S.step, group: S.group, done: [...S.done], tab: S.tab, notes: S.notes, opts: S.opts, hist: S.hist.slice(-60), name: S.name }
  });
}, 350);

/* ------------------------------------------------------------------ terminal */
function promptHtml() {
  const p = ws.term.prompt();
  return `<span class="p-path">${esc(p.path)}</span>${p.branch ? ` <span class="p-br">(${esc(p.branch)})</span>` : ''} <span class="p-d">$</span>`;
}
function updatePrompt() { q('#term-prompt').innerHTML = promptHtml(); }
function out() { return q('#term-out'); }
function scrollOut() { const o = out(); o.scrollTop = o.scrollHeight; }
function sysLine(html, cls) { out().insertAdjacentHTML('beforeend', `<div class="sysline ${cls || ''}">${html}</div>`); scrollOut(); }
function printResult(line, res, p0) {
  if (res.clear) { out().innerHTML = ''; return; }
  let h = `<div class="blk"><div class="cmdline">${p0}<span class="ct">${esc(line)}</span></div>`;
  if (res.lines) h += `<pre class="res${res.ok ? '' : ' bad'}">${ansi(res.lines)}</pre>`;
  if (res.tip && S.opts.tips) h += `<div class="tip"><b>Tip</b><span>${esc(res.tip)}</span></div>`;
  h += '</div>';
  out().insertAdjacentHTML('beforeend', h); scrollOut();
}
function submit(line) {
  const text = line.trim(); if (!text) return;
  const p0 = promptHtml();
  S.hist.push(text); S.histIdx = S.hist.length;
  const res = ws.run(text);
  printResult(text, res, p0);
  if (res.editor) openEditorFor(res);
  updatePrompt();
}
function openEditorFor(res) {
  const isCommit = res.editor.kind === 'commit';
  U.editor({
    title: res.editor.title, text: res.editor.text, hint: res.editor.hint, saveLabel: isCommit ? 'Save and commit' : 'Save',
    onSave: text => {
      const r2 = ws.term.finishEditor(res, text); ws.last = r2; ws.emit(r2, 'run');
      if (isCommit) printResult('(editor saved) ' + res.cmd, r2, promptHtml());
      else sysLine('saved <b>' + esc(res.editor.file) + '</b> in the working directory');
      updatePrompt();
    },
    onCancel: () => {
      if (isCommit) { const r2 = ws.term.finishEditor(res, ''); ws.last = r2; ws.emit(r2, 'run'); printResult('(editor closed without a message)', r2, promptHtml()); updatePrompt(); }
    }
  });
}
function bindTerminal() {
  const input = q('#term-cmd');
  q('#term-form').addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; submit(v); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { if (S.hist.length) { S.histIdx = Math.max(0, (S.histIdx == null ? S.hist.length : S.histIdx) - 1); input.value = S.hist[S.histIdx] || ''; } e.preventDefault(); }
    else if (e.key === 'ArrowDown') { if (S.histIdx != null) { S.histIdx = Math.min(S.hist.length, S.histIdx + 1); input.value = S.hist[S.histIdx] || ''; } e.preventDefault(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const c = ws.term.complete(input.value);
      input.value = c.text;
      if (c.options.length) sysLine(c.options.map(esc).join('&nbsp;&nbsp;'), 'dim');
    } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out().innerHTML = ''; }
  });
  q('.term').addEventListener('click', e => { if (!getSelection().toString() && !e.target.closest('button,a,input')) input.focus(); });
  q('#term-clear').addEventListener('click', () => { out().innerHTML = ''; input.focus(); });
}

/* ------------------------------------------------------------------ guide */
function stepList() { return S.group === 'core' ? GS.steps : GS.bonus; }
function labEnv() { return GS.labState(ws.sim, ws.term); }
function updateDone() {
  const e = labEnv(); const fresh = [];
  for (const st of GS.steps.concat(GS.bonus)) {
    let d = false; try { d = !!st.done(e); } catch (err) { d = false; }
    if (d && !S.done.has(st.id)) { S.done.add(st.id); fresh.push(st.id); }
  }
  return fresh;
}
function chip(cmd, extraCls) {
  return `<span class="cmdchip ${extraCls || ''}"><button type="button" class="fill" data-fill="${esc(cmd)}" title="Put in the terminal"><code>${esc(cmd)}</code></button><button type="button" class="go" data-run="${esc(cmd)}" aria-label="Run: ${esc(cmd)}">Run</button></span>`;
}
function renderGuide() {
  const el = q('#lab-guide'); const list = stepList();
  if (S.step >= list.length) S.step = list.length - 1;
  const st = list[S.step]; const core = S.group === 'core';
  const done = S.done.has(st.id);
  const coreDone = GS.steps.filter(s => S.done.has(s.id)).length;
  const dots = list.map((s, i) => `<button type="button" class="dot${S.done.has(s.id) ? ' done' : ''}${i === S.step ? ' cur' : ''}" data-step="${i}" title="${esc((core ? (i + 1) + '. ' : '') + s.title)}" aria-label="Step ${i + 1}: ${esc(s.title)}${S.done.has(s.id) ? ' (done)' : ''}"></button>`).join('');
  const edits = (st.edits || (st.edit ? [st.edit] : []));
  el.innerHTML = `<div class="guide-h">
      <div class="seg" role="tablist" aria-label="Guide sections">
        <button type="button" data-grp="core" class="${core ? 'on' : ''}">Lab <span>${coreDone}/${GS.steps.length}</span></button>
        <button type="button" data-grp="bonus" class="${core ? '' : 'on'}">Go further</button>
      </div>
      <div class="dots" role="group" aria-label="Steps">${dots}</div>
    </div>
    <div class="guide-b">
      <p class="g-kicker">${core ? 'Step ' + (S.step + 1) + ' of ' + list.length : esc(st.tag || 'Extra') + ' · extra ' + (S.step + 1) + ' of ' + list.length}${done ? ' <span class="g-done">done</span>' : ''}</p>
      <h3>${esc(st.title)}</h3>
      <p class="g-goal">${esc(st.goal)}</p>
      <div class="g-row"><span class="g-l">Type</span><div class="g-chips">${st.cmds.map(c => chip(c)).join('')}</div></div>
      ${st.peek ? `<div class="g-row"><span class="g-l">Peek inside</span><div class="g-chips">${st.peek.map(c => chip(c, 'peek')).join('')}</div></div>` : ''}
      ${edits.length ? `<div class="g-row"><span class="g-l">Edit</span><div class="g-chips">${edits.map(k => `<button type="button" class="edit-btn" data-edit-key="${k}"><span>${esc(GS.edits[k].label)}</span><code>${esc(GS.edits[k].file)}</code></button>`).join('')}<span class="mini">or type <code>nano ${esc(GS.edits[edits[0]].file)}</code></span></div></div>` : ''}
      <div class="g-watch"><b>Watch for</b><span>${esc(st.watch)}</span></div>
      ${st.predict ? `<div class="g-pred"><button type="button" data-reveal="p-${st.id}" aria-expanded="${!!S.reveal['p-' + st.id]}"><b>Predict first</b> ${esc(st.predict.q)}</button>${S.reveal['p-' + st.id] ? `<p>${esc(st.predict.a)}</p>` : ''}</div>` : ''}
      <div class="g-why"><button type="button" data-reveal="w-${st.id}" aria-expanded="${!!S.reveal['w-' + st.id]}">Why it works</button>${S.reveal['w-' + st.id] ? `<p>${esc(st.why)}</p>` : ''}</div>
      <div class="g-foot">
        <button type="button" class="btn" data-prev ${S.step === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" class="btn ${done ? 'primary pulse' : ''}" data-next ${S.step >= list.length - 1 ? 'disabled' : ''}>${done ? 'Next step' : 'Skip to next'}</button>
        <button type="button" class="linkbtn" data-setup>${Lab.confirmSetup ? 'Click again: this resets the repository' : 'Set up the repository for this step'}</button>
      </div>
    </div>`;
}
function bindGuide() {
  const el = q('#lab-guide');
  el.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.fill != null) { const i = q('#term-cmd'); i.value = t.dataset.fill; i.focus(); return; }
    if (t.dataset.run != null) { submit(t.dataset.run); q('#term-cmd').focus(); return; }
    if (t.dataset.editKey) { const r = ws.edit(t.dataset.editKey); if (r) { sysLine('edited <b>' + esc(GS.edits[t.dataset.editKey].file) + '</b>: ' + esc(GS.edits[t.dataset.editKey].label.toLowerCase()) + '. Try <code>git status</code> and <code>git diff</code>.'); } else sysLine('That edit is already in the file (or the file is missing).', 'dim'); return; }
    if (t.dataset.grp) { S.group = t.dataset.grp; S.step = S.group === 'core' ? firstTodo(GS.steps) : 0; renderGuide(); save(); return; }
    if (t.dataset.step != null) { S.step = +t.dataset.step; renderGuide(); save(); return; }
    if (t.dataset.reveal) { S.reveal[t.dataset.reveal] = !S.reveal[t.dataset.reveal]; renderGuide(); return; }
    if ('prev' in t.dataset) { S.step = Math.max(0, S.step - 1); renderGuide(); save(); return; }
    if ('next' in t.dataset) { S.step = Math.min(stepList().length - 1, S.step + 1); renderGuide(); save(); return; }
    if ('setup' in t.dataset) {
      if (!Lab.confirmSetup) { Lab.confirmSetup = true; renderGuide(); clearTimeout(Lab._ct); Lab._ct = setTimeout(() => { Lab.confirmSetup = false; renderGuide(); }, 3500); return; }
      Lab.confirmSetup = false; setupTo(S.group, S.step);
    }
  });
}
function firstTodo(list) { const i = list.findIndex(s => !S.done.has(s.id)); return i < 0 ? list.length - 1 : i; }

/* Rebuild the repository exactly as it would be at the start of a step. */
function setupTo(group, idx) {
  ws.restart(); ws.term.log = []; S.done = new Set(); S.hist = [];
  const n = group === 'core' ? idx : GS.steps.length;
  ws.quiet++;
  const ran = [];
  for (let i = 0; i < n; i++) {
    for (const item of GS.steps[i].solve) { GS.runSolveItem(ws.sim, ws.term, item); ran.push(typeof item === 'string' ? item : '# ' + GS.edits[item.edit].label); }
    updateDone(); // some steps are only true at the moment they are finished (for example "on the feature branch")
  }
  ws.quiet--;
  ws.emit(null, 'reset');
  updateDone();
  out().innerHTML = '';
  sysLine(ran.length ? 'Repository set up for <b>' + (group === 'core' ? 'step ' + (idx + 1) : 'the extra steps') + '</b>. Commands replayed:<br><code>' + ran.map(esc).join('</code><br><code>') + '</code>' : 'Repository reset to the empty starting folder.', 'dim');
  S.step = group === 'core' ? idx : S.step; S.group = group;
  afterChange(); updatePrompt(); q('#term-cmd').focus();
}

/* ------------------------------------------------------------------ panes */
function showTab(name) {
  S.tab = name;
  $$('#lab-tabs button', root).forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('.pane', root).forEach(p => { p.hidden = p.dataset.pane !== name; });
  if (name === 'obs') renderObs(); if (name === 'assess') renderAssess();
  save();
}
const clip = (t, n) => { const l = t.split('\n'); return l.slice(0, n).join('\n') + (l.length > n ? '\n…' : ''); };
function renderObs() {
  const pane = q('[data-pane="obs"]');
  if (document.activeElement && document.activeElement.tagName === 'TEXTAREA' && pane.contains(document.activeElement)) return;
  const log = ws.term.log;
  pane.innerHTML = `<p class="pane-intro">Run each command in the terminal and the output is captured here. Write what you notice in your own words; reveal a model observation to compare.</p>
    <div class="obs">${GS.observations.map(o => {
      const hit = log.slice().reverse().find(l => l.ok && o.match.test(l.cmd.trim()));
      const rev = S.reveal['o-' + o.key];
      return `<div class="obs-row"><div class="obs-op"><b>${esc(o.op)}</b><code>${esc(o.cmd)}</code>${hit ? '<span class="chip same">captured</span>' : '<span class="chip unt">not run yet</span>'}</div>
        <div class="obs-cap">${hit ? `<code class="obs-c">$ ${esc(hit.cmd)}</code><pre>${esc(clip(hit.out || '(no output)', 8))}</pre>` : '<p class="mini">Nothing captured yet.</p>'}</div>
        <div class="obs-mine"><label for="note-${o.key}">Your observation</label><textarea id="note-${o.key}" data-note="${o.key}" rows="2" placeholder="What did Git print? What changed in the three places?">${esc(S.notes[o.key] || '')}</textarea>
        <button type="button" class="linkbtn" data-reveal="o-${o.key}">${rev ? 'Hide model observation' : 'Show a model observation'}</button>${rev ? `<p class="model">${esc(o.model)}</p>` : ''}</div></div>`;
    }).join('')}</div>`;
}
function assessResults() {
  const e = labEnv();
  return GS.assessment.map(a => { let ok = false; try { ok = !!a.test(ws.sim, e); } catch (err) { ok = false; } return { a, ok }; });
}
function renderAssess() {
  const pane = q('[data-pane="assess"]');
  if (document.activeElement && document.activeElement.tagName === 'INPUT' && pane.contains(document.activeElement)) return;
  const rs = assessResults(); const n = rs.filter(r => r.ok).length;
  pane.innerHTML = `<p class="pane-intro">The skill assessment asks for a responsive "My Full Stack Project" page and a Git history with two commits, a feature branch and a merge. This checklist reads your actual repository.</p>
    <div class="assess-sum"><b>${n} of ${rs.length}</b> checks pass<div class="bar"><i style="width:${Math.round(n / rs.length * 100)}%"></i></div></div>
    <ul class="checks">${rs.map(r => `<li class="${r.ok ? 'ok' : ''}"><span class="tick" aria-hidden="true">${r.ok ? '✓' : ''}</span><div><b>${esc(r.a.text)}</b><span>${esc(r.a.how)}</span></div></li>`).join('')}</ul>
    <div class="assess-ev"><label for="ev-name">Your name (printed on the evidence)</label><input id="ev-name" type="text" value="${esc(S.name || '')}" placeholder="Student name and USN"><button type="button" class="btn primary" data-evidence>Open evidence to copy</button></div>`;
}
function renderCheat() {
  const pane = q('[data-pane="cheat"]');
  pane.innerHTML = `<p class="pane-intro">Click a command to put it in the terminal.</p><div class="cheat">${GS.cheat.map(g => `<div class="cheat-g"><h4>${esc(g.head)}</h4>${g.items.map(c => `<button type="button" class="cmdchip solo" data-fill="${esc(c)}"><code>${esc(c)}</code></button>`).join('')}</div>`).join('')}</div>
    <h4 class="sub-h">Which undo command is safe?</h4>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Command</th><th>Changes the index?</th><th>Changes your files?</th><th>Reversible?</th></tr></thead><tbody>${GS.undoTable.map(r => `<tr class="${r.safe === true ? 'safe' : r.safe === false ? 'risk' : ''}"><td><code>${esc(r.cmd)}</code></td><td>${esc(r.index)}</td><td>${esc(r.files)}</td><td>${esc(r.rev)}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindPanes() {
  root.addEventListener('click', e => {
    const tab = e.target.closest('#lab-tabs button'); if (tab) { showTab(tab.dataset.tab); return; }
    const pane = e.target.closest('.pane'); if (!pane) return;
    const f = e.target.closest('[data-fill]'); if (f && pane.dataset.pane === 'cheat') { const i = q('#term-cmd'); i.value = f.dataset.fill; i.focus(); return; }
    const rv = e.target.closest('[data-reveal]'); if (rv) { S.reveal[rv.dataset.reveal] = !S.reveal[rv.dataset.reveal]; renderObs(); save(); return; }
    if (e.target.closest('[data-evidence]')) showEvidence();
  });
  root.addEventListener('input', e => {
    if (e.target.matches('[data-note]')) { S.notes[e.target.dataset.note] = e.target.value; save(); }
    if (e.target.id === 'ev-name') { S.name = e.target.value; save(); }
  });
}

/* ------------------------------------------------------------------ evidence */
function evidenceText() {
  const sim = ws.sim; const line = '='.repeat(60);
  const rs = assessResults();
  let log = '(no commits yet)'; let graphTxt = log;
  if (sim.s.git && sim.headHash()) {
    log = GS.stripAnsi(GS.git.log(sim, ['--oneline'], { r: {} }));
    graphTxt = GS.stripAnsi(GS.git.log(sim, ['--oneline', '--graph', '--all'], { r: {} }));
  }
  const cmds = ws.term.log.filter(l => l.sub !== 'edit');
  return [
    'GIT LAB EVIDENCE', line,
    'Name: ' + (S.name || '(not entered)'),
    'Date: ' + GS.gitDate(Math.floor(Date.now() / 1000), -new Date().getTimezoneOffset()),
    'Project: My Full Stack Project (simulated repository)',
    '', '$ git log --oneline', log,
    '', '$ git log --oneline --graph --all', graphTxt,
    '', 'ASSESSMENT CHECKLIST', ...rs.map(r => (r.ok ? '[x] ' : '[ ] ') + r.a.text),
    '', 'COMMAND HISTORY (' + cmds.length + ' commands)', line,
    ...cmds.map(l => '$ ' + l.cmd + (l.out ? '\n' + l.out : '')),
    '', 'index.html and style.css as they are now are in the working directory of the simulator.'
  ].join('\n');
}
function showEvidence() { U.showText({ title: 'Evidence of your Git history', text: evidenceText(), note: 'Copy this into your submission. It lists your commits, your checklist and every command you ran.' }); }

/* ------------------------------------------------------------------ file editor + options */
function openFileEditor(path) {
  U.editor({ title: path, text: ws.sim.s.fs[path] !== undefined ? ws.sim.s.fs[path] : '', hint: 'Edit the file, then Save. The change lives only in your working directory until you git add it.', saveLabel: 'Save', onSave: text => { ws.write(path, text); sysLine('saved <b>' + esc(path) + '</b>. Try <code>git status</code>.'); } });
}
function newFile() {
  U.editor({ title: 'New file', nameField: true, text: '', hint: 'Give the file a name, add some content, and save. It starts out untracked.', saveLabel: 'Create file', onSave: (text, name) => { name = GS.normPath(name || ''); if (!name || name.startsWith('.git')) { U.toast('Choose a file name that is not inside .git'); return; } ws.write(name, text); sysLine('created <b>' + esc(name) + '</b>. Try <code>git status</code>.'); } });
}
function afterChange() {
  const fresh = updateDone();
  const cur = stepList()[S.step];
  if (fresh.includes(cur.id)) U.toast('Step complete: ' + cur.title);
  renderGuide();
  if (!q('[data-pane="obs"]').hidden) renderObs();
  if (!q('[data-pane="assess"]').hidden) renderAssess();
  Lab.app.setProgress(GS.steps.filter(s => S.done.has(s.id)).length, GS.steps.length);
  save();
}

/* ------------------------------------------------------------------ public API */
Lab.mount = function (el, app) {
  root = el; Lab.app = app;
  const saved = U.store.get(KEY, null);
  S = Object.assign({ step: 0, group: 'core', done: [], tab: 'git', notes: {}, reveal: {}, opts: { tips: true, identity: true, preview: false }, hist: [], name: '' }, (saved && saved.ui) || {});
  S.done = new Set(S.done); S.histIdx = S.hist.length;
  ws = Lab.ws = new U.Workspace({ identity: saved ? saved.identity !== false : true, state: saved && saved.sim ? saved.sim : undefined });
  if (saved && saved.log) ws.term.log = saved.log;
  root.innerHTML = TEMPLATE;
  areas = new U.AreasView(q('#lab-areas'), ws, { editable: true, preview: true, happened: true, onEdit: openFileEditor, onNewFile: newFile, previewOn: S.opts.preview, onPreviewToggle: on => { S.opts.preview = on; save(); } });
  if (S.opts.preview) areas.togglePreview(true);
  graph = new U.GraphView(q('#lab-graph'), ws, { detail: true, onOpen: h => { showTab('objects'); inspObj.select({ kind: 'obj', hash: h }); } });
  inspGit = new U.InspectView(q('[data-pane="git"]'), ws, { mode: 'git' });
  inspObj = new U.InspectView(q('[data-obj-view]'), ws, { mode: 'objects' });
  new U.HashPlayground(q('[data-hash]'), ws);
  renderCheat(); bindTerminal(); bindGuide(); bindPanes();
  q('#opt-tips').checked = S.opts.tips; q('#opt-identity').checked = S.opts.identity;
  q('#opt-tips').addEventListener('change', e => { S.opts.tips = e.target.checked; save(); });
  q('#opt-identity').addEventListener('change', e => {
    S.opts.identity = e.target.checked; ws.identity = e.target.checked;
    const g = ws.sim.s.global;
    if (e.target.checked) { g['user.name'] = g['user.name'] || 'Student'; g['user.email'] = g['user.email'] || 'student@example.com'; } else { delete g['user.name']; delete g['user.email']; if (ws.sim.s.git) { delete ws.sim.s.git.config['user.name']; delete ws.sim.s.git.config['user.email']; } }
    save();
  });
  let resetArmed = false;
  q('#lab-reset').addEventListener('click', e => {
    const b = e.currentTarget;
    if (!resetArmed) { resetArmed = true; b.textContent = 'Click again to wipe everything'; setTimeout(() => { resetArmed = false; b.textContent = 'Reset lab'; }, 3500); return; }
    resetArmed = false; b.textContent = 'Reset lab';
    S.opts.identity = q('#opt-identity').checked;
    ws.identity = S.opts.identity; ws.restart(); ws.term.log = []; S.done = new Set(); S.hist = []; S.step = 0; S.group = 'core'; S.notes = {}; S.reveal = {};
    out().innerHTML = ''; sysLine('Lab reset. The folder has index.html and style.css and no repository.', 'dim');
    afterChange(); updatePrompt();
  });
  q('#lab-evidence').addEventListener('click', showEvidence);
  document.addEventListener('click', e => { const d = q('.opts'); if (d && d.open && !d.contains(e.target)) d.open = false; });
  ws.on((res, kind) => { if (kind === 'run' || kind === 'edit') afterChange(); updatePrompt(); });
  // restore a short transcript so a refresh does not lose context
  const tail = ws.term.log.filter(l => l.sub !== 'edit').slice(-12);
  if (tail.length) { sysLine('Session restored. Last commands:', 'dim'); tail.forEach(l => out().insertAdjacentHTML('beforeend', `<div class="blk"><div class="cmdline"><span class="p-d">$</span><span class="ct">${esc(l.cmd)}</span></div>${l.raw ? `<pre class="res${l.ok ? '' : ' bad'}">${ansi(l.raw)}</pre>` : ''}</div>`)); }
  else sysLine('Welcome. This is a pretend lab PC with Git installed and a folder called <b>my-project</b> holding index.html and style.css. Start with step 1.', 'dim');
  updateDone();
  if (S.step === 0 && S.done.size === 0) S.step = 0; else if (!S.done.has(stepList()[S.step].id) && S.group === 'core') { /* keep user's place */ }
  showTab(S.tab || 'git'); renderGuide(); updatePrompt(); scrollOut();
  Lab.app.setProgress(GS.steps.filter(s => S.done.has(s.id)).length, GS.steps.length);
};
Lab.focus = () => { let fine = true; try { fine = window.matchMedia('(pointer: fine)').matches; } catch (e) { fine = true; } const i = root && q('#term-cmd'); if (i && fine) i.focus({ preventScroll: true }); };
Lab.send = (cmd, run) => { const i = q('#term-cmd'); i.value = cmd; if (run) { i.value = ''; submit(cmd); } i.focus({ preventScroll: true }); };
Lab.openStep = (id, setup) => {
  let gi = GS.steps.findIndex(s => s.id === id), group = 'core';
  if (gi < 0) { gi = GS.bonus.findIndex(s => s.id === id); group = 'bonus'; }
  if (gi < 0) return;
  if (setup) setupTo(group, gi); else { S.group = group; S.step = gi; renderGuide(); save(); }
};
Lab.progress = () => ({ done: GS.steps.filter(s => S.done.has(s.id)).length, total: GS.steps.length });
Lab.nextTodo = () => { const i = GS.steps.findIndex(s => !S.done.has(s.id)); return i < 0 ? null : { index: i, step: GS.steps[i] }; };
})(GS);
