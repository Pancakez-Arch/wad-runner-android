// Downloads Freedoom 0.13.0 (BSD-3-Clause, free to redistribute) and extracts
// the two IWADs plus licence/credits into build/freedoom/. Verified by SHA-256.
//   npm run fetch-freedoom
//   FREEDOOM_ZIP=/path/freedoom-0.13.0.zip npm run fetch-freedoom   (use a local copy)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const VERSION = '0.13.0';
const URL = `https://github.com/freedoom/freedoom/releases/download/v${VERSION}/freedoom-${VERSION}.zip`;
const SHA256 = '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59';
const FILES = ['freedoom1.wad', 'freedoom2.wad', 'COPYING.txt', 'CREDITS.txt', 'CREDITS-MUSIC.txt'];

const out = resolve('build/freedoom');
if (FILES.every(f => existsSync(join(out, f)))) {
  console.log('Freedoom already present in build/freedoom');
  process.exit(0);
}

let zip;
if (process.env.FREEDOOM_ZIP) {
  zip = readFileSync(process.env.FREEDOOM_ZIP);
} else {
  console.log(`Downloading ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  zip = Buffer.from(await res.arrayBuffer());
}
const got = createHash('sha256').update(zip).digest('hex');
if (got !== SHA256) throw new Error(`Freedoom zip checksum mismatch: ${got}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const zipPath = join(out, 'freedoom.zip');
writeFileSync(zipPath, zip);
execFileSync('unzip', ['-q', '-j', zipPath, ...FILES.map(f => `freedoom-${VERSION}/${f}`), '-d', out]);
rmSync(zipPath);
console.log(`Freedoom ${VERSION} extracted to build/freedoom`);
