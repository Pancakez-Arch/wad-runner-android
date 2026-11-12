#!/usr/bin/env bash
# Compiles the Doom engine (engine/, GPL-2.0) to WebAssembly -> build/engine/.
# Requires Emscripten 3.1.74 on PATH (source emsdk_env.sh first).
# Single-threaded build: no pthreads, no SharedArrayBuffer, no COOP/COEP needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/engine"
mkdir -p "$OUT"
cd "$ROOT/engine"
make -f Makefile.web -j"$(nproc 2>/dev/null || echo 4)" OBJDIR="$OUT/obj" OUTPUT="$OUT/doomgeneric" \
  CFLAGS="-O2 -DFEATURE_SOUND -sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sSDL2_MIXER_FORMATS=[] -Wno-everything -Werror=implicit-function-declaration -Wincompatible-function-pointer-types" \
  SDL_CFLAGS="-sUSE_SDL=2" \
  SDL_LIBS="-sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sSDL2_MIXER_FORMATS=[] -lidbfs.js" \
  LDFLAGS="-O2 -sALLOW_MEMORY_GROWTH=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sEXPORTED_RUNTIME_METHODS=callMain,FS,IDBFS -sENVIRONMENT=web"
# The Makefile links to $(OUTPUT).html; keep only the .js/.wasm pair.
rm -f "$OUT/doomgeneric.html"
ls -la "$OUT"/doomgeneric.js "$OUT"/doomgeneric.wasm
