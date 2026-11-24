// Headless test of the NES plugin contract with a FAKE core (no WASM, no browser).
// Run: node scripts/test-nes.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
for (const f of ['app/engines.js', 'app/nes.js']) vm.runInThisContext(readFileSync(f, 'utf8'), { filename: f });
const { WADRunnerEngines, WADRunnerNes } = globalThis;

// ---- fake core with the same nes_* surface ----
function makeFakeCore({ sramSize = 8, loadOk = true } = {}) {
  const mem = new Uint8Array(1 << 20);
  let brk = 1024;
  const alloc = n => { const p = brk; brk += (n + 15) & ~15; return p; };
  const video = alloc(256 * 240 * 4), audioP = alloc(4096), sram = alloc(sramSize || 1);
  const c = {
    HEAPU8: mem, frames: 0, input: 0, loaded: null, audioPending: 0,
    _malloc: alloc, _free() {},
    _nes_init() {},
    _nes_load(p, n) { c.loaded = mem.slice(p, p + n); return loadOk ? 1 : 0; },
    _nes_frame() { c.frames++; c.audioPending = 800; mem[video] = 1; },   // B of the first pixel
    _nes_video_ptr: () => video,
    _nes_audio_ptr: () => audioP,
    _nes_audio_count() { const n = c.audioPending; c.audioPending = 0; return n; },
    _nes_set_input(m) { c.input = m; },
    _nes_sram_ptr: () => sram, _nes_sram_size: () => sramSize,
  };
  return c;
}

const store = new Map();
const events = [];
const pushed = [];
let drawn = 0, entered = 0, left = 0;
const fake = makeFakeCore();
const canvas = { getContext: () => ({ createImageData: () => ({ data: new Uint8ClampedArray(256 * 240 * 4) }), putImageData() { drawn++; } }) };
const timers = [];
const nes = WADRunnerNes.makeNes({
  createCore: async () => fake,
  ui: { enter() { entered++; return canvas; }, leave() { left++; } },
  storage: { get: async k => store.get(k), put: async (k, v) => { store.set(k, v); } },
  audioFactory: () => ({ push: s => pushed.push(s) }),
  emit: n => events.push(n),
  raf: () => 1, caf() {}, now: () => 0,
  timeout: f => timers.push(f),
});
WADRunnerEngines.register(nes);

const header = (prg = 1, size = 16 + prg * 16384) => {
  const b = new Uint8Array(size);
  b.set([0x4e, 0x45, 0x53, 0x1a, prg, 0]);
  return new Blob([b]);
};
const file = (blob, name) => Object.assign(blob, { name });
let passed = 0;
const ok = (name, fn) => Promise.resolve(fn()).then(() => { passed++; console.log('ok  ', name); });

await ok('inspect accepts an iNES file', async () => {
  const info = await nes.inspect(header(), 'Game.NES');
  assert.deepEqual(info, { kind: 'ROM', title: 'Game' });
});
await ok('inspect rejects IWAD, empty, truncated', async () => {
  const iwad = new Blob([new TextEncoder().encode('IWAD' + '\0'.repeat(20))]);
  await assert.rejects(nes.inspect(iwad, 'x.nes'), /iNES/);
  await assert.rejects(nes.inspect(new Blob([]), 'x.nes'), /too small/);
  await assert.rejects(nes.inspect(new Blob([new Uint8Array([0x4e, 0x45, 0x53, 0x1a])]), 'x.nes'), /too small/);
  await assert.rejects(nes.inspect(header(2, 100), 'x.nes'), /truncated/);
});
await ok('pick routes .nes to nes and .wad to doom', async () => {
  assert.equal((await WADRunnerEngines.pick(header(), 'a.nes')).engine.id, 'nes');
  const pwad = new Blob([new Uint8Array([0x50, 0x57, 0x41, 0x44, 0, 0, 0, 0, 12, 0, 0, 0])]);
  const r = await WADRunnerEngines.pick(pwad, 'mod.wad');
  assert.equal(r.engine.id, 'doom');
  assert.equal(r.info.kind, 'PWAD');
  await assert.rejects(WADRunnerEngines.pick(new Blob([new Uint8Array(40)]), 'junk.nes'), /iNES/);
});
await ok('start loads the ROM, enters the UI, fires wad:playing', async () => {
  await nes.start({ base: file(header(), 'Game.nes') });
  assert.equal(fake.loaded.length, 16 + 16384);
  assert.deepEqual([entered, events], [1, ['wad:playing']]);
  assert.equal(nes.ready(), true);
});
await ok('hold counting sets/clears input mask bits', () => {
  const { a, b } = nes.keys;
  nes.hold(a, true); nes.hold(a, true);
  assert.equal(fake.input, 1 << 8);
  nes.hold(a, false);
  assert.equal(fake.input, 1 << 8);
  nes.hold(a, false);
  assert.equal(fake.input, 0);
  nes.hold(b, true);
  assert.equal(fake.input, 1);
  nes.releaseAll();
  assert.equal(fake.input, 0);
  nes.tap(nes.keys.start);
  assert.equal(fake.input, 1 << 3);
  timers.shift()();
  assert.equal(fake.input, 0);
});
await ok('N frames call nes_frame N times, audio is enqueued, video drawn', () => {
  nes.runFrames(5);
  assert.equal(fake.frames, 5);
  assert.equal(pushed.length, 5);
  assert.equal(pushed[0].length, 1600);
  assert.equal(drawn, 1);
});
await ok('SRAM round-trips through the store', async () => {
  new Uint8Array(fake.HEAPU8.buffer, fake._nes_sram_ptr(), 8).set([1, 2, 3, 4, 5, 6, 7, 8]);
  nes.stop();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual([...store.get('game.nes')], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([left, events.at(-1)], [1, 'wad:stopped']);
  assert.equal(nes.ready(), false);
  new Uint8Array(fake.HEAPU8.buffer, fake._nes_sram_ptr(), 8).fill(0);
  await nes.start({ base: file(header(), 'Game.nes') });
  assert.deepEqual([...new Uint8Array(fake.HEAPU8.buffer, fake._nes_sram_ptr(), 8)], [1, 2, 3, 4, 5, 6, 7, 8]);
  nes.back();
  assert.equal(left, 2);
});
await ok('an unsupported mapper fails start and leaves the UI alone', async () => {
  const bad = makeFakeCore({ loadOk: false });
  const n2 = WADRunnerNes.makeNes({ createCore: async () => bad, ui: { enter() { throw new Error('no'); }, leave() {} },
    emit() {}, raf: () => 1, now: () => 0 });
  await assert.rejects(n2.start({ base: file(header(), 'bad.nes') }), /not supported/);
  assert.equal(n2.ready(), false);
});
await ok('doom plugin is unchanged', () => {
  assert.equal(WADRunnerEngines.doom.id, 'doom');
  assert.equal(WADRunnerEngines.doom.keys.fire, 0xa3);
});

console.log(`${passed} tests passed`);
