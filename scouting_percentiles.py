"""
SCOUTING PERCENTILES — FBref-style percentile ranks for the website scouting
report. Per-90 stats ranked within position peer groups (MID+FWD pooled as
attackers, DEF, GKP), season-to-date, minimum-minutes eligibility.

Input:   player_gw_enriched.csv, season_summary.csv (photo codes)
Output:  scouting_percentiles.csv
"""
import pandas as pd
import numpy as np
import os

DATA_DIR = os.environ.get("FPL_DATA_DIR") or os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-stefcourt2004@gmail.com/My Drive/FPL/FPL_2025-26_historical")
ENRICHED_FILE = os.environ.get("FPL_ENRICHED_FILE") or os.path.expanduser(
    "~/Desktop/fpl-analyser/player_gw_enriched.csv")
SEASON_SUMMARY_FILE = os.path.join(DATA_DIR, "season_summary.csv")
OUTPUT_DIR = DATA_DIR

# Windows: full season plus rolling last-4 / last-6 gameweek views, each with
# its own eligibility floor so short windows still have a usable peer group.
# (min FPL minutes for eligibility, min valid source minutes for us_/pl_ stats)
WINDOWS = {
    "season": (None, 600, 450),
    "l6": (6, 270, 270),
    "l4": (4, 180, 180),
}

print("Loading data...")
gw = pd.read_csv(ENRICHED_FILE)
season_summary = pd.read_csv(SEASON_SUMMARY_FILE)
for c in gw.columns:
    if c.startswith(("us_", "pl_")) or c.endswith("_delta"):
        gw[c] = pd.to_numeric(gw[c], errors="coerce")  # NaN preserved

# Stat definitions: (output_key, label, source_column, source_prefix_or_None)
# source prefix drives which valid-minutes denominator applies (None = FPL mins)
ATTACKER_STATS = [
    # Attacking
    ("goals", "Goals", "goals_scored", None),
    ("npxg", "Non-Penalty xG", "us_npxg", "us"),
    ("xg_delta", "xG Delta (Goals − xG)", "__xg_delta", None),
    ("xgi", "xGI (xG + xA)", "__xgi", None),
    ("xgi_delta", "xGI Delta (G+A − xGI)", "__xgi_delta", None),
    ("shots", "Shots Total", "us_shots", "us"),
    ("sot", "Shots on Target", "us_sot", "us"),
    ("box_shots", "Shots in the Box", "__box_shots", "us"),
    ("headed_shots", "Headed Shots", "us_shots_head", "us"),
    ("fk_shots", "Free Kick Shots", "pl_fk_shots", "pl"),
    ("touches_box", "Touches in Opponents Box", "pl_touches_opp_box", "pl"),
    # Creation
    ("assists", "Assists", "assists", None),
    ("xa", "xA", "expected_assists", None),
    ("xa_delta", "xA Delta (Assists − xA)", "__xa_delta", None),
    ("chances_created", "Chances Created", "pl_chances_created", "pl"),
    ("big_chances", "Big Chances Created", "pl_big_chances_created", "pl"),
    ("xg_chain", "xG Chain", "us_xg_chain", "us"),
    ("xg_buildup", "xG Buildup", "us_xg_buildup", "us"),
    ("crosses", "Crosses (Open Play)", "pl_crosses", "pl"),
    ("sp_deliveries", "Set Piece Deliveries", "__sp_deliveries", "pl"),
    # Defending
    ("tackles", "Tackles", "tackles", None),
    ("cbi", "Clearances/Blocks/Int", "clearances_blocks_interceptions", None),
    ("recoveries", "Recoveries", "recoveries", None),
    ("def_contrib", "Defensive Contribution", "defensive_contribution", None),
]
DEF_STATS = ATTACKER_STATS  # same panel; percentiles ranked vs DEF peer group
GKP_STATS = [
    ("saves", "Saves", "saves", None),
    ("cs", "Clean Sheets", "clean_sheets", None),
    ("xgc_prevented", "Goals Prevented (xGC-GC)", "__xgc_prevented", None),
    ("bps", "BPS", "bps", None),
]

