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

250x250 is the only size mirrored, because nothing on the site draws a headshot
taller than 150px — so it is already twice the largest render, which is what a
retina screen and the 2x export both want.

Idempotent: a file that already exists is left alone, so the daily run costs
one HEAD-shaped GET per new player rather than re-fetching the league. Run from
the repo root.
"""
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "site_data")
OUT = os.path.join(ROOT, "public", "img")
CDN = "https://resources.premierleague.com"

# The current-season bucket first, then the legacy one — the same chain the
# front end walks, for the same reason: the legacy bucket still holds a
# transferred player's photo in his OLD kit.
PLAYER_URLS = (
    f"{CDN}/premierleague25/photos/players/250x250/{{code}}.png",
    f"{CDN}/premierleague/photos/players/250x250/p{{code}}.png",
)
BADGE_URL = f"{CDN}/premierleague/badges/t{{code}}.png"


def fetch(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-mirror"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except urllib.error.URLError:
        return None


def save(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Write beside the target and move, so an interrupted run never leaves a
    # half-written PNG that the next run would treat as already mirrored.
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


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
    path = os.path.join(OUT, "badges", f"t{code}.png")
    if os.path.exists(path):
        continue
    body = fetch(BADGE_URL.format(code=code))
    if body:
        save(path, body)
        new_badges += 1
    else:
        missing += 1
        print(f"  no crest for {t.get('short_name', code)}", file=sys.stderr)

# One headshot per player currently in the game. Players who leave keep their
# file — it costs a few KB and it means an archived season still renders.
for p in players:
    code = p.get("code")
    if code is None:
        continue
    path = os.path.join(OUT, "players", f"{code}.png")
    if os.path.exists(path):
        continue
    body = None
    for url in PLAYER_URLS:
        body = fetch(url.format(code=code))
        if body:
            break
    if body:
        save(path, body)
        new_photos += 1
    else:
        # Not an error: FPL lists players before the photo exists, and the
        # front end still falls through to the CDN and then the monogram.
        missing += 1

def usage(sub: str) -> tuple[int, int]:
    d = os.path.join(OUT, sub)
    if not os.path.isdir(d):
        return 0, 0
    files = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".png")]
    return len(files), sum(os.path.getsize(f) for f in files)

bn, bb = usage("badges")
pn, pb = usage("players")
print(f"public/img: {bn} crests ({bb / 1e6:.1f} MB), {pn} headshots ({pb / 1e6:.1f} MB)")
print(f"  added {new_badges} crests and {new_photos} headshots this run; {missing} had no image")
