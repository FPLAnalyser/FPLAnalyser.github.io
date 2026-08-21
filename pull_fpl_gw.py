#!/usr/bin/env python3
"""pull_fpl_gw.py — the actual points, straight from FPL, one gameweek at a time.

THE GAP THIS FILLS. Every other input to the pipeline has a fetcher in this
repo: Understat has pull_understat_data.py, Opta has pull_pl_stats.py, prices
and availability have refresh_availability.py. The FPL per-gameweek record —
points, minutes, goals, assists, bonus, and FPL's own expected goals and
assists — had none. player_gw_history.csv was produced outside the repo and
committed, which meant the one file the whole chain is built on could not be
refreshed by anything running here. enrich_player_gw.py reads it, and every
rating downstream reads that.

It is one public endpoint, no key and no auth: /event/<gw>/live/ returns every
player's full stat line for a gameweek, including expected_goals and
expected_assists. Provisional points appear within minutes of a whistle; bonus
firms up an hour or so after the last match of the day, so a gameweek is worth
re-pulling until FPL marks it finished.

WHY THAT MATTERS BEYOND THE PIPELINE. site_data/<season>/projections/gw<N>.json
now holds what the site PROJECTED before each deadline. This is the other half:
what actually happened. The two joined are the GW Review's "where the model
missed", which the site promises in two places and has never been able to show.

TWO OUTPUTS, AND THEY ARE FOR DIFFERENT THINGS.

  player_gw_history.csv is the RATINGS INPUT. Every rating on the site is
  built from it, and in August that means it should still hold last season —
  38 gameweeks of evidence beats one. Starting it over on GW1 would rebuild
  every rating from a single afternoon. So it is only ever touched
  deliberately, with --reset, when the owner decides the new season has enough
  behind it.

  site_data/<season>/actuals/gw<N>.json is the REVIEW INPUT, written by
  --actuals. It is the exact mirror of projections/gw<N>.json: what happened,
  next to what was projected. Nothing downstream of ratings reads it, so it is
  safe to write from the first gameweek of the season and every week after.

  python3 pull_fpl_gw.py --actuals     # every finished gameweek, to site_data
  python3 pull_fpl_gw.py 1 --actuals   # just this one
  python3 pull_fpl_gw.py               # every finished gameweek, to the CSV
  python3 pull_fpl_gw.py --live        # include the gameweek in progress
  python3 pull_fpl_gw.py --reset       # start a new season's CSV (archives the old)
  python3 pull_fpl_gw.py --dry-run     # fetch and report, write nothing

Rows for a gameweek REPLACE any already held for it, so re-running is safe and
a provisional pull is corrected by a later one. That applies to the actuals
too — unlike a projection, which is only true at its deadline and is therefore
written once, what happened is worth re-pulling until bonus settles.
"""
import argparse
import csv
import datetime
import json
import os
import shutil
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "player_gw_history.csv")
API = "https://fantasy.premierleague.com/api"
POS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}