GROUPS = [("Attacking", ["goals", "npxg", "xg_delta", "xgi", "xgi_delta", "shots",
                         "sot", "box_shots", "headed_shots", "fk_shots", "touches_box",
                         "avg_shot_distance"]),
          ("Creation", ["assists", "xa", "xa_delta", "chances_created", "big_chances",
                        "xg_chain", "xg_buildup", "crosses", "sp_deliveries"]),
          ("Defending", ["tackles", "cbi", "recoveries", "def_contrib"])]

def derive(group, col):
    if col == "__box_shots":
        return group["us_shots_six_yard"] + group["us_shots_penalty_area"]
    if col == "__sp_deliveries":
        return group["pl_corners_taken"] + group["pl_fk_crosses"] + group["pl_fk_shots"]
    if col == "__xgc_prevented":
        return group["expected_goals_conceded"] - group["goals_conceded"]
    if col == "__xg_delta":
        return group["goals_scored"] - group["expected_goals"]
    if col == "__xa_delta":
        return group["assists"] - group["expected_assists"]
    if col == "__xgi":
        return group["expected_goals"] + group["expected_assists"]
    if col == "__xgi_delta":
        return (group["goals_scored"] + group["assists"]) - \
               (group["expected_goals"] + group["expected_assists"])
    return group[col]

print("Computing per-90s...")
max_gw = gw["gw_from_fixture"].max()
frames = []
for window, (n_gws, min_fpl_mins, min_valid_mins) in WINDOWS.items():
    wgw = gw if n_gws is None else gw[gw["gw_from_fixture"] > max_gw - n_gws]
    rows = []
    for element, group in wgw.groupby("element"):
        group = group.sort_values("gw_from_fixture")
        mins = group["minutes"].sum()
        if mins < min_fpl_mins:
            continue
        position = group["position"].iloc[-1]
        stats = GKP_STATS if position == "GKP" else ATTACKER_STATS

        row = {
            "element": element,
            "web_name": group["web_name"].iloc[-1],
            "team": group["team"].iloc[-1],
            "position": position,
            "minutes": int(mins),
            "window": window,
        }
        for key, label, col, src in stats:
            vals = derive(group, col)
            if src is None:
                row[f"{key}_per90"] = round(vals.sum() / mins * 90, 2)
            else:
                probe = "us_npxg" if src == "us" else "pl_touches_opp_box"
                mask = group[probe].notna()
                vmins = group.loc[mask, "minutes"].sum()
                if vmins >= min_valid_mins:
                    row[f"{key}_per90"] = round(vals[mask].sum() / vmins * 90, 2)
                else:
                    row[f"{key}_per90"] = np.nan  # insufficient source data — never 0
        rows.append(row)
    wdf = pd.DataFrame(rows)
    print(f"  window {window}: {len(wdf)} eligible players (≥{min_fpl_mins} mins)")
    frames.append(wdf)

df = pd.concat(frames, ignore_index=True)

print("Ranking percentiles within peer groups...")
# Peer groups, ranked within each window: attackers pooled (MID+FWD, `_pct`)
# plus a position-only ranking (`_pct_pos`, MID vs MID / FWD vs FWD) so the
# site can toggle between the two. DEF and GKP are the same in both.
# Percentile = rank among peers with valid data, 1-99.
df["peer_group"] = np.where(df["position"].isin(["MID", "FWD"]), "ATT", df["position"])
all_keys = {k for k, *_ in ATTACKER_STATS} | {k for k, *_ in GKP_STATS}
for key in all_keys:
    col = f"{key}_per90"
    if col not in df.columns:
        continue
    for grouping, out_suffix in [("peer_group", "_pct"), ("position", "_pct_pos")]:
        for (win, pg), sub in df.groupby(["window", grouping]):
            valid = sub[col].notna()
            if valid.sum() < 10:
                continue
            pct = sub.loc[valid, col].rank(pct=True).mul(98).add(1).round()
            df.loc[pct.index, f"{key}{out_suffix}"] = pct

