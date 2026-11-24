// NES engine plugin (plugin #2). Loaded after engines.js and before app.js.
// Runs a libretro fceumm core (compiled to WASM from engine-nes/ + fceumm, see
// scripts/build-nes-core.sh) through the small nes_* glue surface:
//   nes_init() nes_load(ptr,size) nes_frame() nes_video_ptr() nes_audio_ptr()
//   nes_audio_count() nes_set_input(mask) nes_sram_ptr() nes_sram_size()
// The core is its own instance (createNesCore), separate from Doom's global engine object.
// makeNes(env) is a factory so node can inject a fake core (scripts/test-nes.mjs).
(() => {
  'use strict';

  const W = 256, H = 240;
  const FRAME_MS = 1000 / 60.1;
  const MAX_ROM = 4 * 1024 * 1024;
  // libretro joypad ids; the engine "keys" are these ids, the input mask is 1 << id.
  const KEYS = { b: 0, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8 };

  function makeNes(env) {
    const { createCore, ui, storage, audioFactory, emit, raf, caf, now, timeout } = env;
    let core = null, running = false, paused = false, loopId = null;
    let romKey = null, lastSram = null, lastSaveAt = 0, lastT = 0, acc = 0;
    let audio = null, ctx2d = null, img = null;
    const holders = new Map();
    let mask = 0;

    const ready = () => !!core && running;

    function pushMask() { if (core) core._nes_set_input(mask); }
    function hold(key, down) {
      if (!ready() || key === undefined) return;
      const n = holders.get(key) || 0;
      const next = Math.max(0, n + (down ? 1 : -1));
      holders.set(key, next);
      mask = next > 0 ? (mask | (1 << key)) : (mask & ~(1 << key));
      pushMask();
    }
    function tap(key) {
      if (!ready()) return;
      hold(key, true);
      (timeout || setTimeout)(() => hold(key, false), 70);
    }
    function releaseAll() { holders.clear(); mask = 0; pushMask(); }

    async function inspect(blob, name) {
      if (blob.size < 16) throw new Error('too small to be a NES ROM');
      if (blob.size > MAX_ROM) throw new Error('too big to be a NES ROM');
      const h = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      if (h[0] !== 0x4e || h[1] !== 0x45 || h[2] !== 0x53 || h[3] !== 0x1a) throw new Error('not an iNES (.nes) file');
      if (h[4] === 0) throw new Error('NES ROM has no program data');
      if (blob.size < 16 + h[4] * 16384) throw new Error('NES ROM is truncated');
      return { kind: 'ROM', title: name.replace(/\.nes$/i, '') };
    }

    // ---- saves (battery SRAM) ----
    const sramView = () => {
      const n = core._nes_sram_size();
      return n > 0 ? new Uint8Array(core.HEAPU8.buffer, core._nes_sram_ptr(), n) : null;
    };
    async function restoreSram() {
      const v = sramView();
      if (!v || !storage) return;
      const saved = await storage.get(romKey);
      if (saved && saved.length === v.length) v.set(saved);
      lastSram = Uint8Array.from(v);
    }
    async function persistSram(force) {
      if (!core || !storage) return;
      const v = sramView();
      if (!v) return;
      if (!force && lastSram && lastSram.length === v.length && lastSram.every((x, i) => x === v[i])) return;
      lastSram = Uint8Array.from(v);
      await storage.put(romKey, lastSram);
    }

    // ---- frames ----
    function drawVideo() {
      const s = new Uint8Array(core.HEAPU8.buffer, core._nes_video_ptr(), W * H * 4);
      const d = img.data;
      for (let o = 0; o < s.length; o += 4) {   // XRGB8888 little-endian = B,G,R,X
        d[o] = s[o + 2]; d[o + 1] = s[o + 1]; d[o + 2] = s[o]; d[o + 3] = 255;
      }
      ctx2d.putImageData(img, 0, 0);
    }
    function frameOnce() {
      core._nes_frame();
      const n = core._nes_audio_count();
      if (n > 0 && audio) {
        const p = core._nes_audio_ptr();
        audio.push(Int16Array.from(new Int16Array(core.HEAPU8.buffer, p, n * 2)));
      }
    }
    // Test hook and loop body: run n frames, then draw once.
    function runFrames(n) {
      for (let i = 0; i < n; i++) frameOnce();
      if (n > 0 && ctx2d) drawVideo();
    }
    function tick(t) {
      if (!running) return;
      loopId = raf(tick);
      if (paused) return;
      acc += Math.min(t - lastT, FRAME_MS * 3);   // skip catch-up beyond 3 frames
      lastT = t;
      let n = 0;
      while (acc >= FRAME_MS && n < 3) { acc -= FRAME_MS; n++; }
      runFrames(n);
      if (t - lastSaveAt > 5000) { lastSaveAt = t; persistSram(false).catch(() => {}); }
    }

    async function start({ base }) {
      if (running) stop();
      await inspect(base, base.name);
      const bytes = new Uint8Array(await base.arrayBuffer());
      const c = await createCore();
      c._nes_init();
      const ptr = c._malloc(bytes.length);
      c.HEAPU8.set(bytes, ptr);
      const ok = c._nes_load(ptr, bytes.length);
      c._free(ptr);
      if (!ok) throw new Error('This NES ROM is not supported (unknown mapper or bad file)');
      core = c;
      romKey = base.name.toLowerCase();
      await restoreSram();
      audio = audioFactory ? audioFactory() : null;
      holders.clear(); mask = 0; paused = false;
      const canvas = ui.enter();
      ctx2d = canvas.getContext('2d');
      img = ctx2d.createImageData(W, H);
      running = true;
      acc = 0; lastT = now(); lastSaveAt = lastT;
      emit('wad:playing');
      loopId = raf(tick);
    }
    function stop() {
      if (!running) return;
      running = false;
      if (loopId !== null && caf) caf(loopId);
      persistSram(true).catch(() => {});
      if (audio && audio.close) audio.close();
      audio = null;
      const c = core;
      core = null;
      holders.clear(); mask = 0;
      ui.leave();
      emit('wad:stopped');
      return c;
    }
    function pause(on) {
      paused = !!on;
      if (on) persistSram(false).catch(() => {});
      else { lastT = now(); acc = 0; }
    }

    return {
      id: 'nes', name: 'NES (fceumm)',
      accepts: { extensions: ['.nes'], magic: ['NES\x1a'] },
      library: { base: 'ROM', mods: [] },
      label: { import: 'Import ROMs…', hint: 'Pick a .nes game' },
      inspect, start, stop,
      keys: KEYS,
      gamepad: { 0: ['a'], 2: ['b'], 8: ['select'], 9: ['start'], 12: ['up'], 13: ['down'], 14: ['left'], 15: ['right'] },
      pad: [
        { id: 'up', label: '▲', key: 'up', kind: 'hold' }, { id: 'down', label: '▼', key: 'down', kind: 'hold' },
        { id: 'left', label: '◀', key: 'left', kind: 'hold' }, { id: 'right', label: '▶', key: 'right', kind: 'hold' },
        { id: 'select', label: 'SELECT', key: 'select', kind: 'hold' }, { id: 'start', label: 'START', key: 'start', kind: 'hold' },
        { id: 'b', label: 'B', key: 'b', kind: 'hold' }, { id: 'a', label: 'A', key: 'a', kind: 'hold' },
      ],
      saves: { dir: null, flushMs: 5000 },   // battery SRAM in IndexedDB db "nessaves"
      ready, hold, tap, releaseAll,
      turn() {}, setLook() {},
      pause,
      audio: { resume() { if (audio && audio.resume) audio.resume(); }, suspend() { if (audio && audio.suspend) audio.suspend(); } },
      back() { stop(); },
      look: 0,
      runFrames, _mask: () => mask,
    };
  }

  // ---- browser wiring (skipped under node) ----
  function browserNes() {
    const $ = id => document.getElementById(id);
    let script = null;
    const createCore = () => {
      if (!script) {
        script = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'nes_core.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('NES core missing (nes_core.js not bundled in this build)'));
          document.head.append(s);
        });
      }
      return script.then(() => window.createNesCore({ locateFile: f => f }));
    };
    const ui = {
      enter() {
        let c = $('nesCanvas');
        if (!c) {
          c = document.createElement('canvas');
          c.id = 'nesCanvas'; c.width = 256; c.height = 240;
          $('canvas').after(c);
        }
        c.style.display = '';
        $('canvas').style.display = 'none';
        $('setup').style.display = 'none';
        $('game').classList.add('on');
        document.body.classList.add('immersive');
        $('reload').textContent = 'Exit';
        return c;
      },
      leave() {
        const c = $('nesCanvas');
        if (c) c.style.display = 'none';
        $('canvas').style.display = '';
        $('setup').style.display = '';
        $('game').classList.remove('on');
        document.body.classList.remove('immersive');
        $('reload').textContent = 'Change WAD';
      },
    };
    const dbp = () => new Promise((resolve, reject) => {
      const r = indexedDB.open('nessaves', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('sram');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const storage = {
      async get(key) {
        const d = await dbp();
        return new Promise((resolve, reject) => {
          const q = d.transaction('sram').objectStore('sram').get(key);
          q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
        });
      },
      async put(key, bytes) {
        const d = await dbp();
        return new Promise((resolve, reject) => {
          const t = d.transaction('sram', 'readwrite');
          t.objectStore('sram').put(bytes, key);
          t.oncomplete = resolve; t.onerror = () => reject(t.error);
        });
      },
    };
    const audioFactory = () => {
      const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      let next = 0;
      return {
        push(s) {
          const n = s.length / 2;
          const buf = ac.createBuffer(2, n, 48000);
          const l = buf.getChannelData(0), r = buf.getChannelData(1);
          for (let i = 0; i < n; i++) { l[i] = s[2 * i] / 32768; r[i] = s[2 * i + 1] / 32768; }
          const t = Math.max(ac.currentTime + 0.05, next);
          if (t - ac.currentTime > 0.3) return;   // overrun: drop
          const src = ac.createBufferSource();
          src.buffer = buf; src.connect(ac.destination); src.start(t);
          next = t + buf.duration;
        },
        resume() { if (ac.state === 'suspended') ac.resume(); },
        suspend() { if (ac.state === 'running') ac.suspend(); },
        close() { ac.close().catch(() => {}); },
      };
    };
    return makeNes({
      createCore, ui, storage, audioFactory,
      emit: n => document.dispatchEvent(new Event(n)),
      raf: f => requestAnimationFrame(f), caf: id => cancelAnimationFrame(id), now: () => performance.now(),
    });
  }

  window.WADRunnerNes = { makeNes };
  if (typeof document !== 'undefined' && window.WADRunnerEngines && window.WADRunnerEngines.register) {
    window.WADRunnerEngines.register(browserNes());
  }
})();
