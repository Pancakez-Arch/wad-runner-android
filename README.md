# WAD Runner for Android

Play Doom-engine games on Android with **your own WAD files**. The whole game (engine, web UI
and the free [Freedoom](https://freedoom.github.io) IWADs) is bundled in the APK, so it runs
offline with no server.

- Classic Doom engine ([doomgeneric](https://github.com/ozkl/doomgeneric), GPL) compiled to
  WebAssembly (single-threaded, no SharedArrayBuffer needed), wrapped with
  [Capacitor](https://capacitorjs.com)
- WAD library: import several `.wad` / `.deh` files at once (50 MB+ is fine). They're kept on
  the phone, and you can pick one game plus any mods, or delete them
- Touch controls: move/turn stick on the left, swipe the right side to turn and look up/down
  (double-tap there to re-centre), FIRE, USE, WPN (next weapon), RUN, MENU, ENTER, Y, MAP
- Vertical free-look added to the engine (shots still auto-aim vertically, as in classic Doom)
- Bluetooth gamepad (standard mapping) and keyboard
- Landscape, immersive fullscreen, screen stays on while playing. Leaving the app pauses the game
  and audio; tap to continue
- Music via an emulated OPL (AdLib / Sound Blaster) synth using your WAD's instruments; saves persist

No commercial game data is included. Use your own `DOOM.WAD`, `DOOM2.WAD`, etc.

## Download and install

1. Open this repository's **Releases** page on your phone and download the latest
   `WADRunner-vX.Y.Z.apk`. Untagged builds are under **Actions → Build APK → (run) → Artifacts**
   (zipped; needs a GitHub login).
2. Open the APK. Android asks to allow installs from your browser/Files app: allow it.
3. Open **WAD Runner** → **Import WADs…** → choose your WAD files → select one → **Start**.

Updates install over the old version and keep your WADs and saves, because every build is
signed with the same key (see *Signing key* below).

### Controls

| Touch | Gamepad | Keyboard | Action |
|---|---|---|---|
| Stick up/down | Left stick / D-pad | ↑ ↓ | Walk |
| Stick left/right, swipe right side | Right stick / D-pad ← → | ← → | Turn |
| Swipe right side up/down (double-tap = centre) | Right stick up/down (click = centre) | — | Look up/down |
| — | Left stick sideways, LB / RB | Alt+← → | Strafe |
| FIRE | A, RT | Ctrl | Fire |
| USE | B | Space | Doors / switches |
| RUN (toggle) | LT (hold) | Shift | Run |
| WPN | X | 1–7 | Weapons |
| MENU, Back button | Start | Esc | Menu |
| ENTER | A | Enter | Select |
| Y | Y | Y | Answer "yes" prompts |
| MAP | Back/Select | Tab | Automap |

## Repository layout

| Path | What |
|---|---|
| `site/` | Copy of the WAD Runner website (`npm run import-site` refreshes it from `~/wad-runner`) |
| `app/` | Android app layer: WAD library, touch stick, gamepad, pause, Back button |
| `engine/` | Doom engine C source (GPL-2.0). CI compiles it, so the APK always matches the source |
| `scripts/` | `build-engine.sh`, `fetch-freedoom.mjs`, `build-www.mjs`, `import-site.mjs` |
| `android/` | Capacitor Android project (`MainActivity`, keep-awake plugin, icons) |
| `.github/workflows/build.yml` | Builds the APK on every push; attaches it to a Release for `v*` tags |

### Building

CI does all of this. To build locally you need Node 22, Emscripten 3.1.74, JDK 21 and the
Android SDK on an x86-64 machine:

```sh
npm ci
source ~/emsdk/emsdk_env.sh && npm run build-engine   # engine/ -> build/engine (wasm)
npm run fetch-freedoom                                 # -> build/freedoom (sha256-checked)
npm run build                                          # -> www/
npx cap sync android
cd android && ./gradlew assembleDebug                  # -> app/build/outputs/apk/debug/
```

## Setting up the GitHub repository

1. **Create an empty repository** on GitHub (e.g. `wad-runner-android`, private or public). Don't
   add a README or licence there; this repo already has them.
2. **Push access with a deploy key** (scoped to this one repository):
   - On the build machine: `ssh-keygen -t ed25519 -N "" -C wad-runner-android-deploy -f ~/.ssh/wad_runner_android_deploy`
   - GitHub → repo → *Settings → Deploy keys → Add deploy key*. Paste the **public** key
     (`~/.ssh/wad_runner_android_deploy.pub`) and tick **Allow write access**.
   - Point git at it and push:
     ```sh
     git remote add origin git@github.com:Pancakez-Arch/wad-runner-android.git
     git config core.sshCommand "ssh -i ~/.ssh/wad_runner_android_deploy -o IdentitiesOnly=yes"
     git push -u origin main
     ```
   The private key never leaves the build machine. Never paste it anywhere.
3. **Signing key secret**: add a repository secret named `DEBUG_KEYSTORE_B64`
   (*Settings → Secrets and variables → Actions → New repository secret*) containing the
   base64-encoded debug keystore (alias `androiddebugkey`, passwords `android`). To create one:
   ```sh
   keytool -genkeypair -keystore debug.keystore -storepass android -keypass android \
     -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
   base64 -w0 debug.keystore   # paste the output as the secret value; keep debug.keystore safe
   ```
   If the key is lost or changed, the next APK won't install over the old one; you'd have to
   uninstall first, which deletes imported WADs and saves.
4. **Releases**: push a tag to publish an APK on the Releases page:
   ```sh
   git tag v1.0.0 && git push origin v1.0.0
   ```

## Licence

GPL-2.0 (`LICENSE`). See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for all components
and [`engine/CHANGES.md`](engine/CHANGES.md) for engine modifications. Freedoom is BSD-3-Clause
(licence and credits are shipped inside the app under `licenses/`). DOOM is a trademark of
id Software; this project is not affiliated with id Software and ships no commercial game data.