# Average non-penalty shot distance (yards) — how close a player gets before
# shooting. Season-only: it's a mean over individual shots, not a per-90 rate,
# so it can't reuse the windowed sum/minutes loop above. Stored under the
# same `_per90`/`_pct` column-naming convention the scouting page already
# reads generically, even though it isn't really a per-90 figure. Lower is
# better (closer to goal), so the percentile rank is inverted.
print("Computing average non-penalty shot distance...")
REPO_DIR = os.path.dirname(os.path.abspath(__file__))
SHOTS_FILE = os.path.join(REPO_DIR, "data", "understat_shots.csv")
ID_MAP_FILE = os.path.join(REPO_DIR, "data", "player_id_map_understat.csv")
if os.path.exists(SHOTS_FILE) and os.path.exists(ID_MAP_FILE):
    shots = pd.read_csv(SHOTS_FILE)
    shots = shots[shots["situation"] != "Penalty"].copy()
    depth_m = (1 - shots["x"]) * 105
    width_offset_m = (shots["y"] - 0.5) * 68
    shots["dist_yd"] = np.sqrt(depth_m ** 2 + width_offset_m ** 2) * 1.09361
    by_player = shots.groupby("understat_id")["dist_yd"].mean().round(1)

    id_map = pd.read_csv(ID_MAP_FILE)
    id_map = id_map[id_map["source"] == "understat"].set_index("source_id")["fpl_id"]
    by_element = by_player.rename(index=id_map.to_dict())

    season_mask = df["window"] == "season"
    df.loc[season_mask, "avg_shot_distance_per90"] = df.loc[season_mask, "element"].map(by_element)

    sub = df[season_mask & (df["peer_group"] == "ATT") & df["avg_shot_distance_per90"].notna()]
    if len(sub) >= 10:
        pct = (1 - sub["avg_shot_distance_per90"].rank(pct=True)).mul(98).add(1).round()
        df.loc[pct.index, "avg_shot_distance_pct"] = pct
    print(f"  {sub.shape[0]} attackers with a shot-distance percentile")
else:
    print("  data/understat_shots.csv or player_id_map_understat.csv not found — skipping")

# Integer percentiles (nullable Int64 → clean ints in the CSV, blanks for NaN)
for c in [c for c in df.columns if c.endswith("_pct") or c.endswith("_pct_pos")]:
    df[c] = df[c].astype("Int64")

# GATES
if df.empty:
    raise RuntimeError("GATE FAIL: no eligible players")
att = df[(df["peer_group"] == "ATT") & (df["window"] == "season")]
for key in ["npxg", "chances_created", "goals"]:
    if att[f"{key}_pct"].notna().sum() < 50:
        raise RuntimeError(f"GATE FAIL: {key}_pct scored for <50 attackers — source join broken?")

# Photo codes for the site
photo = season_summary[["id", "code"]].rename(columns={"id": "element"})
df = df.merge(photo, on="element", how="left")

# Stat labels + grouping metadata for the front end (single source of truth)
labels = {k: lbl for k, lbl, *_ in ATTACKER_STATS + GKP_STATS}
labels["avg_shot_distance"] = "Avg. Shot Distance (yd)"
meta = []
for gname, keys in GROUPS:
    for k in keys:
        meta.append({"key": k, "label": labels[k], "group": gname})
for k, lbl, *_ in GKP_STATS:
    meta.append({"key": k, "label": lbl, "group": "Goalkeeping"})
pd.DataFrame(meta).to_csv(os.path.join(OUTPUT_DIR, "scouting_stat_meta.csv"), index=False)

out = os.path.join(OUTPUT_DIR, "scouting_percentiles.csv")
df.to_csv(out, index=False)
print(f"  scouting_percentiles.csv written ({len(df)} rows, {len(df.columns)} columns)")
print(f"  scouting_stat_meta.csv written ({len(meta)} stat definitions)")

print("\n── VALIDATION: sample scouting lines ───────────────────────")
for name in ["Haaland", "M.Salah", "Ward-Prowse", "Rice"]:
    p = df[(df["web_name"] == name) & (df["window"] == "season")]
    if p.empty:
        print(f"  {name}: not eligible"); continue
    r = p.iloc[0]
    print(f"\n  {name} ({r['position']}, {r['minutes']} mins) vs {'attackers' if r['peer_group']=='ATT' else r['peer_group']}:")
    for key in ["npxg", "shots", "xa", "chances_created", "xg_buildup", "tackles"]:
        v, pc = r.get(f"{key}_per90"), r.get(f"{key}_pct")
        if pd.notna(v):
            print(f"    {labels[key]:<24} {v:>6.2f}  pct {int(pc) if pd.notna(pc) else '—'}")
print("\nDone!")