# The column set player_gw_history.csv has always had, in its order. Written
# out rather than taken from the file so a fresh season starts identical to the
# old one instead of inheriting whatever the last writer happened to emit.
COLUMNS = [
    "element", "web_name", "team", "position", "element_type", "round",
    "gw_from_fixture", "fixture", "opponent_team", "total_points", "minutes",
    "goals_scored", "assists", "clean_sheets", "bonus", "bps", "value",
    "was_home", "kickoff_time", "team_h_score", "team_a_score", "modified",
    "goals_conceded", "own_goals", "penalties_saved", "penalties_missed",
    "yellow_cards", "red_cards", "saves", "influence", "creativity", "threat",
    "ict_index", "clearances_blocks_interceptions", "recoveries", "tackles",
    "defensive_contribution", "starts", "expected_goals", "expected_assists",
    "expected_goal_involvements", "expected_goals_conceded",
    "transfers_balance", "selected", "transfers_in", "transfers_out",
]
# Straight from the live payload's per-element `stats`, same names.
STAT_KEYS = [
    "total_points", "minutes", "goals_scored", "assists", "clean_sheets",
    "bonus", "bps", "goals_conceded", "own_goals", "penalties_saved",
    "penalties_missed", "yellow_cards", "red_cards", "saves", "influence",
    "creativity", "threat", "ict_index", "clearances_blocks_interceptions",
    "recoveries", "tackles", "defensive_contribution", "starts",
    "expected_goals", "expected_assists", "expected_goal_involvements",
    "expected_goals_conceded",
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-gw"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r)


def read_existing():
    if not os.path.exists(OUT):
        return []
    with open(OUT, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# What a review actually needs, and no more. Points and minutes to score the
# projection; the scoring events to say WHICH part of it missed; FPL's own xG
# and xA to separate a bad process from a bad afternoon.
ACTUAL_KEYS = [
    "total_points", "minutes", "starts", "goals_scored", "assists",
    "clean_sheets", "goals_conceded", "own_goals", "penalties_saved",
    "penalties_missed", "yellow_cards", "red_cards", "saves", "bonus", "bps",
    "defensive_contribution", "expected_goals", "expected_assists",
    "expected_goals_conceded",
]


def actuals(args, boot, elements, teams, fx, events):
    """Write what happened, next to where the projection for it already lives.

    Deliberately separate from the CSV path above: this touches nothing the
    ratings are built from, so it can run from GW1 without rewriting the
    evidence base underneath every number on the site.
    """
    with open(os.path.join(ROOT, "site_data", "seasons.json"), encoding="utf-8") as f:
        season = json.load(f)["seasons"][0]["id"]
    out_dir = os.path.join(ROOT, "site_data", season, "actuals")

    if args.gw:
        wanted = [args.gw]
    else:
        wanted = sorted(e["id"] for e in boot["events"]
                        if e.get("finished") or (args.live and e.get("is_current")))
    if not wanted:
        print("No gameweek has finished yet — nothing to pull.")
        return 0

    written = 0
    for gw in wanted:
        ev = events.get(gw, {})
        try:
            live = get(f"{API}/event/{gw}/live/")
        except urllib.error.HTTPError as exc:
            print(f"  GW{gw}: {exc.code} from the live endpoint — skipped")
            continue
        provisional = not ev.get("finished")

        players, played = [], 0
        for el in live.get("elements", []):
            meta = elements.get(el.get("id"))
            if not meta:
                continue
            stats = el.get("stats", {}) or {}
            # `stats` is already the whole gameweek for this player, both legs
            # of a double included, which is the right grain: the projection it
            # is being compared against was also one number for the week.
            opps = []
            for x in (el.get("explain") or []):
                f = fx.get(x.get("fixture"))
                if not f:
                    continue
                home = f.get("team_h") == meta["team"]
                opp = teams.get(f.get("team_a") if home else f.get("team_h"), "")
                if opp:
                    opps.append(f"{opp}{'(H)' if home else '(A)'}")
            row = {
                "code": meta.get("code"), "element": meta.get("id"),
                "name": meta.get("web_name", ""),
                "team": teams.get(meta.get("team"), ""),
                "pos": POS.get(meta.get("element_type"), ""),
                "opp": opps,
            }
            for k in ACTUAL_KEYS:
                v = stats.get(k, 0)
                try:
                    v = float(v)
                    v = int(v) if v == int(v) else round(v, 3)
                except (TypeError, ValueError):
                    v = 0
                row[k] = v
            players.append(row)
            if row["minutes"]:
                played += 1

        if not players:
            print(f"  GW{gw}: the live endpoint returned nobody — skipped")
            continue

        players.sort(key=lambda r: (-r["total_points"], r["name"]))
        payload = {
            "gw": gw, "season": season,
            "pulled": datetime.datetime.now(datetime.timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ"),
            # Bonus is not final until FPL says the gameweek is, so a review
            # built on a provisional pull has to be able to say so.
            "provisional": provisional,
            "players": players,
        }
        top = ", ".join(f"{p['name']} {p['total_points']}" for p in players[:5])
        print(f"  GW{gw}: {len(players)} players, {played} with minutes"
              f"{'  (PROVISIONAL — bonus may still move)' if provisional else ''}")
        print(f"    top: {top}")
        if args.dry_run:
            continue
        dest = os.path.join(out_dir, f"gw{gw}.json")
        # A finished gameweek returns the same numbers for ever. Rewriting the
        # file anyway would change only `pulled`, and the scheduled job would
        # commit that difference every night from now until May. Compare what
        # is actually being said, and leave the file alone if it has not moved.
        if os.path.exists(dest):
            try:
                with open(dest, encoding="utf-8") as f:
                    was = json.load(f)
                if was.get("players") == players and was.get("provisional") == provisional:
                    print("    unchanged since the last pull — left alone")
                    continue
            except (json.JSONDecodeError, OSError):
                pass  # unreadable, so rewrite it
        os.makedirs(out_dir, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        written += 1

    if args.dry_run:
        print(f"\nwould write up to {len(wanted)} gameweek(s) to site_data/{season}/actuals/")
    else:
        print(f"\nwrote {written} gameweek(s) to site_data/{season}/actuals/")
    return 0


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("gw", nargs="?", type=int, help="one gameweek; default is every finished one not stored")
    ap.add_argument("--live", action="store_true", help="also pull the gameweek in progress")
    ap.add_argument("--reset", action="store_true", help="start a new season's file, archiving the old")
    ap.add_argument("--actuals", action="store_true",
                    help="write site_data/<season>/actuals/gw<N>.json instead of the ratings CSV")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    boot = get(f"{API}/bootstrap-static/")
    fixtures = get(f"{API}/fixtures/")
    elements = {e["id"]: e for e in boot["elements"]}
    teams = {t["id"]: t["short_name"] for t in boot["teams"]}
    fx = {f["id"]: f for f in fixtures}
    events = {e["id"]: e for e in boot["events"]}

    if args.actuals:
        return actuals(args, boot, elements, teams, fx, events)

    rows = read_existing()

    # ── WHOSE SEASON IS IN THE FILE? ──────────────────────────────────────
    #
    # FPL reissues element ids every summer: last season's 1 is not this
    # season's 1. Appending a new season's rows to an old season's file does
    # not fail — it silently produces a file where the same id means two
    # different footballers, and every rating built on it is quietly wrong.
    # So the ids are checked against the names FPL has for them now, and a
    # mismatch stops the run rather than corrupting the file.
    if rows and not args.reset:
        sample = [r for r in rows[:400] if r.get("element") and r.get("web_name")]
        known = [r for r in sample if elements.get(int(r["element"]))]
        agreed = sum(1 for r in known if elements[int(r["element"])]["web_name"] == r["web_name"])
        # Two ways a stale file gives itself away, and it needs both checks.
        # Names disagreeing is the obvious one. The other is ids FPL no longer
        # issues at all: a file full of unrecognised ids has almost nothing to
        # compare, so a names-only test would find 5 matches out of 5 and wave
        # a whole previous season through.
        if len(sample) >= 20:
            recognised = len(known) / len(sample)
            matching = agreed / len(known) if known else 0.0
            if recognised < 0.5 or matching < 0.8:
                print(f"{OUT} holds a DIFFERENT season.")
                print(f"  {len(known)}/{len(sample)} of its element ids are ones FPL still issues,")
                print(f"  and {agreed}/{len(known)} of those still name the same player.")
                print("  FPL reissues element ids every summer, so appending would put two")
                print("  players under one id and quietly wrong every rating built on it.")
                print("  Archive it and start the new season with --reset.")
                return 2

    if args.reset and os.path.exists(OUT) and not args.dry_run:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d")
        dest = os.path.join(ROOT, f"player_gw_history.{stamp}.csv")
        shutil.copy2(OUT, dest)
        print(f"  archived the previous season to {os.path.basename(dest)}")
        rows = []

    have = {int(r["round"]) for r in rows if r.get("round")}

    if args.gw:
        wanted = [args.gw]
    else:
        wanted = sorted(
            e["id"] for e in boot["events"]
            if (e.get("finished") or (args.live and e.get("is_current"))) and e["id"] not in have
        )
    if not wanted:
        print(f"Nothing to pull — {len(have)} gameweek(s) already stored, none newly finished.")
        return 0

    fresh, notes = [], []
    for gw in wanted:
        ev = events.get(gw, {})
        try:
            live = get(f"{API}/event/{gw}/live/")
        except urllib.error.HTTPError as exc:
            print(f"  GW{gw}: {exc.code} from the live endpoint — skipped")
            continue
        provisional = not ev.get("finished")
        n = 0
        for el in live.get("elements", []):
            eid = el.get("id")
            meta = elements.get(eid)
            if not meta:
                continue
            stats = el.get("stats", {}) or {}
            # `explain` carries one entry per fixture the player featured in —
            # a double gameweek gives two, so each becomes its own row exactly
            # as the file has always held them.
            plays = [x for x in (el.get("explain") or []) if x.get("fixture")]
            if not plays:
                plays = [{"fixture": None}]
            for play in plays:
                f = fx.get(play.get("fixture")) or {}
                home = f.get("team_h") == meta["team"] if f else None
                row = {
                    "element": eid,
                    "web_name": meta.get("web_name", ""),
                    "team": teams.get(meta.get("team"), ""),
                    "position": POS.get(meta.get("element_type"), ""),
                    "element_type": meta.get("element_type", ""),
                    "round": gw,
                    "gw_from_fixture": f.get("event", gw) if f else gw,
                    "fixture": f.get("id", "") if f else "",
                    "opponent_team": (f.get("team_a") if home else f.get("team_h")) if f else "",
                    "value": meta.get("now_cost", ""),
                    "was_home": "" if home is None else str(bool(home)),
                    "kickoff_time": (f.get("kickoff_time") or "") if f else "",
                    "team_h_score": f.get("team_h_score") if f else "",
                    "team_a_score": f.get("team_a_score") if f else "",
                    # FPL's own flag for a corrected score line. Absent here —
                    # this endpoint does not carry it — so it is False rather
                    # than blank, which is what every existing row holds.
                    "modified": "False",
                    "transfers_balance": meta.get("transfers_in_event", 0) - meta.get("transfers_out_event", 0),
                    "selected": meta.get("selected_by_percent", ""),
                    "transfers_in": meta.get("transfers_in_event", 0),
                    "transfers_out": meta.get("transfers_out_event", 0),
                }
                for k in STAT_KEYS:
                    row[k] = stats.get(k, 0)
                fresh.append({c: row.get(c, "") for c in COLUMNS})
                n += 1
        notes.append(f"  GW{gw}: {n} rows{'  (PROVISIONAL — bonus may still move)' if provisional else ''}")

    for note in notes:
        print(note)
    if not fresh:
        print("Nothing fetched.")
        return 0

    # Replace rather than append: a provisional pull is corrected by a later
    # one, and re-running must never double a gameweek.
    pulled = {int(r["round"]) for r in fresh}
    kept = [r for r in rows if r.get("round") and int(r["round"]) not in pulled]
    out = kept + fresh
    out.sort(key=lambda r: (int(r["round"]), int(r["element"])))

    if args.dry_run:
        print(f"\nwould write {len(out)} rows ({len(kept)} kept, {len(fresh)} new) to {OUT}")
        return 0

    tmp = OUT + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(out)
    os.replace(tmp, OUT)
    print(f"\n{OUT} — {len(out)} rows across {len(pulled | {int(r['round']) for r in kept})} gameweek(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
