# Publishing the video

What to upload, where, and with what copy. The files themselves come from
`tools/video/render.mjs` — see `tools/video/README.md` for how to make them.

## What you get

| File | Goes to | Length |
|------|---------|--------|
| `fpl-full-wide.mp4` | YouTube, as a normal video | 75s · 1920×1080 |
| `fpl-a-vertical.mp4` | YouTube Shorts, Reels, TikTok | 15s · 1080×1920 |
| `fpl-b-vertical.mp4` | Shorts, Reels, TikTok | 14s · 1080×1920 |
| `fpl-c-vertical.mp4` | Shorts, Reels, TikTok | 13s · 1080×1920 |

All four are H.264/AAC in an MP4 — silent, with captions burned in, which is
how they are meant to run: most Shorts are watched muted. Nothing needs
re-encoding for YouTube, Instagram or TikTok, and they play on a phone.

**Do not publish these as WebM.** The renderer can still emit VP8/WebM with
`--codec vp8`, and YouTube does accept it *from a desktop browser* — but an
iPhone will not play VP8 in Photos or Files, and the YouTube iOS app only lists
files the OS can decode, so from a phone the video never appears in the picker
at all. If you ever upload from the phone, and you will, it has to be MP4.

A 16:9 video is never treated as a Short regardless of length, so the wide cut
uploads as a normal video and the three verticals become Shorts automatically.

---

## The one wording rule

**Do not write "odds", "bookmaker", "betting" or "clean-sheet odds" into a
title, description, tag or caption.**

`docs/DOMAIN_CATEGORISATION.md` explains why: those phrases are the plausible
route to a **Gambling** classification, which is blocked far harder and in far
more places than being uncategorised, and would make the site unadvertisable
and awkward to link to. YouTube metadata is indexed and feeds ad-suitability,
and a burned-in caption cannot be edited after upload.

Shot 3's caption in `docs/LAUNCH.md` originally read *"clean-sheet odds … from
the bookmakers' own prices"*. It now renders as **"Projected goals and
clean-sheet chances for every fixture."** — same claim, none of the trigger
words. Keep descriptions on the same side of that line: the model takes
market-implied probabilities as an *input*, and the site displays, quotes and
links to no betting market anywhere.

---

## The main video

**Title** — pick one:

1. `Every Premier League player, rated — before the deadline` — leads on the
   product, reads as a tool not a take. Safest.
2. `I built a free FPL tool that rates every player` — "I built" and "free"
   both perform, and it is honest. Best click-through, slightly more personal
   than the anonymous positioning usually allows.
3. `The whole FPL gameweek on one screen` — the strongest single idea in the
   video, but it undersells everything after the 20-second mark.

**Description** — paste as-is:

```
FPL Analyser rates every Premier League player on the numbers that actually
predict returns — expected goals, minutes, form and fixtures — then turns them
into a plain-language verdict and transfer calls for your own team.

Free. No signup, no ads, nothing for sale.
https://fplanalyser.co.uk

0:00 Every player, rated
0:12 The gameweek, before the deadline
0:28 The player brief
0:38 Fixtures, and building a squad
1:01 Head-to-head scouting

FPL Analyser is independent and not affiliated with the Premier League or
Fantasy Premier League.

#FPL #FantasyPremierLeague #FPLTips
```

Those five timestamps are deliberate. YouTube only turns timestamps into real
chapters when there are at least three, the first is `0:00`, and **every
chapter runs 10 seconds or longer** — so the ten shots are merged into five.
Splitting them back out to one per shot silently disables chapters, because
several shots are 7 to 9 seconds.

**Tags:** `fpl`, `fantasy premier league`, `fpl tips`, `fpl gameweek`,
`fpl transfers`, `fantasy football`, `premier league`

---

## The three Shorts

Post **Cut A first** — it carries the deadline hook, which is the strongest
thing on offer.

| Cut | Title | First line of description |
|-----|-------|---------------------------|
| A | `The whole FPL gameweek on one screen` | Captain picks, every fixture projected, and who steps up when the team news lands. |
| B | `Every FPL player gets a verdict, not just a number` | Ratings, percentiles against positional peers, and what the numbers actually mean. |
| C | `Plan your FPL fixtures and squad in one place` | Find the best run of fixtures for every club — and build the XI around it. |

Close every Short description with:

```
Free, no signup → https://fplanalyser.co.uk

#FPL #FantasyPremierLeague #FPLTips #Shorts
```

---

## Thumbnail

Only the wide cut needs one; Shorts use a frame from the video.

`node tools/video/thumbnail.mjs --variant <v>` renders it from the live captain
podium — gold foil, a face, a number, which `docs/LAUNCH.md` correctly
identifies as the strongest still the site produces. Three layouts, because
which one wins a click is an empirical question:

| Variant | Carries | At 210px |
|---------|---------|----------|
| `question` | "WHO'S YOUR CAPTAIN?" | **Strongest.** Biggest type, highest contrast |
| `number` | the live xP and the player's name | Strong — a number survives shrinking better than a sentence |
| `headline` | "EVERY PLAYER, RATED." | Readable, but the claim is abstract |

The player and figure in `number` are read from the page, so it always states
the real pick rather than a number typed in once and left to rot.

**The kicker line is illegible at 210px in all three.** It reads as a brand
mark rather than information, which is fine — just do not put anything there
you need someone to actually read.

Re-render it in launch week. The podium is live data, and a thumbnail naming a
captain who has since been injured is worse than no thumbnail.

---

## Before you upload

- **Re-render.** `main` takes scheduled data commits several times a day, and
  the video is only as current as the build it was filmed from. A cut showing
  last week's deadline is worse than no video.
- **Dry-run first.** `node tools/video/render.mjs --cut full --format wide --dry`
  fails loudly if a data refresh moved an anchor out from under a shot.
- **Watch all 75 seconds.** Check the deadline strip shows a *future* deadline
  and the captain podium names someone currently fit.
- **Watch the Squad Builder click land.** `squad_autopick` presses Auto pick on
  camera, and pressing it re-centres the toolbar underneath the pointer. If a
  layout change ever leaves the pointer pressing thin air, it will look like a
  fake recording — which is the one thing a product demo cannot look like.
- **Check the club badges.** They appear inside the product UI, which is fine —
  they are the app, not branding. Do not lift one out for a thumbnail or a
  channel avatar; `CLAUDE.md` rules out Premier League and club marks as brand
  assets.
- **Shot 8 is still missing.** `docs/LAUNCH.md` wants a My Team shot — "load
  your own team and get the same read on your XI" — and it is the single most
  persuasive thing the site does. The page is gated behind *"Available after
  Gameweek 1"* because it reads a live FPL squad, so it cannot be filmed
  pre-season. Add it to `shots.mjs` and re-render once GW1 has been played.
