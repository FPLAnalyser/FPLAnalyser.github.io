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
import datetime
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
# the newest first picks up this season's photos the day they land — but it is
# probed ONCE per run rather than once per player, because "costs a 404 while
# it doesn't exist yet" turned out to be wrong twice over. The host answers a
# bucket that does not exist with a 5xx, not a 404, so every probe was counted
# as the host refusing us; and there were 1692 of them a day, which was the
# entire eleven minutes this script used to take and the entire reason it
# reported itself blocked. See `live_buckets()`.
# Measured, not guessed (see photo_bucket_check.py): premierleague25 carries
# the newest headshots that exist — shot August 2025 — and the unversioned
# legacy path is a year older than that. There is no 26/27 bucket yet; it is
# listed first so the mirror picks those photos up on the day it appears.
SEASON_BUCKETS = ("premierleague26", "premierleague25")
SEASON_SIZES = ("440x700", "250x250", "110x140")
LEGACY_SIZES = ("250x250", "110x140")


def player_urls(code: int, buckets: tuple[str, ...]) -> list[tuple[str, str]]:
    """(url, provenance) newest-season first, legacy last."""
    out = []
    for bucket in buckets:
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
requests_made = 0


def fetch(url: str) -> bytes | None:
    """The bytes, or None if there is no image there.

    Nothing raises. A mirror is a nice-to-have — the front end still falls
    through to the CDN and then to a monogram — and it must never be able to
    take the availability refresh down with it, which is exactly what the first
    version did when the host started answering 403."""
    global blocked, requests_made
    requests_made += 1
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        # 403 and 404 both mean "no image here, try the next rung". The host
        # answers 403 for a size a bucket doesn't carry — premierleague25 does
        # it for every 250x250 — and treating that as a block is what sent the
        # mirror down to the archive and put two-season-old photos on the site.
        # Only a 5xx or a dead connection is worth calling blocked.
        if e.code >= 500:
            blocked += 1
        return None
    except (urllib.error.URLError, TimeoutError, OSError):
        blocked += 1
        return None


# Sized for the share image, not the screen.
#
# This was 300 — "twice the tallest thing the site draws a headshot at" — which
# was right when the only consumer was the page. A share image is a different
# job: the captain podium draws a headshot about 330px tall in a 4:5 export and
# taller again in a story, so a 300px cap would have thrown away exactly the
# resolution the export needs, and every player would have arrived slightly
# soft the moment a better source existed.
#
# Costs nothing today. Every current headshot is 220x280 — the only rung the
# league's CDN is serving for 2026/27 so far — and `thumbnail` never enlarges,
# so no file changes size until the bigger photos are published. It means that
# when they are, the resolution survives instead of being discarded on arrival.
MAX_PX = 600


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

