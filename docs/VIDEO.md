# The launch film

`npm run video` produces a 60-second 1080p60 launch film and a 6-second silent
hero loop, in `tools/video/out/`. Nothing is filmed and nothing is stock: every
frame is rendered from this repo, and every number on screen is read off the
built site running against the current `site_data`.

    npm run video                                   # build → capture → render → loop
    npm run video -- --skip-build --skip-capture    # re-render from existing plates

Output:

| File | What it is |
|---|---|
| `fpl-analyser-launch.mp4` | the film, 1920×1080 @ 60fps, **silent** |
| `fpl-analyser-hero.mp4` / `.webm` | 6s 720p silent loop for a homepage hero |

## How it works

Three stages, each its own script.

**1 · Capture** (`capture.mjs`) drives the *built* site in Chromium at 1440×900,
deviceScaleFactor 2, and writes one full-page PNG "plate" per route plus
`plates.json` — the measured rect of every table row, section and captain card,
in page coordinates.

Figures for the typographic beats are read out of the rendered DOM in the same
pass, not recomputed from `site_data`. That is deliberate. Re-deriving Haaland's
99 here would be a second implementation of the ratings model, free to drift
from the one the site actually shows. The site is the source of truth for its
own numbers.

**2 · Composition** (`composition/`) is a plain HTML page, 1920×1080, that draws
the plates as image layers and moves a virtual camera over them. It exposes
`window.__setFrame(n)` and nothing else animates: there is no `requestAnimation-
Frame`, no CSS transition, no clock. Frame *n* is a pure function of *n*, which
is what makes a 3600-frame render reproducible rather than dependent on how fast
the machine happened to be going.

Camera moves are expressed in page coordinates — "frame 1090 CSS pixels wide,
centred on (566, 772)" — so they stay correct when a plate changes height. Zoom
interpolates geometrically so a push reads as constant speed instead of easing
off as it tightens.

The palette is lifted from `src/index.css`: same `--accent`, same `--ink-1`, same
black. The film and the product are literally the same colours.

**3 · Render** (`render.mjs`) steps every frame in Chromium and pipes the PNGs
straight into ffmpeg over stdin. Frames never touch disk — 3600 of them at 1080p
is about a gigabyte nobody needs.

    node tools/video/render.mjs --sheet --every 2   # contact sheet, for eyeballing
    node tools/video/render.mjs --at 10.5,34,42     # specific seconds, full res
    node tools/video/render.mjs --from 9 --to 18    # one beat, as an mp4

Use those three before committing to a full render. A full pass is about five
minutes; a contact sheet is about twenty seconds.

### ffmpeg

Needs a real ffmpeg with `libx264`. **The Playwright-bundled one at
`/opt/pw-browsers/ffmpeg-*` will not work** — it is a stripped build with no
x264 encoder and no PNG decoder, and it fails by hanging on the pipe rather than
by saying so. `ffmpeg.mjs` looks for a system ffmpeg, then the static build
`imageio-ffmpeg` installs; override with `FFMPEG_PATH`.

## Audio

The film renders **silent**, and that is the honest state of it: a music bed has
to be licensed, and an unlicensed track has no business on a site that is trying
to stay boring to corporate filters. Once you have one:

    ffmpeg -i fpl-analyser-launch.mp4 -i bed.wav -map 0:v -map 1:a \
           -c:v copy -c:a aac -b:a 192k -shortest fpl-analyser-launch-scored.mp4

Beat boundaries, if you want to cut music to them, are the `BEATS` table at the
top of `composition/timeline.js`.

## Where it should live

The 60-second file is roughly 25 MB. That is a launch-announcement asset — put
it on YouTube or a CDN and embed it. Do **not** commit it into `dist/` and serve
it from Pages on every visit.

The hero loop is the one that belongs in the repo: it is a few hundred KB,
silent, and safe to `autoplay muted loop playsinline`.

## Trade marks

Club crests and player images appear inside product screenshots, which is the
same nominative use the live site already makes of them. Keep it that way:

- no crest, club name or league mark in the wordmark, end card or thumbnail;
- the end card carries the "not affiliated with or endorsed by" line, and should
  keep carrying it;
- no copying the Premier League's own typography or colour system, and nothing
  in the copy that implies a partnership.

See `docs/LAUNCH.md` §5.

## Re-rendering

The film shows real data, so it ages: this cut shows GW2, a 28 August deadline
and Haaland on 99. Re-running `npm run video` after a data refresh re-cuts it
against whatever the site shows that day — the composition never hard-codes a
number, so nothing needs editing.
