// Copies the WAD Runner website into ./site (committed, so CI can build without
// access to this server). The source folder is never modified.
//   npm run import-site                 (default: ~/wad-runner)
//   SITE_DIR=/path/to/site npm run import-site
import { cpSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const src = resolve(process.env.SITE_DIR || join(homedir(), 'wad-runner'));
const dst = resolve('site');
const SKIP = new Set(['.serve.py']);   // local static server, not part of the app

if (!existsSync(join(src, 'index.html'))) {
  console.error(`No index.html in ${src}`);
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst);
for (const f of readdirSync(src)) {
  if (SKIP.has(f)) continue;
  cpSync(join(src, f), join(dst, f), { recursive: true });
}
console.log(`Imported ${readdirSync(dst).length} files from ${src} into site/`);
