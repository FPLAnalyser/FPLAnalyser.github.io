#!/usr/bin/env python3
"""
photo_bucket_check.py — which Premier League image bucket holds the CURRENT
headshot, measured rather than assumed.

Throwaway diagnostic. The image host is unreachable from the dev sandbox, so
the bucket order in PlayerPhoto.tsx and mirror_assets.py has been guesswork,
and guessing wrong is what put last season's pictures on the site. This runs
on a GitHub runner, where the host IS reachable, and prints the status and
Last-Modified of every candidate for a handful of well-known players.

Last-Modified is the whole point: it says which file is actually the newest,
which no amount of reading the URL scheme can tell you.
"""
import json
import os
import sys
import urllib.error
import urllib.request

CDN = "https://resources.premierleague.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Referer": "https://www.premierleague.com/",
}

# Every naming scheme the bucket might plausibly use for 2026/27, plus the two
# we already know about and the unversioned legacy path.
CANDIDATES = [
    ("premierleague27", "{code}.png"),
    ("premierleague26", "{code}.png"),
    ("premierleague2627", "{code}.png"),
    ("premierleague25", "{code}.png"),
    ("premierleague", "p{code}.png"),
]
SIZES = ("250x250", "110x140")

ROOT = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(ROOT, "site_data", "seasons.json"), encoding="utf-8") as f:
    season = json.load(f)["seasons"][0]["id"]
with open(os.path.join(ROOT, "site_data", season, "availability.json"), encoding="utf-8") as f:
    players = json.load(f)["players"]

# The most-owned players: the ones a reader is most likely to be looking at,
# and the ones most likely to have a photo in every bucket.
sample = sorted(players, key=lambda p: -(p.get("own") or 0))[:6]


def head(url: str):
    req = urllib.request.Request(url, headers=HEADERS, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers.get("Last-Modified", "?"), r.headers.get("Content-Length", "?")
    except urllib.error.HTTPError as e:
        return e.code, "", ""
    except Exception as e:  # noqa: BLE001 — diagnostic, report anything
        return f"ERR {type(e).__name__}", "", ""


print(f"season {season}; probing {len(sample)} of the most-owned players\n")
for p in sample:
    code = p["code"]
    print(f"── code {code} (element {p['element']}, {p.get('own')}% owned)")
    for bucket, name in CANDIDATES:
        for size in SIZES:
            url = f"{CDN}/{bucket}/photos/players/{size}/{name.format(code=code)}"
            status, modified, length = head(url)
            if status == 200:
                print(f"   200  {bucket:18} {size:8} {length:>8}B  last-modified {modified}")
            else:
                print(f"   {status:<4} {bucket:18} {size:8}")
    print()

print("The bucket with the most recent Last-Modified is this season's.")
print("Put that one first in SEASON_BUCKETS in both PlayerPhoto.tsx and mirror_assets.py.")
sys.stdout.flush()
