# Rendering the showcase video

Films the built site and encodes it, with captions burned in. No screen
recorder, no editor, no camera. One command per cut.

```bash
npm run build                                   # required: it films dist/
node tools/video/render.mjs --cut full --format wide
```

Output lands in `build/video/` (git-ignored) as `fpl-<cut>-<format>.mp4`
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
| `--codec` | `h264` | `h264` (MP4) or `vp8` (WebM) |
| `--shots` | — | Explicit shot list, overrides `--cut`, e.g. `squad_autopick` |
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

- **Encoding needs `ffmpeg-static`.** It is a devDependency, so `npm install`
  covers it. Playwright's bundled ffmpeg is a stripped VP8-only build with no
  libx264 and no audio encoders; it can still produce the WebM path via
  `--codec vp8` if `ffmpeg-static` is missing, but nothing else.

  This mattered more than it sounds. WebM was the original output, on the
  reasoning that YouTube accepts it — which it does, *from a desktop browser*.
  An iPhone will not play VP8 in Photos or Files, and the YouTube iOS app only
  lists files the OS can decode, so the upload never gets as far as being
  rejected: the video simply is not in the picker. H.264 in an MP4 is the only
  thing that works everywhere, and it is now the default.
- **Silent by design**, but not silent *by omission*. The cuts carry a real
  (silent) AAC track, because iOS Photos and the social uploaders all handle
  video-only MP4s unreliably. Captions do the work, which is how Shorts are
  watched anyway. To add a voiceover, mux it over the top — the `.json`
  manifest carries per-shot timings.
- **My Team cannot be filmed pre-season.** `docs/LAUNCH.md` shot 8 wants it, but
  the page is gated behind *"Available after Gameweek 1"* because it reads a
  live FPL squad. Scouting stands in until GW1 is played; add the shot back
  after.

## The motion-graphics layer

`render.mjs` films the real product. `motion.mjs` adds what a screen recording
cannot give you — sprung titles, a stat sting, an end card — and assembles the
finished film, dissolving the joins.

```bash
node tools/video/motion.mjs --comp Intro          # 2.3s title card
node tools/video/motion.mjs --comp EndCard        # 3s  end card
node tools/video/motion.mjs --comp StatCard       # a number springing up
node tools/video/motion.mjs --comp Film \
  --clips build/video/fpl-full-wide.mp4           # intro + footage + end card
```

Compositions live in `remotion/Root.tsx` — plain React on a timeline. The cards
are built on the real mark, `public/brand/lockup.jpg`, rather than a re-typeset
imitation of it, so they cannot drift from the brand. Two consequences:

- The lockup already contains the wordmark, so nothing re-states the name
  under it — the end card adds only the URL and the call to action.
- Its black field samples at `rgb(8,8,8)`, four levels off the site's ink. The
  cards use the logo's own black (`LOGO_BG`) so H.264, which bands flat dark
  areas, has no edge to draw. Never scale it past its 640px source either;
  beyond that the metal goes soft. `--audio path.mp3 --music-volume 0.18` lays a track
under the whole film; `--dissolve 12` sets the overlap in frames.

Two things worth knowing before editing it:

- **Remotion needs `chrome-headless-shell`**, not the ordinary Chromium binary,
  and its own download host is blocked by the network policy. Playwright
  already ships the shell, so `motion.mjs` points at that. Do not "fix" this by
  letting Remotion download its own — it cannot reach the host.
- **`publicDir` must be passed to `bundle()` explicitly.** The entry point is
  nested under `tools/`, so Remotion's convention-based lookup misses it and
  `staticFile()` 404s. That surfaces as a *fallback font*, not an error — the
  render succeeds and the type is silently wrong, so check a frame.

Fonts are gated behind `delayRender` in `remotion/brand.tsx`. Without it the
first frames rasterise before the faces load and the type pops mid-shot.

## Changing the film

`shots.mjs` is the whole edit — routes, durations, captions, scroll anchors and
the pointer path, as data. Durations can differ per format (`{wide, vertical}`)
so a shot can breathe in the long cut and snap in a vertical.

Iterate on one shot without re-rendering the film:

```bash
node tools/video/render.mjs --shots squad_autopick --format wide --stills
```

### Clicking things

Two hooks, and the difference between them matters:

- **`setup(page)`** runs *before* filming. Use it when the interaction is not
  the point and you just need the page populated — Scouting and
  `squad_insights` both use one, because they open on empty states.
- **`action: {at, run}`** runs *during* filming, at that fraction of the shot,
  and draws a click ripple. Use it when pressing the thing **is** the shot, as
  in `squad_autopick`.

A pointer path point may be `[t, {text: 'Auto pick'}]` instead of
`[t, fx, fy]`, and resolves to wherever that control actually sits — necessary
because the mobile layout puts the same toolbar somewhere else entirely, and
hardcoded fractions drift silently into pressing thin air next to the button.

The catch is that the position is resolved *before* the click, and a click
often moves things. Pressing Auto pick swaps the right-hand Add Players panel
for the verdict and Squad Lab, which re-centres the toolbar: a pointer parked
on the resolved spot ends up hovering Share, appearing to press one control and
rest on another. So move the pointer off promptly after any action, and check
the result — `--stills` gives first/middle/last, but for a click you want the
frames either side of `action.at`:

```bash
node_modules/ffmpeg-static/ffmpeg -ss 2.1 -i build/video/fpl-full-wide.mp4 -frames:v 1 click.png
```
