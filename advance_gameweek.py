#!/usr/bin/env python3
"""advance_gameweek.py — move the site on to the next gameweek the moment the
current one locks, instead of waiting for the final whistle.

WHY THIS EXISTS AS ITS OWN JOB. A gameweek closes at its DEADLINE: from that
moment the teams are set, no transfer can be made, and nothing the site says
about it can be acted on. Its fixtures are not finished until late on Monday.
So for three days — Friday evening to Monday night, the exact stretch when
people are thinking about next week — the Preview page, the Squad Builder and
the fixture grid all sat on a gameweek nobody could change any more.

The full pipeline now takes the deadline as the line (see build_site_data.py),
but it runs once a week, by hand, on a Monday. This is the small piece that
cannot wait for that: it advances the pointer and trims the fixture grid, and
nothing else. No ratings, no odds, no availability — those all have their own
jobs and their own cadence.

SAFE TO RUN AT ANY MOMENT, and it is: the scheduled job calls it every quarter
of an hour. It computes the answer from the deadlines rather than from what it
last did, writes only when something would actually change, and exits 0 either
way. Running it twice, or ten times, or after a missed run, all land in the
same place.

WHAT IT DOES NOT DO. It will not un-advance. If the site is already showing a
later gameweek than the deadlines imply — because a full pipeline run got there
first, or a fixture was postponed and FPL moved a deadline out — it leaves
things alone and says so. Moving a reader BACK to a gameweek they can no longer
plan for is the bug this file exists to fix.

Usage:  python3 advance_gameweek.py [--dry-run]
Exit:   0 always, unless the API or the files are unreadable.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site_data")
API = "https://fantasy.premierleague.com/api"
DRY = "--dry-run" in sys.argv


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-advance"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


# Same rule as refresh_availability: the API describes the season FPL is
# running now, which is the newest entry, not necessarily "current".
with open(os.path.join(ROOT, "seasons.json"), encoding="utf-8") as f:
    season = json.load(f)["seasons"][0]["id"]
season_dir = os.path.join(ROOT, season)
meta_path = os.path.join(season_dir, "meta.json")
ease_path = os.path.join(season_dir, "fixture_ease.json")

# How long after a deadline to wait before moving the site on.
#
# ZERO, deliberately. It was half an hour on the theory that people open the
# site straight after the deadline to look at the team they just locked in, and
# would rather it did not move under them. The call went the other way: the
# sooner the site is on next week, the sooner it is useful, and the gameweek
# just locked is not somewhere anyone needs to be kept. `deadline_time` is
# authoritative the second it passes, so nothing technical wanted the wait
# either. Raise it if the instant switch ever feels abrupt.
SETTLE = timedelta(minutes=0)

now = datetime.now(timezone.utc) - SETTLE
events = get(f"{API}/bootstrap-static/")["events"]

deadlines = {}
for e in events:
    try:
        deadlines[int(e["id"])] = datetime.fromisoformat(
            str(e["deadline_time"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        continue
if not deadlines:
    print("No deadlines in the API payload — nothing to do.")
    raise SystemExit(0)

locked = sorted(gw for gw, d in deadlines.items() if d <= now)
unlocked = sorted(gw for gw, d in deadlines.items() if d > now)
current_gw = locked[-1] if locked else None
next_gw = unlocked[0] if unlocked else None
print(f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC} · {season}"
      f"  (counting a deadline as passed {int(SETTLE.total_seconds() // 60)} min after it lands)")
print(f"  locked: {f'GW{locked[0]}–GW{locked[-1]}' if locked else 'none'}"
      f"   current → {current_gw}   next → {next_gw}")

changed = []

# ── meta.json: the pointer every page reads ───────────────────────────────
with open(meta_path, encoding="utf-8") as f:
    meta = json.load(f)
was_next = meta.get("next_gw")
if next_gw is None:
    # Season over: every deadline is behind us. `None` is what the full
    # pipeline writes here too, and the frontend already treats it as "no next
    # gameweek" rather than falling over — leaving the last one in place would
    # point at a gameweek that has been and gone.
    if was_next is not None:
        meta["next_gw"] = None
        meta["current_gw"] = current_gw
        changed.append(f"meta.json next_gw {was_next} → None (season complete)")
elif was_next is None or next_gw > was_next:
    meta["next_gw"] = next_gw
    meta["current_gw"] = current_gw
    changed.append(f"meta.json next_gw {was_next} → {next_gw}")
elif next_gw < was_next:
    # Never walk a reader back onto a locked gameweek — see the docstring.
    print(f"  meta.json already at GW{was_next}, ahead of GW{next_gw} — left alone")

# ── fixture_ease.json: what the Squad Builder plans against ───────────────
#
# The board takes min(gw) as the week it is planning, so a locked gameweek left
# in this file keeps it planning a team nobody can change. Trimmed rather than
# rebuilt: every other field is whatever the last full pipeline run computed.
if os.path.exists(ease_path):
    with open(ease_path, encoding="utf-8") as f:
        ease = json.load(f)
    rows = ease["rows"] if isinstance(ease, dict) and "rows" in ease else ease
    if isinstance(rows, list):
        keep = [r for r in rows if r.get("gw") not in set(locked)]
        if len(keep) != len(rows):
            dropped = sorted({r.get("gw") for r in rows if r.get("gw") in set(locked)})
            if not keep:
                # Every gameweek in the file is locked. Emptying it would take
                # the fixture grid, the Squad Builder and the projections down
                # with it; a stale grid is a far smaller problem.
                print(f"  fixture_ease.json — every gameweek locked, left alone "
                      f"(needs a full pipeline run for GW{next_gw})")
            else:
                if isinstance(ease, dict) and "rows" in ease:
                    ease["rows"] = keep
                else:
                    ease = keep
                changed.append(f"fixture_ease.json dropped GW{dropped} ({len(rows) - len(keep)} rows)")
                if not DRY:
                    with open(ease_path, "w", encoding="utf-8") as f:
                        json.dump(ease, f, ensure_ascii=False, separators=(",", ":"))

if not changed:
    print("  nothing to do — the site is already on the right gameweek.")
    raise SystemExit(0)

if not DRY:
    meta["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

for c in changed:
    print(f"  {'would change' if DRY else 'changed'}: {c}")
