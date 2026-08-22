#!/usr/bin/env python3
"""fpl_name_check.py — what does FPL actually hold for a name a bookmaker wrote?

Free: it touches only the FPL bootstrap, never the odds API, so it can be run
as often as it takes to settle an argument about a name.

The props pipeline reports names it could not place, and from a log line alone
there is no telling WHY: the player might be spelled differently, registered
under a different given name, filed at another club, or simply not in the game.
Those need different fixes, and guessing between them is how a matcher acquires
a rule that papers over the wrong one. So this prints, for each name, every
candidate FPL holds — its stored spelling, its club, and which matching rule
would or would not reach it.
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from refresh_player_props import PARTICLES, contained_in, fold, name_keys   # noqa: E402

NAMES = sys.argv[1:] or [
    "Yeremi Pino", "Ogochukwu Onyeka Frank", "Nathaniel Clyne", "Elijah Campbell",
    "Alan Browne", "Braiden Graham", "Cameron Humphreys", "David Ozoh",
    "Harvey Foster", "Jaydon Jones", "Jenson Jones", "Luis Semedo",
    "Tyrell Sellars-Fleming",
]

req = urllib.request.Request("https://fantasy.premierleague.com/api/bootstrap-static/",
                             headers={"User-Agent": "fpl-analyser-names"})
with urllib.request.urlopen(req, timeout=30) as r:
    boot = json.load(r)
clubs = {t["id"]: t["short_name"] for t in boot["teams"]}
players = boot["elements"]

for quoted in NAMES:
    tokens = set(fold(quoted).split()) - PARTICLES
    hits = []
    for p in players:
        keys = name_keys(p)
        shared = tokens & (set(fold(p["first_name"]).split()) | set(fold(p["second_name"]).split())
                           | set(fold(p["web_name"]).split()))
        if not shared:
            continue
        how = ("exact key" if fold(quoted) in keys else
               "containment" if contained_in(quoted, [p]) == p["id"] else
               f"partial ({'+'.join(sorted(shared))})")
        hits.append((len(shared), p, how))
    hits.sort(key=lambda h: -h[0])
    print(f"\n{quoted!r}")
    if not hits:
        print("   nothing in FPL shares a single name token — not in the game")
    for _, p, how in hits[:4]:
        print(f"   {clubs.get(p['team'], '?'):<4} id {p['id']:<4} "
              f"first={p['first_name']!r} second={p['second_name']!r} web={p['web_name']!r}"
              f"  -> {how}")
