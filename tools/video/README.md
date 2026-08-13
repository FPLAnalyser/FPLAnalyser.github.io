# Rendering the showcase video

Films the built site and encodes it, with captions burned in. No screen
recorder, no editor, no camera. One command per cut.

```bash
npm run build                                   # required: it films dist/
node tools/video/render.mjs --cut full --format wide
```

Output lands in `build/video/` (git-ignored) as `fpl-<cut>-<format>.webm`
alongside a `.json` manifest of what was filmed.

## The cuts

| Cut | Shots | Wide | Vertical |
|-----|-------|------|----------|
| `full` | the whole tour | 71s · 1920×1080 | — |
| `a` | deadline · fixtures · team news | — | 15s · 1080×1920 |
| `b` | one player, one slow scroll | — | 14s · 1080×1920 |
| `c` | fixtures · squad builder | — | 15s · 1080×1920 |

`--format wide` renders the desktop layout at 1280 CSS px scaled to full HD.
`--format vertical` renders the **mobile** layout at 432 CSS px scaled to
1080×1920 — natively, not cropped out of the desktop capture, so the text stays
readable at phone size.

## Flags

| Flag | Default | Notes |
|------|---------|-------|
| `--cut` | `full` | `full`, `a`, `b`, `c` |
| `--format` | `wide` | `wide`, `vertical` |
| `--fps` | `30` | |
| `--dry` | off | Resolve anchors and report; encode nothing |
| `--stills` | off | Also write first/middle/last frame of each shot as PNG |
| `--out` | `build/video` | |

## Run `--dry` after a data refresh

Scroll positions are anchored to **heading text**, not pixel offsets, because
`main` takes scheduled data commits several times a day and every one moves the
layout. A dry run resolves every anchor against the current build and fails
loudly if one has gone:

```bash
node tools/video/render.mjs --cut full --format wide --dry
```

It also flags any shot whose scroll barely moves, which is what a silently
wrong anchor looks like. `anchors.mjs` dumps every heading and its Y offset for
a route, which is how you find a replacement:

```bash
node tools/video/anchors.mjs '/#/preview' 1280 720
```

## How it works, and why

Frames are captured **deterministically**. For each frame the renderer computes
where the scroll should be at that instant, sets it, and screenshots. Nothing
depends on real time, so motion is smooth and identical on every run regardless
of how fast the machine screenshots — roughly 6.5 frames per second here, which
is why 71 seconds of video takes about six minutes to render.

The browser runs with `prefers-reduced-motion`. That is the site's *own*
static-render path: `AnimatedCounter` jumps to its final value instead of
counting up from zero, and `.totw-card` / `.story-rise` sit at their end state
rather than mid-transition. Without it, every animation would advance at
wall-clock speed between frames and play back about five times too fast.

The pointer is drawn, not real — screenshots do not capture the OS cursor, and
`docs/LAUNCH.md` is right that a recording where nothing is ever hovered reads
as fake. Captions are drawn in the page in Manrope on the brand gold, because
this ffmpeg has no `drawtext` filter.

Two things differ in the vertical cuts, and both matter more than they sound:

- **No pointer.** A mouse cursor floating over a phone-shaped mobile layout
  reads as a cropped desktop recording, which is the one thing these are not.
- **Caption at the top, not a lower third.** The bottom of a vertical frame
  already holds the site's own tab bar, and Shorts/Reels/TikTok stack their
  title, handle and action rail over the bottom third on top of that. A bottom
  caption collides twice — in cut A it sat squarely over the captain pick's
  name and xP, hiding the single most persuasive number in the shot.

## Limits

- **WebM/VP8 only.** No H.264, so no MP4. YouTube accepts WebM directly, for
  both the main upload and Shorts. If you need MP4 for somewhere that does not,
  re-encode off this machine.
- **Silent.** No audio encoders are compiled in. The cuts are designed to work
  muted, which is how Shorts are watched anyway. To add a voiceover, mux it on
  your own machine — the `.json` manifest carries per-shot timings.
- **My Team cannot be filmed pre-season.** `docs/LAUNCH.md` shot 8 wants it, but
  the page is gated behind *"Available after Gameweek 1"* because it reads a
  live FPL squad. Scouting stands in until GW1 is played; add the shot back
  after.

## Changing the film

`shots.mjs` is the whole edit — routes, durations, captions, scroll anchors and
the pointer path, as data. Durations can differ per format (`{wide, vertical}`)
so a shot can breathe in the long cut and snap in a vertical. A shot may declare
a `setup(page)` that runs before filming; Scouting uses one to fill its
head-to-head, since the page opens on an empty state.
