// Loads the browser sources into a Node vm context so they can be tested without a DOM.
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function load(extra) {
  const dir = path.join(__dirname, '..', 'src');
  const files = ['engine.js', 'git.js', 'shell.js', 'lab.js', 'ui-common.js', 'ui-views.js', 'ui-stories.js', 'ui-pages.js', 'ui-live.js'].filter(f => fs.existsSync(path.join(dir, f)));
  const code = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const sandbox = { console, TextEncoder, Date, Math, JSON, window: { matchMedia: () => ({ matches: false }) } };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;this.GS = GS;', sandbox, { filename: 'bundle.js' });
  return sandbox.GS;
};
