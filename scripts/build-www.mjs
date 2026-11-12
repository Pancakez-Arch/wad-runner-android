// Assembles www/ (Capacitor's webDir) from:
//   site/            the imported website (unchanged copy of ~/wad-runner)
//   build/engine/    engine compiled from engine/ (npm run build-engine), if present
//   build/freedoom/  Freedoom IWADs + licence (npm run fetch-freedoom), if present
//   app/             the Android app layer (WAD library, touch stick, gamepad, lifecycle)
// index.html gets a few small, checked patches so the site defers to the app layer.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const www = join(root, 'www');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repoUrl = (pkg.repository && (pkg.repository.url || pkg.repository)) || '';

rmSync(www, { recursive: true, force: true });
mkdirSync(www);

// 1. Website
cpSync(join(root, 'site'), www, { recursive: true });
for (const f of ['sw.js', 'manifest.webmanifest', 'doomgeneric_web.c']) rmSync(join(www, f), { force: true });

// 2. Engine built from source (GPL: the shipped binary matches engine/)
const engineDir = join(root, 'build/engine');
if (existsSync(join(engineDir, 'doomgeneric.wasm'))) {
  for (const f of ['doomgeneric.js', 'doomgeneric.wasm']) cpSync(join(engineDir, f), join(www, f));
  console.log('Engine: built from engine/ sources');
} else if (process.env.CI) {
  throw new Error('build/engine missing: run `npm run build-engine` first');
} else {
  console.warn('Engine: using the prebuilt copy from site/ (no background pause). Run `npm run build-engine` to build from source.');
}

// 3. Freedoom (BSD-3-Clause, redistributable)
const bundled = [];
const fd = join(root, 'build/freedoom');
if (existsSync(join(fd, 'freedoom1.wad'))) {
  mkdirSync(join(www, 'freedoom'));
  for (const [file, title] of [['freedoom1.wad', 'Freedoom: Phase 1'], ['freedoom2.wad', 'Freedoom: Phase 2']]) {
    cpSync(join(fd, file), join(www, 'freedoom', file));
    bundled.push({ key: file, name: file, title, kind: 'IWAD', bundled: true,
      size: statSync(join(fd, file)).size, url: `freedoom/${file}` });
  }
  mkdirSync(join(www, 'licenses'), { recursive: true });
  for (const f of ['COPYING.txt', 'CREDITS.txt', 'CREDITS-MUSIC.txt']) cpSync(join(fd, f), join(www, 'licenses', `freedoom-${f}`));
  console.log('Freedoom: bundled');
} else if (process.env.CI) {
  throw new Error('build/freedoom missing: run `npm run fetch-freedoom` first');
} else {
  console.warn('Freedoom: not found, app ships with no WAD');
}

// 4. App layer + licence notices
cpSync(join(root, 'app'), www, { recursive: true });
mkdirSync(join(www, 'licenses'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(www, 'licenses', 'GPL-2.0.txt'));
cpSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(www, 'licenses', 'THIRD_PARTY_NOTICES.txt'));

// 5. Patch index.html. Each patch must match exactly once, or the build fails.
const indexPath = join(www, 'index.html');
let html = readFileSync(indexPath, 'utf8');
function patch(name, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`index.html patch "${name}": expected 1 match, found ${n}. Did the site change?`);
  html = html.replace(find, replace);
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
patch('app css', '</head>', '<link rel="stylesheet" href="app.css">\n</head>');
patch('app flag + bundled list', '\n<script>\n(() => {',
  `\n<script>window.WADRUNNER_APP = true; window.WADRUNNER_BUNDLED = ${JSON.stringify(bundled)};</script>\n<script>\n(() => {`);
patch('app script', '</script>\n</body>', '</script>\n<script src="app.js"></script>\n</body>');
// The app keeps its own WAD library, so the site's single "remembered WAD" is off.
patch('no remember', 'async function remember() {', 'async function remember() { if (window.WADRUNNER_APP) return;');
patch('no restore', "const saved = await store.get('iwad');", "const saved = window.WADRUNNER_APP ? null : await store.get('iwad');");
// Assets are bundled in the APK: no service worker; always use the fullscreen app layout.
patch('no service worker', "if ('serviceWorker' in navigator && window.isSecureContext) {",
  "if (!window.WADRUNNER_APP && 'serviceWorker' in navigator && window.isSecureContext) {");
patch('standalone', 'const standalone = matchMedia(', 'const standalone = !!window.WADRUNNER_APP || matchMedia(');
// Tell the app layer when a game starts / stops.
patch('playing event', '          playing = true;\n', "          playing = true;\n          document.dispatchEvent(new Event('wad:playing'));\n");
patch('stopped event', 'function stopGame(msg) {\n', "function stopGame(msg) {\n    document.dispatchEvent(new Event('wad:stopped'));\n");
patch('subtitle', 'in your browser with your own IWAD. Files never leave your device.',
  'with your own WAD files. Everything stays on this phone.');
patch('footer', 'No game data is included.',
  'No commercial game data is included.' +
  (bundled.length ? ' Includes <a href="licenses/freedoom-COPYING.txt">Freedoom</a> (BSD licence, ' +
    '<a href="licenses/freedoom-CREDITS.txt">credits</a>).' : '') +
  ' <a href="licenses/THIRD_PARTY_NOTICES.txt">Licences</a>.' +
  (repoUrl ? ` Source code: <a href="${esc(repoUrl.replace(/^git\+/, '').replace(/\.git$/, ''))}">${esc(repoUrl.replace(/^git\+/, '').replace(/\.git$/, ''))}</a>.` : ''));
writeFileSync(indexPath, html);
console.log(`www/ ready (${bundled.length} bundled WADs)`);
