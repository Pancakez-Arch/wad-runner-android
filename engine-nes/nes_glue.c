/* nes_glue.c: tiny C surface over a libretro core (fceumm), for app/nes.js.
 * Licence: GPL-2.0 (same as this repository). Built by scripts/build-nes-core.sh.
 *
 * JS calls, in this order per frame (see app/nes.js): nes_frame(), nes_audio_count(), nes_audio_ptr(),
 * then nes_video_ptr() once per drawn frame. Input is a bitmask: bit i = libretro joypad id i (port 0). */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <emscripten.h>
#include "libretro.h"

#define VW 256
#define VH 240
#define AUDIO_CAP 8192   /* stereo frames */

static uint32_t video[VW * VH];            /* XRGB8888 */
static int16_t audio[AUDIO_CAP * 2];
static int audio_frames;
static uint32_t input_mask;
static int inited, loaded;

static bool env_cb(unsigned cmd, void *data) {
  switch (cmd) {
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
      return data && *(enum retro_pixel_format *)data == RETRO_PIXEL_FORMAT_XRGB8888;
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
      if (data) *(bool *)data = false;
      return true;
    default:
      return false;   /* every other command: unsupported, the core uses defaults */
  }
}

static void video_cb(const void *data, unsigned w, unsigned h, size_t pitch) {
  if (!data) return;   /* duplicated frame: keep the previous one */
  unsigned cw = w < VW ? w : VW, ch = h < VH ? h : VH;
  for (unsigned y = 0; y < ch; y++)
    memcpy(&video[y * VW], (const uint8_t *)data + y * pitch, cw * 4);
}

static size_t audio_batch_cb(const int16_t *d, size_t frames) {
  size_t room = AUDIO_CAP - (size_t)audio_frames;
  size_t n = frames < room ? frames : room;   /* drop on overflow */
  memcpy(&audio[audio_frames * 2], d, n * 4);
  audio_frames += (int)n;
  return frames;
}
static void audio_cb(int16_t l, int16_t r) { int16_t s[2] = { l, r }; audio_batch_cb(s, 1); }
static void poll_cb(void) {}
static int16_t input_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
  (void)index;
  if (port != 0 || device != RETRO_DEVICE_JOYPAD) return 0;
  if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)(input_mask & 0x1ff);
  return id < 16 ? (int16_t)((input_mask >> id) & 1) : 0;
}

EMSCRIPTEN_KEEPALIVE int nes_init(void) {
  if (inited) return 1;
  retro_set_environment(env_cb);
  retro_set_video_refresh(video_cb);
  retro_set_audio_sample(audio_cb);
  retro_set_audio_sample_batch(audio_batch_cb);
  retro_set_input_poll(poll_cb);
  retro_set_input_state(input_cb);
  retro_init();
  inited = 1;
  return 1;
}

/* Always go through MEMFS: works whether the core needs a path or the data buffer. */
EMSCRIPTEN_KEEPALIVE int nes_load(const uint8_t *data, int size) {
  if (!inited || !data || size <= 0) return 0;
  FILE *f = fopen("/rom.nes", "wb");
  if (!f) return 0;
  size_t wrote = fwrite(data, 1, (size_t)size, f);
  fclose(f);
  if (wrote != (size_t)size) return 0;
  struct retro_game_info info = { "/rom.nes", data, (size_t)size, NULL };
  loaded = retro_load_game(&info) ? 1 : 0;
  return loaded;
}

EMSCRIPTEN_KEEPALIVE void nes_frame(void) {
  if (!loaded) return;
  audio_frames = 0;
  retro_run();
}
EMSCRIPTEN_KEEPALIVE uint8_t *nes_video_ptr(void) { return (uint8_t *)video; }
EMSCRIPTEN_KEEPALIVE uint8_t *nes_audio_ptr(void) { return (uint8_t *)audio; }
EMSCRIPTEN_KEEPALIVE int nes_audio_count(void) { return audio_frames; }
EMSCRIPTEN_KEEPALIVE void nes_set_input(int mask) { input_mask = (uint32_t)mask; }
EMSCRIPTEN_KEEPALIVE uint8_t *nes_sram_ptr(void) { return loaded ? (uint8_t *)retro_get_memory_data(RETRO_MEMORY_SAVE_RAM) : 0; }
EMSCRIPTEN_KEEPALIVE int nes_sram_size(void) { return loaded ? (int)retro_get_memory_size(RETRO_MEMORY_SAVE_RAM) : 0; }
