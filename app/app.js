// WAD Runner Android app layer. Runs after the site's own script (which starts the
// game on #start) and engines.js. The engine is reached only through the plugin
// interface (see engines.js); the site is reached through the DOM (#iwad/#pwads, #start).
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  document.body.classList.add('app');
  const logo = document.createElement('img');
  logo.id = 'appLogo'; logo.src = 'icon-192.png'; logo.alt = ''; logo.setAttribute('aria-hidden', 'true');
  document.body.append(logo);

  // Short launch splash: logo + name, then fade out.
  const splash = document.createElement('div'); splash.id = 'appSplash';
  splash.innerHTML = '<img src="icon-512.png" alt=""><div>Any%</div>';
  document.body.append(splash);
  setTimeout(() => { splash.classList.add('out'); setTimeout(() => splash.remove(), 400); }, 1200);

  // -------------------------------------------------------------- engine ----
  let engine = WADRunnerEngines.doom;   // switched by the selected library item (setEngine)
  let K = engine.keys;
  let playing = false;
  const live = () => playing && engine.ready();
  const hold = (key, down) => { if (live()) engine.hold(key, down); };
  const tap = key => { if (live()) engine.tap(key); };
  const turn = dx => { if (live()) engine.turn(dx); };
  const releaseAll = () => engine.releaseAll();
  const setLook = v => engine.setLook(v);
  const resumeAudio = () => engine.audio.resume();
  const suspendAudio = () => engine.audio.suspend();

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

  const isBase = kind => kind === 'IWAD' || kind === 'ROM';   // one base file (game or ROM) is picked
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
      <span class="hint">Pick one game (IWAD) and any mods, or a .nes ROM. Imported files stay on this phone.</span>
    </div>
    <input type="file" id="libFiles" multiple hidden>
    <ul id="libList"><li class="empty">Loading…</li></ul>
    <p class="busy" id="libBusy" hidden></p>
    <button id="nesPlay" hidden>Play NES game</button>`;
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
        const { info } = await WADRunnerEngines.pick(f, f.name);
        // Copy the bytes into app storage; the picked file may not stay readable later.
        const blob = new Blob([await f.arrayBuffer()], { type: 'application/octet-stream' });
        const key = f.name.toLowerCase();
        await putWad({ key, name: f.name, size: f.size, kind: info.kind, title: info.title, added: Date.now(), blob });
        if (isBase(info.kind)) selection.iwad = key;
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

  let lastItems = [];
  const engineForKind = kind => WADRunnerEngines.engines.find(e => e.library.base === kind || e.library.mods.includes(kind)) || WADRunnerEngines.doom;
  function setEngine(e) {
    if (e === engine) return;
    engine.releaseAll();
    engine = e;
    K = e.keys;
    showPad();
  }
  async function render() {
    const ul = $('libList');
    const own = (await listWads()).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : isBase(a.kind) ? -1 : 1));
    const items = [
      ...own,
      ...BUNDLED.filter(b => !own.some(o => o.key === b.key)),
    ];
    lastItems = items;
    if (!selection.iwad || !items.some(i => i.key === selection.iwad && isBase(i.kind))) {
      const first = items.find(i => i.kind === 'IWAD') || items.find(i => isBase(i.kind));
      selection.iwad = first ? first.key : null;
    }
    selection.mods = selection.mods.filter(m => items.some(i => i.key === m && !isBase(i.kind)));
    ul.innerHTML = '';
    if (!items.length) {
      ul.innerHTML = '<li class="empty">No WADs yet. Tap “Import WADs…” and choose your .wad files.</li>';
      return;
    }
    for (const it of items) {
      const li = document.createElement('li');
      const isIwad = isBase(it.kind);
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
      meta.textContent = `${it.name} · ${fmtMB(it.size)} · ${it.bundled ? 'included with the app' : it.kind === 'ROM' ? 'NES game' : isIwad ? 'game' : 'mod'}`;
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
  // Hand the selected WADs to the engine, which feeds the site's own loader (validation + game detection).
  let applying = Promise.resolve();
  function apply() {
    setup.classList.add('applying');   // blocks Start until mods are handed over too
    applying = applying.then(async () => {
      const sel = lastItems.find(i => i.key === selection.iwad);
      const nesEngine = sel && engineForKind(sel.kind);
      const isNes = !!nesEngine && nesEngine.id !== 'doom';
      setEngine(isNes ? nesEngine : WADRunnerEngines.doom);
      setup.classList.toggle('nes-sel', isNes);   // CSS hides the site's Start; #nesPlay starts the ROM
      $('nesPlay').hidden = !isNes;
      if (!selection.iwad || isNes) return;
      const busy = $('libBusy');
      try {
        const base = await fileFor(selection.iwad);
        const mods = [];
        for (const m of selection.mods) mods.push(await fileFor(m));
        await engine.start({ base, mods });
      } catch (err) {
        busy.hidden = false;
        busy.textContent = String(err.message || err);
      }
    }).finally(() => setup.classList.remove('applying'));
    return applying;
  }
  $('nesPlay').onclick = async () => {
    const busy = $('libBusy');
    busy.hidden = true;
    try {
      await engine.start({ base: await fileFor(selection.iwad) });
    } catch (err) {
      busy.hidden = false;
      busy.textContent = String(err.message || err);
    }
  };
  render().then(apply).catch(err => console.warn(err));

  // ------------------------------------------------- playing / lifecycle ----
  const pad =document.createElement('div');
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
  // Generic pad built from engine.pad (data) for non-Doom engines: buttons {id,label,key,kind:'hold'}.
  const padData = document.createElement('div');
  padData.id = 'appPadData';
  padData.hidden = true;
  document.body.append(padData);
  let padDataFor = null;
  function buildDataPad() {
    if (padDataFor === engine) return;
    padDataFor = engine;
    padData.innerHTML = '';
    for (const def of engine.pad || []) {
      const b = document.createElement('button');
      b.className = 'b dp-' + def.id;
      b.textContent = def.label;
      let id = null;
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (id !== null) return;
        id = e.pointerId;
        try { b.setPointerCapture(id); } catch (_) {}
        b.classList.add('on');
        hold(engine.keys[def.key], true);
      });
      const up = e => { if (id === null || e.pointerId !== id) return; id = null; b.classList.remove('on'); hold(engine.keys[def.key], false); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', e => e.preventDefault());
      padData.append(b);
    }
  }
  const pauseEl = document.createElement('div');
  pauseEl.id = 'appPause';
  pauseEl.hidden = true;
  pauseEl.innerHTML = 'Paused<small>Tap to continue</small>';
  document.body.append(pauseEl);

  let usingPad = matchMedia('(pointer: coarse)').matches;
  const showPad = () => {
    const wasHidden = pad.hidden;
    const show = playing && usingPad;
    if (show && engine.id !== 'doom') buildDataPad();
    padData.hidden = !(show && engine.id !== 'doom');
    pad.hidden = !(show && engine.id === 'doom');
    if (wasHidden && !pad.hidden) requestAnimationFrame(() => resetStick());
  };

  document.addEventListener('wad:playing', () => {
    playing = true;
    setLook(0);
    keepAwake(true);
    showPad();
    if (engine.id === 'doom') requestAnimationFrame(resetStick);   // place the stick once the pad has a size
  });
  document.addEventListener('wad:stopped', () => {
    playing = false;
    releaseAll();
    keepAwake(false);
    pad.hidden = true;
    padData.hidden = true;
    pauseEl.hidden = true;
  });

  // Background: pause the level, stop audio, let the screen sleep.
  let pausedForBackground = false;
  function appPause() {
    if (!playing || pausedForBackground) return;
    releaseAll();
    engine.pause(true);
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
    engine.pause(false);
    keepAwake(true);
  }
  pauseEl.addEventListener('pointerdown', e => { e.preventDefault(); continueGame(); });

  // Called by MainActivity for the Android back button. true = handled.
  window.wadBack = () => {
    if (!playing) return false;
    if (!pauseEl.hidden) { continueGame(); return true; }
    if (engine.back) engine.back(); else tap(K.esc);
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
    if (dy) setLook(engine.look - dy * LOOK_PER_PX);
  });
  const lookUp = e => { if (e.pointerId === lookId) lookId = null; };
  lookZone.addEventListener('pointerup', lookUp);
  lookZone.addEventListener('pointercancel', lookUp);

  // ------------------------------------------------------------ gamepad ----
  // Button map (engine.gamepad) and its comment live in engines.js; X (button 2) = next weapon, right stick = turn + look.
  const TAP_ONLY = new Set(['enter', 'back', 'yes', 'tab', 'esc']);
  const prevButtons = {};
  const axisKeys = {};
  function axisKey(id, active, key) {
    if (!!axisKeys[id] === active) return;
    if (K[key] === undefined) return;
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
        if (i === 2 && down && engine.id === 'doom') nextWeapon();
        for (const name of engine.gamepad[i] || []) {
          if (TAP_ONLY.has(name)) { if (down) tap(K[name]); } else hold(K[name], down);
        }
      });
      prevButtons[gp.index] = prev;
      const [ax = 0, ay = 0, rx = 0, ry = 0] = gp.axes;
      axisKey(gp.index + 'f', ay < -0.4, 'up');
      axisKey(gp.index + 'b', ay > 0.4, 'down');
      axisKey(gp.index + 'l', ax < -0.5, engine.id === 'doom' ? 'strafeL' : 'left');
      axisKey(gp.index + 'r', ax > 0.5, engine.id === 'doom' ? 'strafeR' : 'right');
      if (Math.abs(rx) > 0.15) turn(Math.sign(rx) * rx * rx * 95);
      if (Math.abs(ry) > 0.2) setLook(engine.look - Math.sign(ry) * ry * ry * 2.5);
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
