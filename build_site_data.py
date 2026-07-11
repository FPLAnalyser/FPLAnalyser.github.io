"""
BUILD SITE DATA — final pipeline step. Exports every table the website
consumes as JSON under site_data/, plus:

  meta.json          last-updated timestamp, current/next GW, row counts
                     (powers the site's data-staleness banner)
  fixture_ease.json  per team x upcoming GW (next 6): opponent, venue, FDR,
                     attack-ease and defence-ease factors from recent team
                     xGC / xG form (same blend as the next-4 rating)

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
