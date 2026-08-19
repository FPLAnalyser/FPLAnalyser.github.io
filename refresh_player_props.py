#!/usr/bin/env python3
"""refresh_player_props.py — per-player goal expectancy, straight from the market.

The site derives a player's goal term from his team's lambda times his share of
the team's shots times the quality of those shots — a decomposition fitted to
however many shots he has taken (27, for the first player in shot_profiles).
Bookmakers quote the same quantity directly, for every player likely to appear.

This fetches anytime-scorer and shots-on-target prices per fixture, matches the
names to FPL ids, and writes site_data/<season>/player_props.json. It does not
decide how the numbers are used — see the note on calibration below for what
they do and do not mean.

Cost: 1 credit per market per region per fixture. Default us + two markets = 2
per fixture, ~20 a round. PROPS_REGIONS widens the bookmaker pool at the same
rate again per region. PROPS_LIMIT caps fixtures, for trial runs.

Two things about this data that matter more than the fetching:

Matching is scoped to the fixture. A bookmaker writes "Gabriel Jesus", FPL
holds first/second/web names, and neither carries the other's id. Matching
against all 700-odd FPL players would make surname collisions routine; matching
against only the two clubs in the fixture makes them rare, and the ones that
remain are caught and reported rather than guessed at.

Calibration is not optional. The books quote a Yes price per player and no No
price, so the overround cannot be removed player by player. What can be done
is to require the parts to agree with the whole: under Poisson, a player who
scores with probability p has expected goals -ln(1-p), and those should sum,
over a team's players, to the team lambda the fixture is already priced at.
The ratio of the two is recorded as `scale` per team. It absorbs both the
overround and the goals of players nobody priced, so a value far from 1 is a
signal to look rather than a number to trust.
"""
import datetime
import json
import math
import os
import re
import sys
import unicodedata

import refresh_odds as ro          # norm/demargin/median/get, and the alias table

MARKETS = os.environ.get("PROPS_MARKETS",
                         "player_goal_scorer_anytime,player_shots_on_target")
REGIONS = [r.strip() for r in os.environ.get("PROPS_REGIONS", "us").split(",") if r.strip()]


# Letters that decomposition will not touch, because they are letters in their
# own right rather than a base plus a mark. Odegaard cost a match to this.
TRANSLIT = str.maketrans({"ø": "o", "Ø": "o", "æ": "ae", "Æ": "ae", "å": "a", "Å": "a",
                          "ß": "ss", "đ": "d", "Đ": "d", "ł": "l", "Ł": "l",
                          "ı": "i", "ð": "d", "Ð": "d", "þ": "th", "œ": "oe"})


def fold(name):
    """Strip accents, punctuation and case. 'Gabriel Jesus' and 'Gabriel Jesús'
       have to land on the same key, and 'O'Riley' must not lose the O."""
    s = unicodedata.normalize("NFKD", str(name).translate(TRANSLIT))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# Nobody's surname starts at the particle. FPL files Gabriel Jesus under
# "Fernando de Jesus" and Gabriel Magalhaes under "dos Santos Magalhaes";
# a bookmaker writes "Gabriel Jesus" and "Gabriel Magalhaes", and neither
# spelling exists in the record until the particles are stepped over.
PARTICLES = {"de", "del", "da", "dos", "das", "van", "von", "der", "den",
             "di", "du", "la", "le", "el", "al", "bin", "ibn"}


def name_keys(p):
    """Every spelling of an FPL player a bookmaker might use."""
    first, second, web = p.get("first_name", ""), p.get("second_name", ""), p.get("web_name", "")
    keys = {fold(f"{first} {second}"), fold(second), fold(web), fold(f"{first} {web}")}
    parts = [t for t in fold(second).split() if t not in PARTICLES]
    if parts:
        keys.add(parts[-1])                            # surname alone
        keys.add(" ".join(parts))                      # surname without particles
        keys.add(f"{fold(first)} {parts[-1]}".strip())  # first + surname
        keys.add(f"{fold(first)} {parts[0]}".strip())   # ...and the first of several
        keys.add(f"{parts[-1]} {fold(first)}".strip())  # "Magalhaes Gabriel", surname first
    return {k for k in keys if k}


def squad_index(players, team_ids):
    """name key -> fpl id, for the two clubs in one fixture. A key claimed by
       two players in the same fixture is dropped: an unmatched name is a line
       in the report, a mismatched one is a wrong number on a player page."""
    idx, clashes = {}, set()
    for p in players:
        if p["team"] not in team_ids:
            continue
        for k in name_keys(p):
            if k in idx and idx[k] != p["id"]:
                clashes.add(k)
            idx[k] = p["id"]
    for k in clashes:
        idx.pop(k, None)
    return idx, clashes


def prices_for(event, markets_wanted):
    """{market key: {player name: [prices]}} across every bookmaker."""
    out = {}
    for bk in event.get("bookmakers", []):
        for mk in bk.get("markets", []):
            if mk.get("key") not in markets_wanted:
                continue
            for o in mk.get("outcomes", []):
                who = o.get("description")
                if not who or o.get("price") in (None, 0):
                    continue
                if fold(who) in ("no scorer", "no goalscorer", "none", "no player"):
                    continue          # a real outcome, but not a player
                key = mk["key"]
                if key == "player_goal_scorer_anytime":
                    # Books that quote both sides put the No price in the same
                    # market. Taking a median across a mixed bag of Yes and No
                    # prices reads a 1.4 No as a 71% chance of scoring, which
                    # is how a squad came to imply 5.63 goals against a lambda
                    # of 2.19.
                    if str(o.get("name", "")).lower() != "yes":
                        continue
                if key == "player_shots_on_target":
                    # a ladder: keep the 0.5 line, the one that means "had a shot on target"
                    if o.get("point") != 0.5 or str(o.get("name", "")).lower() != "over":
                        continue
                out.setdefault(key, {}).setdefault(who, []).append(o["price"])
    return out


