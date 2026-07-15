"""
BUILD SITE DATA — final pipeline step. Exports every table the website
consumes as JSON under site_data/, plus:

  meta.json          last-updated timestamp, current/next GW, row counts
                     (powers the site's data-staleness banner)
  fixture_ease.json  per team x upcoming GW (next 6): opponent, venue, FDR,
                     attack-ease and defence-ease factors from recent team
                     xGC / xG form (same blend as the next-4 rating)
  shots_conceded.json  per team: every Understat shot faced this season
  shots_for.json       per team: every Understat shot taken this season
  player_shots.json    per player (FPL element id): every shot they took,
                     for the per-player shot map
                     (x, y, xG, result) for the team page's shot map, one
                     grouped by the conceding team and one by the shooting
                     team (same rows, different key + venue flipped).
                     Sourced from data/understat_shots.csv, which is a repo-
                     relative raw pull (not under DATA_DIR) — same convention
                     as understat_player_match.csv.

JSON records drop null values, so the NaN-heavy enrichment columns cost
nothing on the wire. CSVs remain the human-inspection format — this step
never modifies them.

Run AFTER the rest of the chain (ratings, personas, metrics, scouting).

Input:   the site-consumed CSVs + fixtures_enriched.csv + team_metrics.csv
Output:  site_data/*.json
"""
import json
import math
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

DATA_DIR = os.environ.get("FPL_DATA_DIR") or os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-stefcourt2004@gmail.com/My Drive/FPL/FPL_2025-26_historical")
# Site data is published from the repo, so default output next to this script
OUTPUT_DIR = os.environ.get("FPL_SITE_DATA_DIR") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "site_data")

# table name -> source CSV (table name = JSON filename and the key the site uses)
SITE_TABLES = {
    "ratings": "fpl_analyser_ratings.csv",
    "personas_4gw": "personas_4gw.csv",
    "advanced_metrics": "advanced_metrics.csv",
    "team_metrics": "team_metrics.csv",
    "season_to_date": "season_to_date_per90.csv",
    "player_tiers": "player_tier_performance.csv",
    "scouting": "scouting_percentiles.csv",
    "scouting_meta": "scouting_stat_meta.csv",
}

os.makedirs(OUTPUT_DIR, exist_ok=True)


