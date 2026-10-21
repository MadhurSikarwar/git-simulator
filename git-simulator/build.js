// Builds the site into single files.  Run: node build.js
//   ../git-from-the-inside-out.html   full document, double-click to open offline
//   dist/artifact.html                fragment for publishing as an Artifact (the host adds the skeleton)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
let JS = ['engine.js', 'git.js', 'shell.js', 'lab.js', 'ui-common.js', 'ui-views.js', 'ui-stories.js', 'ui-lab.js', 'ui-pages.js', 'ui-live.js', 'ui-app.js'].map(src).join('\n;\n');
// The sample web page inside lab.js contains <html>, <head> and <body> tags as plain text. Escape their
// opening brackets so no HTML processor can mistake them for the page's own document tags.
JS = JS.replace(/<(\/?)(html|head|body)\b/gi, '\\x3C$1$2').replace(/<!DOCTYPE/gi, '\\x3C!DOCTYPE');
const CSS = src('style.css');
if (/<\/script/i.test(JS)) throw new Error('script text contains </script>');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'bundle.js'), JS);
const chk = cp.spawnSync(process.execPath, ['--check', path.join(__dirname, 'dist', 'bundle.js')], { encoding: 'utf8' });
if (chk.status !== 0) { console.error(chk.stderr); process.exit(1); }
const TITLE = 'Git, from the inside out';
const DESC = 'An interactive Git lab for a skill session: learn the architecture, then run the whole workflow in a simulated repository with real object hashes.';
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap';
const head = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${DESC}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${CSS}
</style>`;
const body = `<div id="app"></div>
<script>
${JS}
</script>`;
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>
`;
const frag = head + '\n' + body + '\n';
const out = path.join(__dirname, '..', 'git-from-the-inside-out.html');
fs.writeFileSync(out, full);
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), full);
// the live helper and a double-click launcher go next to the site file
fs.copyFileSync(path.join(__dirname, 'server', 'git-watch.js'), path.join(__dirname, '..', 'git-watch.js'));
const BAT = [
  '@echo off', 'setlocal', 'cd /d "%~dp0"', 'title Git, from the inside out',
  'if not exist "git-from-the-inside-out.html" (', '  echo Cannot find git-from-the-inside-out.html next to this file.', '  pause', '  exit /b 1', ')',
  'where node >nul 2>nul', 'if errorlevel 1 goto nonode', 'if not exist "git-watch.js" goto nonode',
  'where git >nul 2>nul', 'if errorlevel 1 echo Note: Git was not found on the PATH. The Live repo page needs it; everything else works.',
  'echo.', 'echo Starting Git, from the inside out. Keep this window open while you use the Live repo page.', 'echo.',
  'node git-watch.js %*', 'echo.', 'echo The website helper has stopped.', 'pause', 'exit /b 0', '',
  ':nonode',
  'echo Node.js was not found, so the Live repo helper cannot start.',
  'echo Opening the website as a plain file instead. Learn, Lab, Reference, Practice and Session all work.',
  'if defined GITSITE_DRY (echo [dry run] would open the site file) else (start "" "%~dp0git-from-the-inside-out.html")',
  'ping -n 5 127.0.0.1 >nul', 'exit /b 0', ''
].join(String.fromCharCode(13, 10));
fs.writeFileSync(path.join(__dirname, '..', 'start-website.bat'), BAT);
try { fs.unlinkSync(path.join(__dirname, '..', 'start-live-git.cmd')); } catch (e) { /* older launcher already gone */ }
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), frag);
console.log('built', out, (full.length / 1024).toFixed(0) + ' KB;', 'artifact fragment', (frag.length / 1024).toFixed(0) + ' KB');
