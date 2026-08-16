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

| Cut | Shots | Format | Length |
|-----|-------|--------|--------|
| `full` | the whole tour | `wide` | 71s · 1920×1080 |
| `a` | deadline · fixtures · team news | `vertical` | 15s · 1080×1920 |
| `b` | one player, one slow scroll | `vertical` | 14s · 1080×1920 |
| `c` | fixtures · squad builder | `vertical` | 15s · 1080×1920 |
| `planner` | the season planner, zoom by zoom | `desk` | 77s · 1920×1080 |

`--format wide` renders the desktop layout at 1280 CSS px scaled to full HD.
`--format vertical` renders the **mobile** layout at 432 CSS px scaled to
1080×1920 — natively, not cropped out of the desktop capture, so the text stays
readable at phone size. `--format desk` is a roomier desktop at 1440 CSS px,
for pages the 1280 layout squeezes: the Squad Builder's Risk table overflows
its column by 62px at 1280 and clips the status pills off the right edge,
against 6px here. The `planner` cut needs it.

## Flags

| Flag | Default | Notes |
|------|---------|-------|
| `--cut` | `full` | `full`, `a`, `b`, `c`, `planner` |
| `--format` | `wide` | `wide`, `vertical`, `desk` |
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

# Vertical, for the Shorts
node tools/video/motion.mjs --comp IntroVertical
node tools/video/motion.mjs --comp EndCardVertical
node tools/video/motion.mjs --comp FilmVertical \
  --clips build/video/fpl-a-vertical.mp4 --name fpl-short-a
```

`--name` sets the output basename; without it every `FilmVertical` render
lands on the same file and the three Shorts overwrite each other.

The vertical cards are not the wide ones letterboxed. A square mark has far
more room in a 9:16 frame, so the lockup goes to 900px, and three timings
change with the format:

- **There is no intro at all.** A Short is scrolled past in the first second,
  so opening on a logo spends the only attention the video gets. Cut A now
  opens on *"GW1 DEADLINE · 7d 7h 33m"*, and the outro carries the call to
  action. Put one back for a render with `--intro-frames 30`; `--outro-frames`
  works the same way, and `0` removes a card entirely.

  Note `INTRO_V` (the standalone card's own length) is separate from
  `FILM_INTRO_V` (how much of it the film uses). A Remotion composition cannot
  have zero frames, so `IntroVertical` stays renderable on its own at 30 while
  the film uses none of it.
- **The end card block sits 190px above centre.** Shorts, Reels and TikTok all
  stack their own title, handle and action rail over the bottom of the frame;
  centred, the URL — the only thing on that card anyone needs to read — ends up
  underneath it.
- **The dissolve shortens to 10 frames.** At 13–15 seconds a 12-frame overlap
  at each join is a noticeable share of the run time.

Compositions live in `remotion/Root.tsx` — plain React on a timeline. The cards
are built on the real mark, `public/brand/lockup.jpg`, rather than a re-typeset
imitation of it, so they cannot drift from the brand. Two consequences:

- The lockup already contains the wordmark, so nothing re-states the name
  under it — the end card adds only the URL and the call to action.
- Its black field samples at `rgb(8,8,8)`, four levels off the site's ink. The
  cards use the logo's own black (`LOGO_BG`) so H.264, which bands flat dark
  areas, has no edge to draw. Never scale it past its 640px source either;
  beyond that the metal goes soft.

`--audio path.mp3 --music-volume 0.18` lays a track under the whole film;
`--dissolve 12` sets the overlap in frames.

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

### Zooming

`zoom: {from, to, at}` scales `<body>` about a point in page coordinates, so
the browser re-rasterises and the type stays sharp. Doing it in ffmpeg with
`zoompan` magnifies finished pixels and goes soft. Only magnification: below 1
would pull the page edges in and expose bare background.

**The origin is a fixed point, not a crop.** It sits still on screen while
everything grows around it, which means the scroll anchor and the zoom target
have to agree or the shot drifts off its own subject. The reliable recipe is to
anchor `from`/`to` on the *same* element the zoom targets, offset by roughly
half a viewport: the subject then holds its place in frame for the whole
push-in. Every planner shot is built that way.

`at` takes:

| Key | Matches |
|-----|---------|
| `text` | exact, then falling back to a prefix |
| `contains` | anywhere in the text; first innermost match in document order |
| `ox` / `oy` | override the resolved centre on one axis |
| `x` / `y` | skip resolution entirely |

`contains` exists because some targets are a mark rather than a word — the
planner's transfer seam is only ever identifiable by its arrow glyph, since the
names either side of it change with the data. It has to take the *innermost*
match: every ancestor up to `<html>` contains the string too, and taking the
first of those resolved a shot to the top of the page.

`ox` exists because a hard zoom on something to the right drags the sticky
left-hand name column out of frame, and a transfer you cannot put a name to is
just a colour. Pinning `ox` near the left margin keeps the row legible.

**Do not put a click inside a moving zoom.** The pointer path is resolved
against the unzoomed page, so the cursor lands next to whatever it appears to
press. The five toggle shots in the `planner` cut are deliberately flat for
that reason; the zooms are the shots with no clicks in them.

One more thing that only shows up in the file: consecutive shots on the same
route **do not reload the page**, so the transform a zoom finishes on is still
sitting on `<body>` when the next shot measures its anchors. `render.mjs` clears
it after the route is forced. Without that, three planner shots in a row
resolved to plausible-looking scroll positions that had nothing to do with
their anchors — the render succeeded and the framing was silently wrong.