def to_prob(prices):
    return 1.0 / ro.median(prices)


if __name__ == "__main__":
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key:
        sys.exit("ODDS_API_KEY is not set — player props need the paid feed")

    with open(os.path.join(ro.ROOT, "seasons.json"), encoding="utf-8") as f:
        season = json.load(f)["seasons"][0]["id"]
    out_path = os.path.join(ro.ROOT, season, "player_props.json")

    boot, _ = ro.get(f"{ro.FPL}/bootstrap-static/")
    team_by_norm = {ro.norm(t["name"]): t["id"] for t in boot["teams"]}
    players = boot["elements"]

    # Team lambdas already solved by refresh_odds, for the calibration check.
    lam = {}
    for m in ro.read_existing(os.path.join(ro.ROOT, season, "odds.json")).get("matches", []):
        lam[(m["h"], m["a"])] = (m["lh"], m["la"])

    events, _ = ro.get(f"{ro.ODDS_HOST}/events?apiKey={key}")     # free
    limit = int(os.environ.get("PROPS_LIMIT", "0") or 0)
    wanted = set(MARKETS.split(","))

    out, unmatched, remaining = {}, [], "?"
    for i, ev in enumerate(sorted(events, key=lambda e: e.get("commence_time", ""))):
        if limit and i >= limit:
            break
        h = team_by_norm.get(ro.norm(ev["home_team"]))
        a = team_by_norm.get(ro.norm(ev["away_team"]))
        if h is None or a is None:
            unmatched.append(f"club: {ev['home_team']} v {ev['away_team']}")
            continue

        merged = {"bookmakers": []}
        for region in REGIONS:
            full, remaining = ro.event_markets(key, ev["id"], region, MARKETS)
            if full:
                merged["bookmakers"] += full.get("bookmakers", [])
        quotes = prices_for(merged, wanted)
        if not quotes:
            print(f"  no props quoted: {ev['home_team']} v {ev['away_team']}")
            continue

        idx, clashes = squad_index(players, {h, a})
        # Last resort: the quoted surname alone, when exactly one player in the
        # fixture answers to it. "Ben White" is "Benjamin White" in FPL, and no
        # amount of key-building on the record side produces the short form.
        surnames = {}
        for pl in players:
            if pl["team"] in (h, a):
                sn = [t for t in fold(pl["second_name"]).split() if t not in PARTICLES]
                if sn:
                    surnames.setdefault(sn[-1], []).append(pl["id"])
        surnames = {k: v[0] for k, v in surnames.items() if len(v) == 1}
        rows = {}
        for market, by_name in quotes.items():
            for who, prices in by_name.items():
                pid = idx.get(fold(who)) or surnames.get(fold(who).split()[-1])
                if pid is None:
                    unmatched.append(f"{who} ({ev['home_team']} v {ev['away_team']})")
                    continue
                row = rows.setdefault(pid, {"fx": [h, a], "books": 0})
                if market == "player_goal_scorer_anytime":
                    row["p_raw"] = round(to_prob(prices), 4)
                    row["books"] = len(prices)
                else:
                    row["sot"] = round(to_prob(prices), 4)

        # ── calibration: the parts against the whole ────────────────────────
        # Expected goals implied by each player, summed per club, against the
        # lambda the fixture is priced at. Recorded, not silently applied.
        team_of = {p["id"]: p["team"] for p in players}
        for side, team_id, lam_i in (("h", h, 0), ("a", a, 1)):
            ids = [pid for pid in rows if team_of.get(pid) == team_id and "p_raw" in rows[pid]]
            if not ids or (h, a) not in lam:
                continue
            total = sum(-math.log(1 - min(rows[pid]["p_raw"], 0.99)) for pid in ids)
            target = lam[(h, a)][lam_i]
            scale = round(target / total, 3) if total else None
            for pid in ids:
                rows[pid]["scale"] = scale
                if scale:
                    xg = -math.log(1 - min(rows[pid]["p_raw"], 0.99)) * scale
                    rows[pid]["xg"] = round(xg, 4)
            print(f"  {ev['home_team'] if side == 'h' else ev['away_team']}: "
                  f"{len(ids)} players priced, sum xg {total:.2f} vs lambda {target:.2f} "
                  f"-> scale {scale}")
        out.update({str(k): v for k, v in rows.items()})
        if clashes:
            print(f"  ambiguous names dropped for this fixture: {sorted(clashes)[:4]}")

    payload = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "the-odds-api",
        "regions": REGIONS,
        "markets": MARKETS.split(","),
        "players": out,
    }
    matched = len(out)
    print(f"{matched} players matched, {len(unmatched)} names unmatched "
          f"| credits remaining: {remaining}")
    if unmatched:
        seen = sorted(set(unmatched))
        print(f"unmatched ({len(seen)} distinct): " + ", ".join(seen[:14]))

    if "--dry-run" in sys.argv:
        print("dry run — not writing " + out_path)
        for pid, r in list(sorted(out.items(), key=lambda kv: -(kv[1].get("xg") or 0)))[:12]:
            name = next((p["web_name"] for p in players if str(p["id"]) == pid), pid)
            print(f"  {name:<18} p {r.get('p_raw')}  xg {r.get('xg')}  "
                  f"sot {r.get('sot')}  books {r['books']}")
        sys.exit(0)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{out_path}: {matched} players")
