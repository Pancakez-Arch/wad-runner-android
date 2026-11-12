# Third-party notices

WAD Runner is distributed under the **GNU General Public License, version 2** (see `LICENSE`).
The complete corresponding source code is in this repository: the Doom engine in `engine/`,
the web front-end in `site/` and `app/`, and the Android wrapper in `android/`.

| Component | Where | Licence | Copyright |
|---|---|---|---|
| Doom engine source | `engine/` | GPL-2.0 | © 1993–1996 id Software, Inc. |
| doomgeneric | `engine/` | GPL-2.0 | © ozkl and contributors — https://github.com/ozkl/doomgeneric |
| Chocolate Doom (OPL music, MIDI, parts of the engine) | `engine/` | GPL-2.0-or-later | © Simon Howard and contributors — https://github.com/chocolate-doom/chocolate-doom |
| Nuked OPL3 emulator (`opl3.c`) | `engine/` | GPL-2.0-or-later | © 2013–2016 Alexey Khokholov (Nuke.YKT) |
| SDL2, SDL2_mixer (linked by Emscripten) | built into `doomgeneric.wasm` | zlib | © Sam Lantinga and contributors |
| Emscripten runtime (`doomgeneric.js`) | generated | MIT / UIUC | © Emscripten authors |
| Capacitor | `android/`, npm | MIT | © Ionic and contributors |
| Freedoom 0.13.0 IWADs (`freedoom1.wad`, `freedoom2.wad`) | bundled in the APK, downloaded at build time | BSD-3-Clause | © 2001–2024 Contributors to the Freedoom project — https://freedoom.github.io |

Changes made to the engine are listed in `engine/CHANGES.md`.

DOOM is a registered trademark of id Software / ZeniMax Media. This project is not affiliated
with or endorsed by them, and ships **no** commercial game data. Use your own WAD files.

## Freedoom licence

```
Copyright © 2001-2024
Contributors to the Freedoom project.  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.
  * Neither the name of the Freedoom project nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
