#!/usr/bin/env bash
# Builds the NES core (libretro fceumm + engine-nes/nes_glue.c) to WebAssembly -> build/nes/nes_core.{js,wasm}.
# Requires Emscripten 3.1.74 on PATH (source emsdk_env.sh first), git and network access.
# GPL: the shipped binary must match this repo + the pinned upstream commit below. Never build from a floating branch.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN=fb919fb6fa881aaa6279b765d480220579e5c606     # libretro/libretro-fceumm master, 2026-11-22
# sha256 of the clone's Copying file (GPL v2 text). Empty = not recorded yet: the script prints it, CI logs show it.
COPYING_SHA256=""
OUT="$ROOT/build/nes"
SRC="$OUT/src"
mkdir -p "$SRC"

# 1. Fetch exactly the pinned commit (skip if already there)
cd "$SRC"
if [ "$(git rev-parse HEAD 2>/dev/null || true)" != "$PIN" ]; then
  git init -q
  git remote remove origin 2>/dev/null || true
  git remote add origin https://github.com/libretro/libretro-fceumm.git
  git fetch -q --depth 1 origin "$PIN"
  git checkout -q FETCH_HEAD
fi
[ "$(git rev-parse HEAD)" = "$PIN" ] || { echo "fceumm is not at $PIN" >&2; exit 1; }

# 2. Licence gate: explicit non-GPL wording fails the build; the GPL v2 text must be the one we recorded.
if grep -rniE "non-commercial|no commercial|not for commercial" src --include='*.c' --include='*.h' --include='*.cpp' \
     --include='LICENSE*' --include='COPYING*' ; then
  echo "Licence gate: non-commercial wording found in fceumm sources (see above)." >&2
  exit 1
fi
ACTUAL="$(sha256sum Copying | cut -d' ' -f1)"
echo "fceumm Copying sha256: $ACTUAL"
if [ -n "$COPYING_SHA256" ] && [ "$ACTUAL" != "$COPYING_SHA256" ]; then
  echo "Licence gate: Copying changed (expected $COPYING_SHA256)." >&2
  exit 1
fi

# 3. Static libretro core (platform=emscripten gives an archive, not a runnable module)
rm -f ./*.bc ./*.a
emmake make -f Makefile.libretro platform=emscripten STATIC_LINKING=1 -j"$(nproc 2>/dev/null || echo 4)"
LIB="$(ls ./fceumm_libretro_emscripten.bc ./fceumm_libretro_emscripten.a 2>/dev/null | head -n1 || true)"
[ -n "$LIB" ] || { echo "make did not produce fceumm_libretro_emscripten.{bc,a}" >&2; exit 1; }

# 4. Link the glue + core into a MODULARIZEd module (own instance: createNesCore)
cd "$ROOT"
emcc -O2 engine-nes/nes_glue.c "$SRC/$LIB" \
  -I "$SRC/src/drivers/libretro/libretro-common/include" -I "$SRC/src" \
  -o "$OUT/nes_core.js" \
  -sMODULARIZE=1 -sEXPORT_NAME=createNesCore -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_nes_init,_nes_load,_nes_frame,_nes_video_ptr,_nes_audio_ptr,_nes_audio_count,_nes_set_input,_nes_sram_ptr,_nes_sram_size

# 5. Report
ls -la "$OUT"/nes_core.js "$OUT"/nes_core.wasm
