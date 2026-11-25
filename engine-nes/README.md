# engine-nes
`nes_glue.c` is the small C surface (`nes_*`) that `app/nes.js` calls; it wraps a libretro core (fceumm).
Licence: GPL-2.0 (this repo). fceumm itself is fetched at a pinned commit, not copied here.
Build: `npm run build-nes-core` (needs emsdk 3.1.74), then `node scripts/smoke-nes-core.mjs`.