def live_buckets(codes: list[int]) -> tuple[str, ...]:
    """Which season buckets the host is actually serving today.

    Asking per player is what cost this script eleven minutes a day. The
    2026/27 bucket does not exist yet, and the host answers a bucket that does
    not exist with a 5xx rather than a 404 — so all 1692 probes a day counted
    as the host refusing us, and the script spent the whole run warning that it
    was blocked when nothing was wrong at all.

    A bucket is either published or it is not; that is one question, not one
    question per player. Ask it with a handful of codes spread through the
    list, because a single player might have no photo for reasons of his own,
    and stop at the first image that comes back."""
    global blocked
    # A bucket that is not published yet answers 5xx, and counting that as the
    # host refusing us is the false alarm this whole function exists to end.
    # Asking the question cannot be evidence for the answer being bad news.
    before = blocked
    sample = codes[:: max(1, len(codes) // 8)][:8]
    live = []
    for bucket in SEASON_BUCKETS:
        found = False
        for code in sample:
            for size in SEASON_SIZES:
                if fetch(f"{CDN}/{bucket}/photos/players/{size}/{code}.png"):
                    found = True
                    break
            if found:
                break
        if found:
            live.append(bucket)
        else:
            print(f"  {bucket} is not being served yet — skipped this run")
    blocked = before
    return tuple(live)


# Players the league has no photo for, and when we last looked.
#
# FPL lists a player the day he signs and the photo follows whenever it
# follows, so this is a normal state and not an error. It was being re-checked
# in full every morning — 86 players x 8 URLs = 688 requests a day for an
# answer that had not changed since July. Once a week is often enough for a
# photograph.
MISSES = os.path.join(OUT, "no-photo.json")
MISS_RECHECK_DAYS = 7
TODAY = datetime.date.today()
try:
    with open(MISSES, encoding="utf-8") as f:
        misses: dict[str, str] = json.load(f)
except (OSError, ValueError):
    misses = {}


def checked_recently(code: int) -> bool:
    seen = misses.get(str(code))
    if not seen:
        return False
    try:
        return (TODAY - datetime.date.fromisoformat(seen)).days < MISS_RECHECK_DAYS
    except ValueError:
        return False


BUCKETS = live_buckets([p["code"] for p in players if p.get("code") is not None])
BEST = BUCKETS[0] if BUCKETS else "legacy"
upgraded = skipped_misses = 0

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
    if not os.path.exists(path) and checked_recently(code):
        skipped_misses += 1
        continue
    # A host that is genuinely refusing us will refuse the next thousand
    # requests too, and the front end falls through to the CDN and then to a
    # monogram either way. Stop rather than spend ten minutes proving it.
    if blocked >= 60 and new_photos + upgraded == 0:
        print(f"  giving up after {blocked} refusals with nothing fetched", file=sys.stderr)
        break
    for url, bucket in player_urls(code, BUCKETS):
        # No point asking for something no better than what we already have.
        if have is not None and bucket == have:
            break
        body = fetch(url)
        if body and save(path, body):
            misses.pop(str(code), None)
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
            misses[str(code)] = TODAY.isoformat()

os.makedirs(OUT, exist_ok=True)
with open(MANIFEST, "w", encoding="utf-8") as f:
    json.dump(dict(sorted(sources.items())), f, indent=0, sort_keys=True)
with open(MISSES, "w", encoding="utf-8") as f:
    json.dump(dict(sorted(misses.items())), f, indent=0, sort_keys=True)

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
# Stated because it is the number that mattered: this used to be 2146 a run,
# and 1692 of those were probes at a bucket that does not exist.
print(f"  {requests_made} requests to the image host"
      + (f", {skipped_misses} players skipped (no photo, checked within {MISS_RECHECK_DAYS} days)" if skipped_misses else "")
      + (f", serving {'/'.join(BUCKETS)}" if BUCKETS else ", no season bucket live"))
by_bucket: dict[str, int] = {}
for v in sources.values():
    by_bucket[v] = by_bucket.get(v, 0) + 1
print("  headshot sources: " + ", ".join(f"{k} {v}" for k, v in sorted(by_bucket.items())))

# Which rung the league is actually serving, stated in pixels.
#
# The manifest records the bucket and not the size, so "premierleague25" reads
# as up to date while every file in it is 220x280 — the smallest rung, at 2x.
# Working that out meant opening the images and measuring, which is a poor way
# to learn that share images are soft because the source is 220px wide. The run
# says it now.
by_size: dict[str, int] = {}
for f in os.listdir(os.path.join(OUT, "players")) if os.path.isdir(os.path.join(OUT, "players")) else []:
    if not f.endswith(".webp"):
        continue
    try:
        with Image.open(os.path.join(OUT, "players", f)) as im:
            by_size[f"{im.size[0]}x{im.size[1]}"] = by_size.get(f"{im.size[0]}x{im.size[1]}", 0) + 1
    except Exception:
        pass
top = sorted(by_size.items(), key=lambda kv: -kv[1])[:4]
print("  headshot sizes: " + ", ".join(f"{k} x{v}" for k, v in top) + f" (cap {MAX_PX}px)")

# Loud, but not fatal — the workflow step carries continue-on-error so a
# blocked host still leaves the availability refresh free to commit. Silence
# is the thing to avoid: a mirror that quietly stops working looks exactly
# like a mirror with nothing new to fetch.
# Only worth saying when it is a real share of what we asked for. A handful of
# refusals is the internet; the old wording fired on a number the script was
# generating itself and cried wolf every morning for a fortnight.
if blocked and requests_made and blocked > max(10, requests_made * 0.25):
    print(f"  WARNING: {blocked} of {requests_made} requests were refused by the host, not 404s — "
          f"the mirror is being blocked and the share images will be missing crests and players.",
          file=sys.stderr)
    if new_badges + new_photos == 0 and bn + pn == 0:
        sys.exit(1)
