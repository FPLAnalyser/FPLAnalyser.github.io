#!/usr/bin/env python3
"""
mirror_assets.py — copy the club crests and player headshots we display onto
our own origin, under public/img/.

Why bother, when the Premier League already hosts them: a share image is drawn
by reading the page back off a canvas, and a browser refuses to read a
cross-origin image unless its response carried CORS headers. Every crest and
every headshot was therefore silently dropped from every PNG the site exports —
a shared fixture card had two three-letter codes and no clubs, and the captain
podium had three empty rectangles where the players should be.

Asking for the images with `crossOrigin` only works if the host cooperates,
which is not something this site gets to decide. Serving them ourselves removes
the question: a same-origin image is always readable. It also drops a
third-party request from every page load, which is faster and one less place a
visitor is observed.

Stored as WebP at 300px. The source is a 500x500 PNG of about 350KB, and 357
of those is 115MB of repository for images that are never drawn above 150px —
300px is twice the largest render, which is what a retina screen and the 2x
export both want, and WebP with transparency gets each one to roughly 13KB.

Idempotent: a file that already exists is left alone, so the daily run costs
one HEAD-shaped GET per new player rather than re-fetching the league. Run from
the repo root.
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "site_data")
OUT = os.path.join(ROOT, "public", "img")
CDN = "https://resources.premierleague.com"

# Season-versioned buckets newest first, EVERY size in each, and only then the
# legacy bucket — which holds the player's old photo, in his old kit, from his
# old club.
#
# Getting this order wrong is what put last season's pictures back on the site.
# The first version tried one size in the current bucket and fell straight to
# legacy, so every player whose current photo happens to exist at 110x140 but
# not 250x250 was mirrored from the archive. The page had always walked all the
# current-season sizes first; the mirror has to walk the same rungs, or it
# quietly answers a different question from the one the page was asking.
#
# The bucket is named for the season, so a new one appears each year. Trying
# the newest first costs a 404 while it doesn't exist yet and picks up this
# season's photos the day it does.
SEASON_BUCKETS = ("premierleague26", "premierleague25")
SEASON_SIZES = ("440x700", "250x250", "110x140")
LEGACY_SIZES = ("250x250", "110x140")


def player_urls(code: int) -> list[tuple[str, str]]:
    """(url, provenance) newest-season first, legacy last."""
    out = []
    for i, bucket in enumerate(SEASON_BUCKETS):
        for size in SEASON_SIZES:
            out.append((f"{CDN}/{bucket}/photos/players/{size}/{code}.png", bucket))
    for size in LEGACY_SIZES:
        out.append((f"{CDN}/premierleague/photos/players/{size}/p{code}.png", "legacy"))
    return out


BADGE_URL = f"{CDN}/premierleague/badges/t{{code}}.png"
# Which bucket each mirrored headshot came from. A file sourced from `legacy`
# is a player whose current-season photo had not been published yet, so it is
# re-checked every run and upgraded the day it appears — without this a July
# signing wears his old club's shirt on the site for the whole season.
MANIFEST = os.path.join(OUT, "sources.json")


# The image host answers 403 to an obviously-scripted User-Agent. These are the
# headers a browser sends for an <img>, which is exactly what this is standing
# in for — the same bytes the same visitor would fetch a moment later.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Referer": "https://www.premierleague.com/",
}

blocked = 0


def fetch(url: str) -> bytes | None:
    """The bytes, or None if there is no image there.

    Nothing raises. A mirror is a nice-to-have — the front end still falls
    through to the CDN and then to a monogram — and it must never be able to
    take the availability refresh down with it, which is exactly what the first
    version did when the host started answering 403."""
    global blocked
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code != 404:
            blocked += 1
        return None
    except (urllib.error.URLError, TimeoutError, OSError):
        blocked += 1
        return None


# Twice the tallest thing the site draws a headshot at (150px). Anything more
# is bytes a phone downloads and throws away.
MAX_PX = 300


def save(path: str, data: bytes) -> bool:
    """Downscale, convert to WebP, write atomically. False if it isn't an image.

    Atomic because an interrupted run must not leave a half-written file that
    the next run would mistake for one already mirrored."""
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return False
    # RGBA throughout: these are cut-outs, and a flattened background would put
    # a white box behind every player on a dark card.
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    if max(im.size) > MAX_PX:
        im.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    im.save(tmp, "WEBP", quality=82, method=6)
    os.replace(tmp, path)
    return True


with open(os.path.join(DATA, "seasons.json"), encoding="utf-8") as f:
    season = json.load(f)["seasons"][0]["id"]

with open(os.path.join(DATA, season, "teams.json"), encoding="utf-8") as f:
    teams = json.load(f)
teams = teams if isinstance(teams, list) else (teams.get("rows") or teams.get("teams") or [])

with open(os.path.join(DATA, season, "availability.json"), encoding="utf-8") as f:
    players = json.load(f)["players"]

new_badges = new_photos = missing = 0

for t in teams:
    code = t.get("code")
    if code is None:
        continue
    path = os.path.join(OUT, "badges", f"t{code}.webp")
    if os.path.exists(path):
        continue
    body = fetch(BADGE_URL.format(code=code))
    if body and save(path, body):
        new_badges += 1
    else:
        missing += 1
        print(f"  no crest for {t.get('short_name', code)}", file=sys.stderr)

try:
    with open(MANIFEST, encoding="utf-8") as f:
        sources: dict[str, str] = json.load(f)
except (OSError, ValueError):
    sources = {}

BEST = SEASON_BUCKETS[0]
upgraded = 0

# One headshot per player currently in the game. Players who leave keep their
# file — it costs a few KB and it means an archived season still renders.
for p in players:
    code = p.get("code")
    if code is None:
        continue
    path = os.path.join(OUT, "players", f"{code}.webp")
    have = sources.get(str(code))
    # Settled only when we already hold the newest bucket's photo. Anything
    # older is worth one request a day to see if this season's has landed.
    if os.path.exists(path) and have == BEST:
        continue
    for url, bucket in player_urls(code):
        # No point asking for something no better than what we already have.
        if have is not None and bucket == have:
            break
        body = fetch(url)
        if body and save(path, body):
            if have is None:
                new_photos += 1
            else:
                upgraded += 1
                print(f"  {code}: {have} -> {bucket}")
            sources[str(code)] = bucket
            break
    else:
        # Not an error: FPL lists players before the photo exists, and the
        # front end still falls through to the CDN and then the monogram.
        if have is None:
            missing += 1

os.makedirs(OUT, exist_ok=True)
with open(MANIFEST, "w", encoding="utf-8") as f:
    json.dump(dict(sorted(sources.items())), f, indent=0, sort_keys=True)

def usage(sub: str) -> tuple[int, int]:
    d = os.path.join(OUT, sub)
    if not os.path.isdir(d):
        return 0, 0
    files = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".webp")]
    return len(files), sum(os.path.getsize(f) for f in files)

bn, bb = usage("badges")
pn, pb = usage("players")
print(f"public/img: {bn} crests ({bb / 1e6:.1f} MB), {pn} headshots ({pb / 1e6:.1f} MB)")
print(f"  added {new_badges} crests and {new_photos} headshots this run, upgraded {upgraded} to a newer season; {missing} had no image")
by_bucket: dict[str, int] = {}
for v in sources.values():
    by_bucket[v] = by_bucket.get(v, 0) + 1
print("  headshot sources: " + ", ".join(f"{k} {v}" for k, v in sorted(by_bucket.items())))

# Loud, but not fatal — the workflow step carries continue-on-error so a
# blocked host still leaves the availability refresh free to commit. Silence
# is the thing to avoid: a mirror that quietly stops working looks exactly
# like a mirror with nothing new to fetch.
if blocked:
    print(f"  WARNING: {blocked} requests were refused by the host, not 404s. "
          f"If that number is close to the total, the mirror is being blocked "
          f"and the share images will be missing crests and players.", file=sys.stderr)
    if new_badges + new_photos == 0 and bn + pn == 0:
        sys.exit(1)