def clean_value(v):
    """JSON-safe value: NaN -> None (dropped), numpy -> native, floats rounded."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        v = float(v)
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, 4)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, pd.Timestamp):
        return v.isoformat()
    return v


def df_to_records(df):
    """Records with null keys dropped — big saving on NaN-heavy tables."""
    records = []
    for row in df.to_dict("records"):
        rec = {}
        for k, v in row.items():
            cv = clean_value(v)
            if cv is not None and cv != "":
                rec[k] = cv
        records.append(rec)
    return records


def write_json(name, payload):
    path = os.path.join(OUTPUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = os.path.getsize(path) / 1024
    n = len(payload) if isinstance(payload, list) else 1
    print(f"  {name}.json — {n} records, {size_kb:.0f} KB")
    return n


print("Exporting site tables to JSON...")
row_counts = {}
for name, csv_file in SITE_TABLES.items():
    path = os.path.join(DATA_DIR, csv_file)
    if not os.path.exists(path):
        raise RuntimeError(f"GATE FAIL: {csv_file} not found — run the pipeline first")
    df = pd.read_csv(path)
    if df.empty:
        raise RuntimeError(f"GATE FAIL: {csv_file} is empty")
    row_counts[name] = write_json(name, df_to_records(df))

# ── Fixture ease: per team x upcoming GW ──────────────────────────────────────
# Opponent strength per game from recent windows, same blend as the next-4
# rating in fpl_analyser_rating.py: xGC per game = how attackable (for your
# attackers), xG per game = how dangerous (for your defenders/keepers).
print("Building fixture ease table...")

fixtures = pd.read_csv(os.path.join(DATA_DIR, "fixtures_enriched.csv"))
tm = pd.read_csv(os.path.join(DATA_DIR, "team_metrics.csv"))


def wblend(v4, v6, w4=0.6, w6=0.4):
    vals = [(v, w) for v, w in [(v4, w4), (v6, w6)] if not pd.isna(v)]
    if not vals:
        return np.nan
    return sum(v * w for v, w in vals) / sum(w for _, w in vals)


strength = {}
for team, sub in tm.groupby("team"):
    w4 = sub[sub["window"] == "4gw"]
    w6 = sub[sub["window"] == "6gw"]
    xgc4 = w4["team_xgc"].iloc[0] / 4 if len(w4) else np.nan
    xgc6 = w6["team_xgc"].iloc[0] / 6 if len(w6) else np.nan
    xg4 = w4["team_xg"].iloc[0] / 4 if len(w4) else np.nan
    xg6 = w6["team_xg"].iloc[0] / 6 if len(w6) else np.nan
    strength[team] = {"xgc_pg": wblend(xgc4, xgc6), "xg_pg": wblend(xg4, xg6)}

league_xgc = np.nanmean([v["xgc_pg"] for v in strength.values()])
league_xg = np.nanmean([v["xg_pg"] for v in strength.values()])

upcoming = fixtures[fixtures["finished"].astype(str) != "True"].sort_values("gw")
ease_rows = []
if not upcoming.empty:
    next_gws = sorted(upcoming["gw"].unique())[:6]
    for _, f in upcoming[upcoming["gw"].isin(next_gws)].iterrows():
        for team, opp, venue, fdr in [
            (f["home_team"], f["away_team"], "H", f["home_fdr"]),
            (f["away_team"], f["home_team"], "A", f["away_fdr"]),
        ]:
            if opp not in strength or team not in strength:
                continue
            ha = 1.05 if venue == "H" else 0.95
            ease_rows.append({
                "team": team,
                "gw": int(f["gw"]),
                "opponent": opp,
                "venue": venue,
                "fdr": int(fdr) if not pd.isna(fdr) else None,
                "kickoff": str(f["kickoff_time"]) if pd.notna(f.get("kickoff_time")) else None,
                "att_ease": round(float(strength[opp]["xgc_pg"] / league_xgc * ha), 3),
                "def_ease": round(float(league_xg / strength[opp]["xg_pg"] * ha), 3),
            })
    print(f"  fixture ease over GWs {list(next_gws)}")
else:
    print("  no upcoming fixtures — fixture_ease.json will be empty "
          "(expected between seasons; populates when the new fixture list lands)")
row_counts["fixture_ease"] = write_json(
    "fixture_ease", [{k: v for k, v in r.items() if v is not None} for r in ease_rows])

# ── Shots conceded (team shot map) ────────────────────────────────────────────
# Raw per-shot pulls live in the repo's own data/ folder (like
# understat_player_match.csv), not DATA_DIR — pull_understat_data.py always
# writes there regardless of which season's Google Drive folder is active.
SHOTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "data", "understat_shots.csv")
SHOTS_JSON_COLS = ["x", "y", "xg", "result", "situation", "shot_type",
                   "team", "player", "minute", "venue", "kickoff_date"]

if os.path.exists(SHOTS_FILE):
    print("Building shot map data...")
    shots = pd.read_csv(SHOTS_FILE)

    conceded = {
        team: df_to_records(sub[SHOTS_JSON_COLS])
        for team, sub in shots.groupby("conceded_by")
    }
    write_json("shots_conceded", conceded)
    row_counts["shots_conceded"] = sum(len(v) for v in conceded.values())
    print(f"  shots_conceded: {row_counts['shots_conceded']} shots across {len(conceded)} teams")

    # shots_for: the same rows grouped by the shooting team instead. "venue"
    # on each row is the CONCEDING team's venue (see pull_understat_data.py),
    # so it's flipped here to read as the shooting team's own venue.
    taken = shots.copy()
    taken["venue"] = taken["venue"].map({"H": "A", "A": "H"})
    shots_for = {
        team: df_to_records(sub[SHOTS_JSON_COLS])
        for team, sub in taken.groupby("team")
    }
    write_json("shots_for", shots_for)
    row_counts["shots_for"] = sum(len(v) for v in shots_for.values())
    print(f"  shots_for: {row_counts['shots_for']} shots across {len(shots_for)} teams")

    # player_shots: every shot a player took, keyed by FPL element id, for the
    # per-player shot map. Understat ids are joined to FPL element ids via the
    # persisted map (same map enrich_player_gw.py uses); shots whose shooter
    # never joined to an FPL player (fringe/loaned names) are dropped. `opp` is
    # the conceding team, for the shot's hover tooltip. Kept lean (no team /
    # venue / player name — the element already identifies the player).
    ID_MAP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "data", "player_id_map_understat.csv")
    if os.path.exists(ID_MAP_FILE):
        idmap = pd.read_csv(ID_MAP_FILE)
        idmap = idmap[idmap["source"] == "understat"]
        us_to_fpl = dict(zip(idmap["source_id"].astype(str), idmap["fpl_id"]))
        ps = shots.copy()
        ps["element"] = ps["understat_id"].astype(str).map(us_to_fpl)
        ps = ps.dropna(subset=["element"])
        ps["element"] = ps["element"].astype(int)
        ps["opp"] = ps["conceded_by"]
        PS_COLS = ["x", "y", "xg", "result", "situation", "minute",
                   "kickoff_date", "opp"]
        player_shots = {
            str(int(el)): df_to_records(sub[PS_COLS])
            for el, sub in ps.groupby("element")
        }
        write_json("player_shots", player_shots)
        row_counts["player_shots"] = sum(len(v) for v in player_shots.values())
        print(f"  player_shots: {row_counts['player_shots']} shots across "
              f"{len(player_shots)} players")
    else:
        print("  player_id_map_understat.csv not found — skipping player_shots.json")
else:
    print("  data/understat_shots.csv not found — skipping shot map JSON "
          "(run pull_understat_data.py to generate it)")

# ── Insight-engine tables (My Team report) ────────────────────────────────────
print("Building insight tables...")

ratings = pd.read_csv(os.path.join(DATA_DIR, "fpl_analyser_ratings.csv"))
std = pd.read_csv(os.path.join(DATA_DIR, "season_to_date_per90.csv"))

# benchmarks: per-position points-per-game distribution the report compares
# a user's position groups against
bench = {}
for pos, sub in ratings.groupby("position"):
    season = sub[sub["season_ok"] == True]["season_ppg"].dropna()
    gw4 = sub[sub["gw4_ok"] == True]["gw4_ppg"].dropna()
    xgi = std[std["position"] == pos]["xgi_per90_4gw"].dropna()
    bench[pos] = {
        "season_ppg_median": round(float(season.median()), 3) if len(season) else None,
        "season_ppg_p25": round(float(season.quantile(0.25)), 3) if len(season) else None,
        "season_ppg_p75": round(float(season.quantile(0.75)), 3) if len(season) else None,
        "gw4_ppg_median": round(float(gw4.median()), 3) if len(gw4) else None,
        "xgi_per90_4gw_median": round(float(xgi.median()), 3) if len(xgi) else None,
    }
write_json("benchmarks", bench)
row_counts["benchmarks"] = len(bench)

# replacement_pool: slim candidate rows; the browser filters by budget,
# position, ownership and fixtures
POOL_COLS = ["element", "web_name", "team", "position", "price", "code",
             "selected_by_percent", "season_ppg", "gw4_ppg",
             "season_overall_score", "season_overall_rating",
             "gw4_overall_score", "gw4_overall_rating",
             "next4_score", "next4_overall_rating", "next4_fixture_factor",
             "season_start_rate", "gw4_start_rate"]
pool = ratings[(ratings["season_ok"] == True) | (ratings["gw4_ok"] == True)]
pool = pool[[c for c in POOL_COLS if c in pool.columns]]
row_counts["replacement_pool"] = write_json("replacement_pool", df_to_records(pool))

# persona_shifts: players whose 4GW personas differ from their season identity
pS = pd.read_csv(os.path.join(DATA_DIR, "personas_season.csv"))
p4 = pd.read_csv(os.path.join(DATA_DIR, "personas_4gw.csv"))
def persona_set(v):
    return set() if pd.isna(v) or v == "None" else set(str(v).split(", "))
shifts = []
merged = pS[["element", "web_name", "team", "position", "personas"]].merge(
    p4[["element", "personas"]], on="element", suffixes=("_season", "_4gw"))
for _, r in merged.iterrows():
    season_set, gw4_set = persona_set(r["personas_season"]), persona_set(r["personas_4gw"])
    gained, lost = sorted(gw4_set - season_set), sorted(season_set - gw4_set)
    if gained or lost:
        shifts.append({"element": int(r["element"]), "web_name": r["web_name"],
                       "team": r["team"], "position": r["position"],
                       "gained": gained, "lost": lost})
row_counts["persona_shifts"] = write_json("persona_shifts", shifts)

# price_risk: net-transfer velocity extremes (likely price movers)
ENRICHED_FILE = os.environ.get("FPL_ENRICHED_FILE") or os.path.join(DATA_DIR, "player_gw_enriched.csv")
gw_hist = pd.read_csv(ENRICHED_FILE, usecols=["element", "web_name", "team", "position",
                                              "gw_from_fixture", "transfers_balance", "selected"])
for c in ["transfers_balance", "selected"]:
    gw_hist[c] = pd.to_numeric(gw_hist[c], errors="coerce").fillna(0)
last_gw = gw_hist["gw_from_fixture"].max()
recent = gw_hist[gw_hist["gw_from_fixture"] >= last_gw - 1]
vel_rows = []
for element, g in recent.groupby("element"):
    g = g.sort_values("gw_from_fixture")
    selected = g["selected"].iloc[-1]
    if selected < 1000:  # ignore barely-owned players
        continue
    net = g["transfers_balance"].sum()
    vel_rows.append({"element": int(element), "web_name": g["web_name"].iloc[-1],
                     "team": g["team"].iloc[-1], "position": g["position"].iloc[-1],
                     "net_transfers_2gw": int(net), "selected": int(selected),
                     "velocity": round(net / selected, 4)})
vel = pd.DataFrame(vel_rows)
risk = []
if len(vel) >= 20:
    lo, hi = vel["velocity"].quantile(0.05), vel["velocity"].quantile(0.95)
    flagged = vel[(vel["velocity"] <= lo) | (vel["velocity"] >= hi)].copy()
    flagged["risk"] = np.where(flagged["velocity"] <= lo, "drop", "rise")
    risk = df_to_records(flagged)
row_counts["price_risk"] = write_json("price_risk", risk)

# player_form: absolute last-4GW sums (final rolling snapshot per player)
r4 = pd.read_csv(os.path.join(DATA_DIR, "rolling_4gw.csv"),
                 usecols=["element", "gw_from_fixture", "goals_scored_4gw", "assists_4gw",
                          "expected_goal_involvements_4gw", "total_points_4gw",
                          "minutes_4gw", "starts_4gw"])
form = r4.sort_values("gw_from_fixture").groupby("element").last().reset_index()
form = form.drop(columns=["gw_from_fixture"])
row_counts["player_form"] = write_json("player_form", df_to_records(form))

# ── Meta manifest ─────────────────────────────────────────────────────────────
finished = fixtures[fixtures["finished"].astype(str) == "True"]
meta = {
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "current_gw": int(finished["gw"].max()) if len(finished) else None,
    "next_gw": int(upcoming["gw"].min()) if len(upcoming) else None,
    "tables": row_counts,
}
write_json("meta", meta)

# GATE: every table the site loads must be present and non-trivial
for name in SITE_TABLES:
    if row_counts.get(name, 0) < 1:
        raise RuntimeError(f"GATE FAIL: {name}.json has no records")

print("\nDone! site_data/ is ready to commit alongside the CSVs.")
