// WAD Runner Android app layer. Runs after the site's own script and talks to it
// only through the DOM (#iwad/#pwads inputs, #start) and the engine exports
// (Module._dg_push_key / _dg_push_mouse / _dg_set_paused).
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  document.body.classList.add('app');

  // Short launch splash: logo + name, then fade out.
  const splash = document.createElement('div'); splash.id = 'appSplash';
  splash.innerHTML = '<img src="icon-512.png" alt=""><div>Any%</div>';
  document.body.append(splash);
  setTimeout(() => { splash.classList.add('out'); setTimeout(() => splash.remove(), 400); }, 1200);

  // ---------------------------------------------------------------- keys ----
  const K = {
    up: 0xad, down: 0xaf, left: 0xac, right: 0xae, strafeL: 0xa0, strafeR: 0xa1,
    fire: 0xa3, use: 0xa2, run: 0x80 + 0x36, esc: 27, enter: 13, tab: 9, back: 0x7f, yes: 121,
  };
  const engineReady = () => window.Module && typeof Module._dg_push_key === 'function' && playing;
  // Several inputs (stick, buttons, gamepad) may hold the same key; count holders.
  const holders = new Map();
  function hold(key, down) {
    if (!engineReady()) return;
    const n = holders.get(key) || 0;
    const next = Math.max(0, n + (down ? 1 : -1));
    holders.set(key, next);
    if (n === 0 && next === 1) Module._dg_push_key(1, key);
    if (n === 1 && next === 0) Module._dg_push_key(0, key);
  }
  function tap(key) {
    if (!engineReady()) return;
    Module._dg_push_key(1, key);
    setTimeout(() => window.Module && Module._dg_push_key(0, key), 70);
  }
  function releaseAll() {
    for (const [key, n] of holders) if (n > 0 && window.Module) Module._dg_push_key(0, key);
    holders.clear();
  }
  function turn(dx) { if (engineReady() && dx) Module._dg_push_mouse(0, Math.round(dx)); }
  // Vertical free-look (engine extension): -60 (down) .. +60 (up), 200-line pixels.
  let look = 0;
  function setLook(v) {
    look = Math.max(-60, Math.min(60, v));
    if (window.Module && Module._dg_set_look) Module._dg_set_look(Math.round(look));
  }
  function resumeAudio() {
    const ctx = window.Module && Module.SDL2 && Module.SDL2.audioContext;
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function suspendAudio() {
    const ctx = window.Module && Module.SDL2 && Module.SDL2.audioContext;
    if (ctx && ctx.state === 'running') ctx.suspend();
  }

  // Native helper plugin (android/.../GameScreenPlugin.java): keep the screen on.
  const native = window.Capacitor && window.Capacitor.registerPlugin
    ? window.Capacitor.registerPlugin('GameScreen') : null;
  function keepAwake(on) {
    if (native) native.keepAwake({ on }).catch(() => {});
  }

  // ------------------------------------------------------- WAD library ----
  const BUNDLED = window.WADRUNNER_BUNDLED || [];   // injected at build time
  const db = new Promise((resolve, reject) => {
    const r = indexedDB.open('wadlib', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('wads', { keyPath: 'key' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  async function tx(mode, fn) {
    const d = await db;
    return new Promise((resolve, reject) => {
      const t = d.transaction('wads', mode);
      const req = fn(t.objectStore('wads'));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }
  // Metadata only (no file bytes) for the list.
  const listWads = () => tx('readonly', s => s.getAll()).then(all => all.map(({ blob, ...meta }) => meta));
  const getWad = key => tx('readonly', s => s.get(key));
  const putWad = rec => tx('readwrite', s => s.put(rec));
  const delWad = key => tx('readwrite', s => s.delete(key));

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

  const fmtMB = n => (n / 1048576).toFixed(1) + ' MB';
  const SEL_KEY = 'wadrunner.selection';
  let selection = { iwad: null, mods: [] };
  try { selection = { iwad: null, mods: [], ...JSON.parse(localStorage.getItem(SEL_KEY) || '{}') }; } catch (_) {}
  const saveSelection = () => { try { localStorage.setItem(SEL_KEY, JSON.stringify(selection)); } catch (_) {} };

  // Build the library panel inside the site's setup section.
  const panel = document.createElement('div');
  panel.className = 'lib';
  panel.innerHTML = `
    <h2>Your WADs</h2>
    <div class="actions">
      <button id="libImport">Import WADs…</button>
      <span class="hint">Pick one game (IWAD) and any mods. Imported files stay on this phone.</span>
    </div>
    <input type="file" id="libFiles" multiple hidden>
    <ul id="libList"><li class="empty">Loading…</li></ul>
    <p class="busy" id="libBusy" hidden></p>`;
  const setup = $('setup');
  setup.insertBefore(panel, setup.firstChild);
  $('libImport').onclick = () => $('libFiles').click();

  $('libFiles').onchange = async e => {
    const files = [...e.target.files];
    e.target.value = '';
    const busy = $('libBusy');
    busy.hidden = false;
    const errors = [];
    for (const f of files) {
      busy.textContent = `Importing ${f.name} (${fmtMB(f.size)})…`;
      try {
        const info = await inspect(f, f.name);
        // Copy the bytes into app storage; the picked file may not stay readable later.
        const blob = new Blob([await f.arrayBuffer()], { type: 'application/octet-stream' });
        const key = f.name.toLowerCase();
        await putWad({ key, name: f.name, size: f.size, kind: info.kind, title: info.title, added: Date.now(), blob });
        if (info.kind === 'IWAD') selection.iwad = key;
      } catch (err) {
        errors.push(`${f.name}: ${err.message || err}`);
      }
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    busy.textContent = errors.length ? 'Not imported: ' + errors.join('; ') : '';
    busy.hidden = !errors.length;
    saveSelection();
    await render();
    await apply();
  };

  async function render() {
    const ul = $('libList');
    const own = (await listWads()).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'IWAD' ? -1 : 1));
    const items = [
      ...own,
      ...BUNDLED.filter(b => !own.some(o => o.key === b.key)),
    ];
    if (!selection.iwad || !items.some(i => i.key === selection.iwad && i.kind === 'IWAD')) {
      const first = items.find(i => i.kind === 'IWAD');
      selection.iwad = first ? first.key : null;
    }
    selection.mods = selection.mods.filter(m => items.some(i => i.key === m && i.kind !== 'IWAD'));
    ul.innerHTML = '';
    if (!items.length) {
      ul.innerHTML = '<li class="empty">No WADs yet. Tap “Import WADs…” and choose your .wad files.</li>';
      return;
    }
    for (const it of items) {
      const li = document.createElement('li');
      const isIwad = it.kind === 'IWAD';
      const checked = isIwad ? selection.iwad === it.key : selection.mods.includes(it.key);
      if (checked) li.classList.add('sel');
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = isIwad ? 'radio' : 'checkbox';
      input.name = isIwad ? 'iwad' : 'mod';
      input.checked = checked;
      input.onchange = async () => {
        if (isIwad) selection.iwad = it.key;
        else selection.mods = input.checked ? [...selection.mods, it.key] : selection.mods.filter(m => m !== it.key);
        saveSelection();
        await render();
        await apply();
      };
      const text = document.createElement('span');
      const nm = document.createElement('span');
      nm.className = 'name';
      nm.textContent = it.title && isIwad ? it.title : it.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${it.name} · ${fmtMB(it.size)} · ${it.bundled ? 'included with the app' : isIwad ? 'game' : 'mod'}`;
      text.append(nm, meta);
      label.append(input, text);
      li.append(label);
      if (!it.bundled) {
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = 'Delete';
        let armed = false;
        del.onclick = async () => {
          if (!armed) { armed = true; del.textContent = 'Tap again'; setTimeout(() => { armed = false; del.textContent = 'Delete'; }, 3000); return; }
          await delWad(it.key);
          if (selection.iwad === it.key) selection.iwad = null;
          selection.mods = selection.mods.filter(m => m !== it.key);
          saveSelection();
          await render();
          await apply();
        };
        li.append(del);
      }
      ul.append(li);
    }
  }

  async function fileFor(key) {
    const b = BUNDLED.find(x => x.key === key);
    if (b && !(await getWad(key))) {
      const res = await fetch(b.url);
      if (!res.ok) throw new Error(`Could not load ${b.name}`);
      return new File([await res.blob()], b.name);
    }
    const rec = await getWad(key);
    if (!rec) throw new Error('WAD not found');
    return new File([rec.blob], rec.name);
  }
  function setInputFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Hand the selected WADs to the site's own loader (validation + game detection).
  let applying = Promise.resolve();
  function apply() {
    setup.classList.add('applying');   // blocks Start until mods are handed over too
    applying = applying.then(async () => {
      if (!selection.iwad) return;
      const busy = $('libBusy');
      try {
        const iwadFile = await fileFor(selection.iwad);
        setInputFiles($('iwad'), [iwadFile]);
        // The site reads the file asynchronously; wait until it accepts it.
        for (let i = 0; i < 200 && $('start').disabled && !$('info').classList.contains('err'); i++) {
          await new Promise(r => setTimeout(r, 50));
        }
        const mods = [];
        for (const m of selection.mods) mods.push(await fileFor(m));
        setInputFiles($('pwads'), mods);
      } catch (err) {
        busy.hidden = false;
        busy.textContent = String(err.message || err);
      }
    }).finally(() => setup.classList.remove('applying'));
    return applying;
  }
  render().then(apply).catch(err => console.warn(err));

  // ------------------------------------------------- playing / lifecycle ----
  let playing = false;
  const pad = document.createElement('div');
  pad.id = 'appPad';
  pad.hidden = true;
  pad.innerHTML = `
    <div class="zone" id="stickZone"><div class="stick idle" id="stick"><div class="knob" id="knob"></div></div></div>
    <div class="lookzone" id="lookZone"></div>
    <div class="top">
      <button class="b" data-tap="esc">MENU</button>
      <button class="b" data-tap="enter">ENTER</button>
      <button class="b" data-tap="yes">Y</button>
      <button class="b" data-tap="tab">MAP</button>
    </div>
    <button class="b run" id="runBtn">RUN</button>
    <button class="b wpn" id="wpnBtn">WPN</button>
    <button class="b use" data-hold="use">USE</button>
    <button class="b fire" data-hold="fire">FIRE</button>`;
  document.body.append(pad);
  const pauseEl = document.createElement('div');
  pauseEl.id = 'appPause';
  pauseEl.hidden = true;
  pauseEl.innerHTML = 'Paused<small>Tap to continue</small>';
  document.body.append(pauseEl);

  let usingPad = matchMedia('(pointer: coarse)').matches;
  const showPad = () => {
    const wasHidden = pad.hidden;
    pad.hidden = !(playing && usingPad);
    if (wasHidden && !pad.hidden) requestAnimationFrame(() => resetStick());
  };

  document.addEventListener('wad:playing', () => {
    playing = true;
    setLook(0);
    keepAwake(true);
    showPad();
    requestAnimationFrame(resetStick);   // place the stick once the pad has a size
  });
  document.addEventListener('wad:stopped', () => {
    playing = false;
    releaseAll();
    keepAwake(false);
    pad.hidden = true;
    pauseEl.hidden = true;
  });

  // Background: pause the level, stop audio, let the screen sleep.
  let pausedForBackground = false;
  function appPause() {
    if (!playing || pausedForBackground) return;
    releaseAll();
    if (window.Module && Module._dg_set_paused) Module._dg_set_paused(1);
    suspendAudio();
    keepAwake(false);
    pausedForBackground = true;
  }
  function appResume() {
    if (playing && pausedForBackground) pauseEl.hidden = false;   // resume on the next tap (also unlocks audio)
  }
  // Called by MainActivity.onPause/onResume; visibilitychange covers the same in browsers.
  window.wadAppPause = appPause;
  window.wadAppResume = appResume;
  document.addEventListener('visibilitychange', () => (document.hidden ? appPause() : appResume()));
  function continueGame() {
    if (!pausedForBackground) return;
    pausedForBackground = false;
    pauseEl.hidden = true;
    resumeAudio();
    if (window.Module && Module._dg_set_paused) Module._dg_set_paused(0);
    keepAwake(true);
  }
  pauseEl.addEventListener('pointerdown', e => { e.preventDefault(); continueGame(); });

  // Called by MainActivity for the Android back button. true = handled.
  window.wadBack = () => {
    if (!playing) return false;
    if (!pauseEl.hidden) { continueGame(); return true; }
    tap(K.esc);
    return true;
  };

  // Audio needs a user gesture in the WebView: resume on the first touch/key.
  ['pointerdown', 'touchend', 'keydown'].forEach(t => window.addEventListener(t, resumeAudio, { capture: true }));

  // ------------------------------------------------------ touch controls ----
  for (const b of pad.querySelectorAll('[data-hold]')) {
    const key = K[b.dataset.hold];
    let id = null;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      try { b.setPointerCapture(id); } catch (_) {}
      b.classList.add('on');
      hold(key, true);
    });
    const up = e => { if (id === null || e.pointerId !== id) return; id = null; b.classList.remove('on'); hold(key, false); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  }
  for (const b of pad.querySelectorAll('[data-tap]')) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('on'); tap(K[b.dataset.tap]); });
    b.addEventListener('pointerup', () => b.classList.remove('on'));
    b.addEventListener('pointercancel', () => b.classList.remove('on'));
  }
  let running = false;
  $('runBtn').addEventListener('pointerdown', e => {
    e.preventDefault();
    running = !running;
    $('runBtn').classList.toggle('on', running);
    hold(K.run, running);
  });
  let weapon = 1;
  function nextWeapon() { weapon = weapon % 7 + 1; tap(48 + weapon); }
  $('wpnBtn').addEventListener('pointerdown', e => { e.preventDefault(); $('wpnBtn').classList.add('on'); nextWeapon(); });
  $('wpnBtn').addEventListener('pointerup', () => $('wpnBtn').classList.remove('on'));
  for (const b of pad.querySelectorAll('button')) b.addEventListener('contextmenu', e => e.preventDefault());

  // Floating stick (left side): up/down = walk, left/right = strafe. Turning is the right-side swipe.
  const zone = $('stickZone'), stick = $('stick'), knob = $('knob');
  const R = 44;
  let stickId = null, cx = 0, cy = 0, sx = 0, sy = 0;
  let fwd = 0;   // -1 back, 0, 1 forward
  let side = 0;  // -1 strafe left, 0, 1 strafe right
  function setSide(v) {
    if (v === side) return;
    if (side === -1) hold(K.strafeL, false);
    if (side === 1) hold(K.strafeR, false);
    side = v;
    if (side === -1) hold(K.strafeL, true);
    if (side === 1) hold(K.strafeR, true);
  }
  function setFwd(v) {
    if (v === fwd) return;
    if (fwd === 1) hold(K.up, false);
    if (fwd === -1) hold(K.down, false);
    fwd = v;
    if (fwd === 1) hold(K.up, true);
    if (fwd === -1) hold(K.down, true);
  }
  function placeStick(x, y) {
    const r = zone.getBoundingClientRect();
    stick.style.left = (x - r.left) + 'px';
    stick.style.top = (y - r.top) + 'px';
  }
  function resetStick() {
    const r = zone.getBoundingClientRect();
    placeStick(r.left + Math.min(150, r.width / 2), r.bottom - 120);
    knob.style.transform = '';
    stick.classList.add('idle');
  }
  zone.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (stickId !== null) return;
    stickId = e.pointerId;
    try { zone.setPointerCapture(stickId); } catch (_) {}
    cx = e.clientX; cy = e.clientY; sx = sy = 0;
    placeStick(cx, cy);
    stick.classList.remove('idle');
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    sx = dx / R; sy = dy / R;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    setFwd(sy < -0.35 ? 1 : sy > 0.35 ? -1 : 0);
    setSide(sx < -0.35 ? -1 : sx > 0.35 ? 1 : 0);
  });
  const stickUp = e => {
    if (e.pointerId !== stickId) return;
    stickId = null; sx = sy = 0;
    setFwd(0);
    setSide(0);
    resetStick();
  };
  zone.addEventListener('pointerup', stickUp);
  zone.addEventListener('pointercancel', stickUp);
  window.addEventListener('resize', () => { if (stickId === null) resetStick(); });

  // Swipe on the right side to look: sideways = turn, up/down = look up/down.
  // Double-tap there to re-centre the view.
  const lookZone = $('lookZone');
  const TURN_PER_PX = 5;      // ~360° per two screen widths
  const LOOK_PER_PX = 0.35;
  let lookId = null, lx = 0, ly = 0, lastTap = 0;
  lookZone.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (lookId !== null) return;
    lookId = e.pointerId;
    try { lookZone.setPointerCapture(lookId); } catch (_) {}
    lx = e.clientX; ly = e.clientY;
    const now = Date.now();
    if (now - lastTap < 300) setLook(0);
    lastTap = now;
  });
  lookZone.addEventListener('pointermove', e => {
    if (e.pointerId !== lookId) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    turn(dx * TURN_PER_PX);
    if (dy) setLook(look - dy * LOOK_PER_PX);
  });
  const lookUp = e => { if (e.pointerId === lookId) lookId = null; };
  lookZone.addEventListener('pointerup', lookUp);
  lookZone.addEventListener('pointercancel', lookUp);

  // ------------------------------------------------------------ gamepad ----
  // Standard mapping: left stick move/strafe, right stick turn + look (click = re-centre), A/RT fire (+Enter in menus),
  // B use (+Backspace in menus), X next weapon, Y "yes", LB/RB strafe, LT run,
  // Back/Select automap, Start menu, D-pad arrows.
  const GP = { 0: ['fire', 'enter'], 1: ['use', 'back'], 3: ['yes'], 4: ['strafeL'], 5: ['strafeR'], 6: ['run'], 7: ['fire'],
    8: ['tab'], 9: ['esc'], 12: ['up'], 13: ['down'], 14: ['left'], 15: ['right'] };
  const TAP_ONLY = new Set(['enter', 'back', 'yes', 'tab', 'esc']);
  const prevButtons = {};
  const axisKeys = {};
  function axisKey(id, active, key) {
    if (!!axisKeys[id] === active) return;
    axisKeys[id] = active;
    hold(K[key], active);
  }
  function pollGamepads() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    for (const gp of pads) {
      const prev = prevButtons[gp.index] || [];
      gp.buttons.forEach((btn, i) => {
        const down = btn.pressed || btn.value > 0.5;
        if (down === !!prev[i]) return;
        prev[i] = down;
        if (down) { usingPad = false; showPad(); resumeAudio(); }
        if (i === 2 && down) nextWeapon();
        for (const name of GP[i] || []) {
          if (TAP_ONLY.has(name)) { if (down) tap(K[name]); } else hold(K[name], down);
        }
      });
      prevButtons[gp.index] = prev;
      const [ax = 0, ay = 0, rx = 0, ry = 0] = gp.axes;
      axisKey(gp.index + 'f', ay < -0.4, 'up');
      axisKey(gp.index + 'b', ay > 0.4, 'down');
      axisKey(gp.index + 'l', ax < -0.5, 'strafeL');
      axisKey(gp.index + 'r', ax > 0.5, 'strafeR');
      if (Math.abs(rx) > 0.15) turn(Math.sign(rx) * rx * rx * 95);
      if (Math.abs(ry) > 0.2) setLook(look - Math.sign(ry) * ry * ry * 2.5);
      if (gp.buttons[11] && gp.buttons[11].pressed) setLook(0);   // right-stick click re-centres
    }
  }
  window.addEventListener('gamepadconnected', () => { usingPad = false; showPad(); });
  window.addEventListener('touchstart', () => { if (!usingPad) { usingPad = true; showPad(); } }, { passive: true, capture: true });

  // One loop drives gamepad polling.
  function frame() {
    if (playing && pauseEl.hidden) {
      pollGamepads();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  resetStick();
})();
