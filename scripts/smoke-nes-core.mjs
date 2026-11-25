// Smoke test for the built NES core (build/nes/nes_core.js): proves it exports what app/nes.js needs
// and that a tiny synthetic NROM ROM loads and runs. No real game is used.
// Run after `npm run build-nes-core`: node scripts/smoke-nes-core.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const createNesCore = require(resolve('build/nes/nes_core.js'));   // built with ENVIRONMENT=web,node
const core = await createNesCore();

for (const fn of ['_malloc', '_free', '_nes_init', '_nes_load', '_nes_frame', '_nes_video_ptr', '_nes_audio_ptr',
  '_nes_audio_count', '_nes_set_input', '_nes_sram_ptr', '_nes_sram_size']) {
  assert.equal(typeof core[fn], 'function', `missing export ${fn}`);
}
assert.ok(core.HEAPU8 instanceof Uint8Array, 'HEAPU8 not exported (EXPORTED_RUNTIME_METHODS)');

// iNES: NROM-128, 16 KB PRG (reset vector -> $8000 = JMP $8000), 8 KB CHR, all else zero.
const rom = new Uint8Array(16 + 16384 + 8192);
rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 1]);
rom.set([0x4c, 0x00, 0x80], 16);          // $8000: JMP $8000
rom[16 + 0x3ffc] = 0x00; rom[16 + 0x3ffd] = 0x80;   // reset vector
assert.equal(rom.length, 24592);

assert.equal(core._nes_init(), 1);
const ptr = core._malloc(rom.length);
core.HEAPU8.set(rom, ptr);
assert.equal(core._nes_load(ptr, rom.length), 1, 'nes_load failed on the synthetic ROM');
core._free(ptr);

let audioSeen = false;
for (let i = 0; i < 120; i++) {
  core._nes_frame();
  if (core._nes_audio_count() > 0) audioSeen = true;
}
assert.ok(audioSeen, 'no audio frames in 120 frames');
assert.ok(core._nes_video_ptr() > 0, 'video pointer is null');
core._nes_set_input(1 << 8);
assert.ok(core._nes_sram_size() >= 0);
console.log('NES CORE OK');
