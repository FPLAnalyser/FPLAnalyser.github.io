#!/usr/bin/env python3
"""build_depth_charts.py — resolve the supplied projected lineups against FPL's
own squad list, and emit the result for the frontend.

WHAT THIS IS FOR. FPL publishes one position per player — DEF — so the minutes
allocation in lib/minutes pools all seven Arsenal defenders against 4.04
shirts. Timber being ruled out therefore spread his minutes across centre
backs. A role chart puts him in RB, and his share redistributes inside RB,
which is where it actually goes.

WHAT THIS FILE REFUSES TO DO. It will not invent a player. FPL's squad list is
the authority for who exists in the game: a name in the chart that FPL does not
carry is DROPPED and its slot renormalised, because a player who cannot be
picked cannot score. Same for a name FPL places at a different club — the chart
is one forecaster's view of a transfer, the FPL squad list is the game.

Every drop is printed. Silence would let 40% of a full back's minutes vanish
without anyone noticing.

Run from the repo root. Writes site_data/<newest season>/depth_charts.json.
"""
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site_data")

with open(os.path.join(SITE, "seasons.json"), encoding="utf-8") as f:
    season = json.load(f)["seasons"][0]["id"]

with open(os.path.join(ROOT, "depth_charts.json"), encoding="utf-8") as f:
    chart = json.load(f)
with open(os.path.join(SITE, season, "availability.json"), encoding="utf-8") as f:
    squad = json.load(f)["players"]
with open(os.path.join(SITE, season, "teams.json"), encoding="utf-8") as f:
    tj = json.load(f)
rows = tj["rows"] if isinstance(tj, dict) and "rows" in tj else tj
short = {i + 1: t["short_name"] for i, t in enumerate(rows)}

# ── names the chart writes differently from FPL ───────────────────────────
#
# Kept as an explicit, auditable list rather than a fuzzy match, because a
# fuzzy match that is wrong is worse than a name that fails loudly: it would
# hand one player's minutes to another and never say so.
#
#   Jaden -> Philogene   the chart prints his FIRST name; FPL prints his
#                        surname, and there is no other Jaden at Ipswich.
ALIASES = {
    ("IPS", "jaden"): "philogene",
}


# LETTERS NFKD WILL NOT TAKE APART. Stripping accents by decomposing and
# dropping the combining marks handles é and ö, and silently DELETES every
# letter that is its own codepoint rather than a base plus a mark. FPL spells
# Brighton's left back F.Kadıoğlu with a Turkish dotless i, which decomposes to
# nothing, so the normaliser produced "fkadoglu" — no i at all — and 84% of a
# full back's minutes were dropped as an unknown player. Folded by hand first.
FOLD = str.maketrans({
    "ı": "i", "İ": "i", "ø": "o", "Ø": "o", "ð": "d", "Ð": "d",
    "đ": "d", "Đ": "d", "ł": "l", "Ł": "l", "þ": "th", "Þ": "th",
    "æ": "ae", "Æ": "ae", "œ": "oe", "Œ": "oe", "ß": "ss",
})


def norm(s: str) -> str:
    s = str(s).translate(FOLD)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", s.lower())


by_club: dict[str, list] = {}
for p in squad:
    by_club.setdefault(short.get(p["team"], "?"), []).append(p)

out: dict[str, dict] = {}
dropped: list[tuple] = []
kept = 0

for club, d in chart["teams"].items():
    pool = by_club.get(club, [])
    idx = {norm(p["name"]): p for p in pool}
    slots: dict[str, list] = {}
    for slot, entries in d["slots"].items():
        placed = []
        for name, pct in entries:
            n = ALIASES.get((club, norm(name)), norm(name))
            p = idx.get(n)
            if p is None:
                # A unique containment match covers "Van De Ven" against FPL's
                # "van de Ven" and the like. Ambiguity is treated as no match.
                cand = [q for q in pool if n and (n in norm(q["name"]) or norm(q["name"]) in n)]
                p = cand[0] if len(cand) == 1 else None
            if p is None:
                dropped.append((club, slot, name, pct))
                continue
            placed.append({"code": int(p["code"]), "name": p["name"], "share": float(pct)})
            kept += 1
        if not placed:
            continue
        # NORMALISE. The transcription is from graphics and one slot came to
        # 108; dropping an unmatched name leaves others short. Either way what
        # matters is the RATIO between the players in a slot, so every slot is
        # rescaled to sum to one and neither problem can reach the projection.
        total = sum(x["share"] for x in placed)
        for x in placed:
            x["share"] = round(x["share"] / total, 4)
        slots[slot] = placed
    out[club] = {"formation": d["formation"], "slots": slots}

print(f"  resolved {kept} player-slot entries across {len(out)} clubs")
if dropped:
    print(f"  dropped {len(dropped)} — not in FPL's squad for that club, so unpickable:")
    for club, slot, name, pct in sorted(dropped, key=lambda r: -r[3]):
        print(f"    {club} {slot:4s} {name:22s} {pct:3.0f}%")

# Sanity the frontend depends on: a slot is one shirt, and every club's slots
# must cover the eleven a team fields.
for club, d in out.items():
    n = len(d["slots"])
    if n != 11:
        print(f"  WARNING {club} resolved to {n} slots, not 11")

payload = {
    "captured": chart.get("captured"),
    "note": "Projected lineups by role. Supplied, not measured — see depth_charts.json.",
    "teams": out,
}
dest = os.path.join(SITE, season, "depth_charts.json")
with open(dest, "w", encoding="utf-8") as f:
    json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
print(f"{dest}: {len(out)} clubs, captured {payload['captured']}")
