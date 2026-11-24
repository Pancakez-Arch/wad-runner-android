// Engine plugins for the WAD Runner Android app layer. Loaded before app.js.
// An engine describes what files it accepts, how its library is shaped, its key
// codes and gamepad map, how input and pause reach it, and where it saves.
// Plugin #1 is Doom (doomgeneric); every Module._dg_* / Module.SDL2 access lives here.
(() => {
  'use strict';

  const doom = (() => {
    const keys = {
      up: 0xad, down: 0xaf, left: 0xac, right: 0xae, strafeL: 0xa0, strafeR: 0xa1,
      fire: 0xa3, use: 0xa2, run: 0x80 + 0x36, esc: 27, enter: 13, tab: 9, back: 0x7f, yes: 121,
    };
    // Reads window.Module on every call: it appears late, never cache it.
    const ready = () => !!(window.Module && typeof Module._dg_push_key === 'function');
    // Several inputs (stick, buttons, gamepad) may hold the same key; count holders.
    const holders = new Map();
    function hold(key, down) {
      if (!ready()) return;
      const n = holders.get(key) || 0;
      const next = Math.max(0, n + (down ? 1 : -1));
      holders.set(key, next);
      if (n === 0 && next === 1) Module._dg_push_key(1, key);
      if (n === 1 && next === 0) Module._dg_push_key(0, key);
    }
    function tap(key) {
      if (!ready()) return;
      Module._dg_push_key(1, key);
      setTimeout(() => window.Module && Module._dg_push_key(0, key), 70);
    }
    function releaseAll() {
      for (const [key, n] of holders) if (n > 0 && window.Module) Module._dg_push_key(0, key);
      holders.clear();
    }
    function turn(dx) { if (ready() && dx) Module._dg_push_mouse(0, Math.round(dx)); }
    // Vertical free-look (engine extension): -60 (down) .. +60 (up), 200-line pixels.
    let look = 0;
    function setLook(v) {
      look = Math.max(-60, Math.min(60, v));
      if (window.Module && Module._dg_set_look) Module._dg_set_look(Math.round(look));
    }
    function pause(on) {
      if (window.Module && Module._dg_set_paused) Module._dg_set_paused(on ? 1 : 0);
    }
    const audio = {
      resume() {
        const ctx = window.Module && Module.SDL2 && Module.SDL2.audioContext;
        if (ctx && ctx.state === 'suspended') ctx.resume();
      },
      suspend() {
        const ctx = window.Module && Module.SDL2 && Module.SDL2.audioContext;
        if (ctx && ctx.state === 'running') ctx.suspend();
      },
    };

    // Read the WAD header + lump directory from a Blob without loading it all.
    async function inspect(blob, name) {
      if (/\.(deh|bex)$/i.test(name)) return { kind: 'DEH', title: 'DeHackEd patch' };
      const head = new DataView(await blob.slice(0, 12).arrayBuffer());
      if (head.byteLength < 12) throw new Error('too small to be a WAD');
      const id = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3));
      if (id !== 'IWAD' && id !== 'PWAD') throw new Error('not a WAD file');
      const n = head.getInt32(4, true), off = head.getInt32(8, true);
      if (n < 0 || off < 0 || off + n * 16 > blob.size) throw new Error('WAD directory is corrupt');
      const dir = new Uint8Array(await blob.slice(off, off + n * 16).arrayBuffer());
      const names = new Set();
      for (let i = 0; i < n; i++) {
        let s = '';
        for (let j = 0; j < 8; j++) { const c = dir[i * 16 + 8 + j]; if (!c) break; s += String.fromCharCode(c); }
        names.add(s.toUpperCase());
      }
      if (id === 'PWAD') return { kind: 'PWAD', title: 'Mod (PWAD)' };
      const lower = name.toLowerCase();
      const known = { 'doom2.wad': 'Doom II', 'plutonia.wad': 'Final Doom: Plutonia', 'tnt.wad': 'Final Doom: TNT',
        'freedoom1.wad': 'Freedoom: Phase 1', 'freedoom2.wad': 'Freedoom: Phase 2', 'chex.wad': 'Chex Quest' };
      const title = known[lower] || (names.has('MAP01') ? 'Doom II-format game'
        : names.has('E4M1') ? 'Ultimate Doom' : names.has('E2M1') ? 'Doom (registered)'
        : names.has('E1M1') ? 'Doom (shareware)' : 'IWAD');
      return { kind: 'IWAD', title };
    }

    // Hand the files to the site's own loader (validation + game detection).
    // The Start button stays the site's #start. `base`/`mods` are File objects.
    async function start({ base, mods }) {
      const $ = id => document.getElementById(id);
      const setInputFiles = (input, files) => {
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInputFiles($('iwad'), [base]);
      // The site reads the file asynchronously; wait until it accepts it.
      for (let i = 0; i < 200 && $('start').disabled && !$('info').classList.contains('err'); i++) {
        await new Promise(r => setTimeout(r, 50));
      }
      setInputFiles($('pwads'), mods);
    }

    // Standard mapping: left stick move/strafe, right stick turn + look (click = re-centre), A/RT fire (+Enter in menus),
    // B use (+Backspace in menus), X next weapon, Y "yes", LB/RB strafe, LT run,
    // Back/Select automap, Start menu, D-pad arrows.
    const gamepad = { 0: ['fire', 'enter'], 1: ['use', 'back'], 3: ['yes'], 4: ['strafeL'], 5: ['strafeR'], 6: ['run'], 7: ['fire'],
      8: ['tab'], 9: ['esc'], 12: ['up'], 13: ['down'], 14: ['left'], 15: ['right'] };

    return {
      id: 'doom', name: 'Doom (doomgeneric)',
      accepts: { extensions: ['.wad', '.deh', '.bex'], magic: ['IWAD', 'PWAD'] },   // informational
      library: { base: 'IWAD', mods: ['PWAD', 'DEH'] },                              // one base file + any mods
      inspect, start,
      // Describe-only: the site still owns the IDBFS mount and syncing.
      saves: { dir: name => '/home/web_user/' + name.replace(/\.wad$/i, ''), flushMs: 5000 },
      keys, gamepad, ready, hold, tap, releaseAll, turn, setLook, pause, audio,
      get look() { return look; },
    };
  })();

  window.WADRunnerEngines = { doom };
})();
