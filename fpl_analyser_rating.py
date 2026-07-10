import pandas as pd
import numpy as np
import os

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR = os.environ.get("FPL_DATA_DIR") or os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-stefcourt2004@gmail.com/My Drive/FPL/FPL_2025-26_historical")
# CHANGED: enriched dataset replaces player_gw_history.csv (superset of its columns)
GW_HISTORY_FILE = os.environ.get("FPL_ENRICHED_FILE") or os.path.join(DATA_DIR, "player_gw_enriched.csv")
SEASON_SUMMARY_FILE = os.path.join(DATA_DIR, "season_summary.csv")
OUTPUT_DIR = DATA_DIR

print("Loading data...")
gw = pd.read_csv(GW_HISTORY_FILE)

# Columns that must keep NaN semantics (missing source data ≠ zero)
ENRICH_MARKERS = ("us_", "pl_", "xg_delta", "xa_delta", "xgi_delta")

def force_numeric(df):
    for c in df.columns:
        if c in ["web_name", "team", "position", "was_home", "kickoff_time"]:
            continue
        if c.startswith(ENRICH_MARKERS):
            df[c] = pd.to_numeric(df[c], errors="coerce")  # keep NaN
        else:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    return df

gw = force_numeric(gw)
gw = gw.sort_values(["element", "gw_from_fixture"]).reset_index(drop=True)
print(f"  {len(gw)} GW rows loaded")

# GATE: enrichment columns must be present
REQUIRED = ["us_npxg", "us_shots", "us_xg_chain", "us_xg_buildup",
            "pl_crosses", "pl_corners_taken", "pl_fk_crosses", "xg_delta"]
missing = [c for c in REQUIRED if c not in gw.columns]
if missing:
    raise RuntimeError(f"GATE FAIL: input missing enrichment columns {missing}")

# Load photo codes from season summary
print("Loading photo codes...")
season_summary = pd.read_csv(SEASON_SUMMARY_FILE)
photo_map = season_summary[["id", "code"]].rename(columns={"id": "element"})
print(f"  {len(photo_map)} photo codes loaded")

# ── Star rating helpers ───────────────────────────────────────────────────────
def normalise_to_5(series):
    min_val = series.min()
    max_val = series.max()
    if max_val == min_val:
        return pd.Series([3.0] * len(series), index=series.index)
    return 1 + (series - min_val) / (max_val - min_val) * 4

def score_to_stars(score):
    if pd.isna(score):
        return "N/A"
    if score >= 4.75:
        return "⭐⭐⭐⭐⭐"
    elif score >= 4.25:
        return "⭐⭐⭐⭐½"
    elif score >= 3.75:
        return "⭐⭐⭐⭐"
    elif score >= 3.25:
        return "⭐⭐⭐½"
    elif score >= 2.75:
        return "⭐⭐⭐"
    elif score >= 2.25:
        return "⭐⭐½"
    elif score >= 1.75:
        return "⭐⭐"
    elif score >= 1.25:
        return "⭐½"
    else:
        return "⭐"

# ── Helper functions ──────────────────────────────────────────────────────────
def per90(group, col, mins):
    val = group[col].sum() if col in group.columns else 0
    return round(val / (mins / 90), 3) if mins > 0 else 0

# NEW: NaN-aware per90 for enrichment stats — denominator is FPL minutes on
# fixtures where the source reported data; NaN below a valid-minutes floor.
def valid_per90(group, col, min_valid_mins):
    if col not in group.columns:
        return np.nan
    mask = group[col].notna()
    vmins = group.loc[mask, "minutes"].sum()
    if vmins < min_valid_mins:
        return np.nan
    return round(group.loc[mask, col].sum() / vmins * 90, 3)

def valid_sum(group, col):
    if col not in group.columns or group[col].notna().sum() == 0:
        return np.nan
    return group[col].sum(skipna=True)

def pts_per_game(group):
    games = group[group["minutes"] > 0]
    return round(games["total_points"].mean(), 3) if len(games) > 0 else 0

def dc_hit_rate(group, position):
    threshold = 10 if position == "DEF" else 12
    if "defensive_contribution" not in group.columns:
        return 0
    return float((group["defensive_contribution"] >= threshold).mean())

def minutes_scores(group):
    total_games = len(group)
    if total_games == 0:
        return 0, 0, 0
    start_rate = group["starts"].sum() / total_games
    starts = group[group["starts"] == 1]
    mins_90_rate = len(starts[starts["minutes"] >= 90]) / len(starts) if len(starts) > 0 else 0
    early_subs = len(starts[starts["minutes"] < 60]) / len(starts) if len(starts) > 0 else 0
    rotation_risk = (1 - start_rate) * 0.6 + early_subs * 0.4
    return round(start_rate, 3), round(mins_90_rate, 3), round(rotation_risk, 3)

def calc_dimension_scores(group, position, mins):
    p = lambda col: per90(group, col, mins)
    dc = dc_hit_rate(group, position)
    scores = {}

    if position == "GKP":
        xgc = p("expected_goals_conceded")
        gc = p("goals_conceded")
        scores["save_score"] = p("saves") * 0.7 + (group["saves"].mean() / 3) * 0.3
        scores["cs_score"] = (group["clean_sheets"].mean() * 0.5 +
            (1 / (xgc + 0.1)) * 0.3 + max(0, xgc - gc) * 0.2)
        scores["bps_score"] = p("bps") * 0.6 + p("bonus") * 0.4

    elif position == "DEF":
        xgc = p("expected_goals_conceded")
        gc = p("goals_conceded")
        scores["cs_score"] = (group["clean_sheets"].mean() * 0.5 +
            (1 / (xgc + 0.1)) * 0.3 + max(0, xgc - gc) * 0.2)
        scores["dc_score"] = (dc * 0.5 + p("tackles") * 0.25 +
            p("clearances_blocks_interceptions") * 0.25)
        scores["attacking_score"] = p("expected_assists") * 0.8 + p("expected_goals") * 0.2
        scores["bps_score"] = p("bps") * 0.6 + p("bonus") * 0.4

    elif position in ["MID", "FWD"]:
        scores["goal_score"] = p("expected_goals") * 0.8 + p("goals_scored") * 0.2
        scores["creative_score"] = p("expected_assists") * 0.8 + p("assists") * 0.2
        scores["dc_score"] = (dc * 0.5 + p("tackles") * 0.25 +
            p("clearances_blocks_interceptions") * 0.25)
        scores["bps_score"] = p("bps") * 0.6 + p("bonus") * 0.4

    return scores

# ── NEW: enrichment dimension scores ─────────────────────────────────────────
# NaN-out below minimum thresholds — a player is never scored 0 on missing data.
MIN_VALID = {"season": 450, "gw4": 180}
MIN_SHOTS = {"season": 10, "gw4": 4}

def calc_enrich_scores(group, position, window_key):
    scores = {}
    mv = MIN_VALID[window_key]

    if position in ["MID", "FWD", "DEF"]:
        # Set Piece Involvement: (crosses + corners taken + FK crosses) per 90
        sp = np.nan
        mask = group["pl_crosses"].notna()
        vmins = group.loc[mask, "minutes"].sum()
        if vmins >= mv:
            total = (group.loc[mask, "pl_crosses"].sum()
                     + group.loc[mask, "pl_corners_taken"].sum()
                     + group.loc[mask, "pl_fk_crosses"].sum())
            sp = round(total / vmins * 90, 3)
        scores["set_piece_score"] = sp

    if position in ["MID", "FWD"]:
        # Shot Quality: npxG per shot (minimum shot volume required)
        shots = valid_sum(group, "us_shots")
        npxg = valid_sum(group, "us_npxg")
        if not pd.isna(shots) and shots >= MIN_SHOTS[window_key] and not pd.isna(npxg):
            scores["shot_quality_score"] = round(npxg / shots, 4)
        else:
            scores["shot_quality_score"] = np.nan

        # Creativity Depth: (xG chain + xG buildup) per 90
        chain90 = valid_per90(group, "us_xg_chain", mv)
        buildup90 = valid_per90(group, "us_xg_buildup", mv)
        scores["creativity_depth_score"] = round(chain90 + buildup90, 3) \
            if not pd.isna(chain90) and not pd.isna(buildup90) else np.nan

        # Finishing Skill: sustained xG over/underperformance (sum of xg_delta)
        played = group[group["minutes"] > 0]
        scores["finishing_skill_score"] = round(played["xg_delta"].sum(), 3) \
            if len(played) > 0 else np.nan

    return scores

# ── Overall rating weights (UNCHANGED — existing overall ratings identical) ──
WEIGHTS = {
    "GKP": {"save": 0.25, "cs": 0.35, "bps": 0.15, "reliability": 0.15, "mins90": 0.10},
    "DEF": {"cs": 0.30, "dc": 0.20, "attacking": 0.15, "bps": 0.15, "reliability": 0.15, "mins90": 0.05},
    "MID": {"goal": 0.28, "creative": 0.22, "dc": 0.10, "bps": 0.15, "reliability": 0.15, "mins90": 0.10},
    "FWD": {"goal": 0.25, "creative": 0.20, "dc": 0.10, "bps": 0.15, "reliability": 0.20, "mins90": 0.10},
    "ATT": {"goal": 0.27, "creative": 0.21, "dc": 0.10, "bps": 0.15, "reliability": 0.17, "mins90": 0.10}
}

# ── Calculate raw scores ──────────────────────────────────────────────────────
print("Calculating player scores...")
results = []

for element, group in gw.groupby("element"):
    group = group.sort_values("gw_from_fixture").reset_index(drop=True)

    web_name = group["web_name"].iloc[-1]
    team = group["team"].iloc[-1]
    position = group["position"].iloc[-1]
    value = group["value"].iloc[-1]
    price = value / 10 if value > 0 else 1

    total_mins = group["minutes"].sum()
    total_starts = group["starts"].sum()
    last4 = group.tail(4)
    last4_starts = int(last4["starts"].sum())
    last4_mins = int(last4["minutes"].sum())

    season_ok = total_mins >= 900 and total_starts >= 10
    gw4_ok = last4_starts >= 3 and last4_mins > 0

    if not season_ok and not gw4_ok:
        continue

    season_dim = calc_dimension_scores(group, position, total_mins) if season_ok else {}
    season_start, season_mins90, season_rot = minutes_scores(group) if season_ok else (0, 0, 0)
    season_ppg = pts_per_game(group) if season_ok else 0
    season_value_score = season_ppg / price if price > 0 and season_ok else 0

    gw4_dim = calc_dimension_scores(last4, position, last4_mins) if gw4_ok else {}
    gw4_start, gw4_mins90, gw4_rot = minutes_scores(last4) if gw4_ok else (0, 0, 0)
    gw4_ppg = pts_per_game(last4) if gw4_ok else 0
    gw4_value_score = gw4_ppg / price if price > 0 and gw4_ok else 0

    # NEW: enrichment dimensions
    season_enrich = calc_enrich_scores(group, position, "season") if season_ok else {}
    gw4_enrich = calc_enrich_scores(last4, position, "gw4") if gw4_ok else {}

    row = {
        "element": element,
        "web_name": web_name,
        "team": team,
        "position": position,
        "price": price,
        "total_mins": total_mins,
        "total_starts": int(total_starts),
        "season_ok": season_ok,
        "gw4_ok": gw4_ok,
        "season_ppg": season_ppg,
        "gw4_ppg": gw4_ppg,
        "season_start_rate": season_start,
        "season_mins90_rate": season_mins90,
        "season_rotation_risk": season_rot,
        "gw4_start_rate": gw4_start,
        "gw4_mins90_rate": gw4_mins90,
        "gw4_rotation_risk": gw4_rot,
        "season_value_score": season_value_score,
        "gw4_value_score": gw4_value_score,
    }

    for k, v in season_dim.items():
        row[f"season_{k}"] = v
    for k, v in gw4_dim.items():
        row[f"gw4_{k}"] = v
    for k, v in season_enrich.items():
        row[f"season_{k}"] = v
    for k, v in gw4_enrich.items():
        row[f"gw4_{k}"] = v

    results.append(row)

df = pd.DataFrame(results)
print(f"  {len(df)} players processed")

# ── Normalise dimension scores to 1-5 scale within position ───────────────────
print("Normalising dimension scores...")

dim_cols = {
    "GKP": ["save_score", "cs_score", "bps_score", "value_score"],
    "DEF": ["cs_score", "dc_score", "attacking_score", "bps_score", "value_score",
            "set_piece_score"],  # NEW
    "MID": ["goal_score", "creative_score", "dc_score", "bps_score", "value_score",
            "shot_quality_score", "creativity_depth_score",   # NEW
            "set_piece_score", "finishing_skill_score"],       # NEW
    "FWD": ["goal_score", "creative_score", "dc_score", "bps_score", "value_score",
            "shot_quality_score", "creativity_depth_score",   # NEW
            "set_piece_score", "finishing_skill_score"]        # NEW
}

att_dim_cols = ["goal_score", "creative_score", "dc_score", "bps_score", "value_score"]
att_mask = df["position"].isin(["MID", "FWD"])

for pos, cols in dim_cols.items():
    pos_mask = df["position"] == pos
    for col in cols:
        for prefix in ["season", "gw4"]:
            raw = f"{prefix}_{col}"
            norm = f"{prefix}_{col}_norm"
            ok_col = f"{prefix}_ok"
            if raw in df.columns:
                # NEW dims can be NaN (insufficient source data) — normalise
                # only over players with real values; others stay NaN → "N/A"
                valid = pos_mask & df[ok_col] & df[raw].notna()
                if valid.sum() > 1:
                    df.loc[valid, norm] = normalise_to_5(df.loc[valid, raw])

    # Normalise minutes scores
    for prefix in ["season", "gw4"]:
        ok_col = f"{prefix}_ok"
        valid = pos_mask & df[ok_col]
        if valid.sum() > 1:
            df.loc[valid, f"{prefix}_reliability_score_norm"] = normalise_to_5(df.loc[valid, f"{prefix}_start_rate"])
            df.loc[valid, f"{prefix}_mins90_score_norm"] = normalise_to_5(df.loc[valid, f"{prefix}_mins90_rate"])

# Normalise combined attacker dimensions
for col in att_dim_cols:
    for prefix in ["season", "gw4"]:
        raw = f"{prefix}_{col}"
        norm = f"{prefix}_att_{col}_norm"
        ok_col = f"{prefix}_ok"
        if raw in df.columns:
            valid = att_mask & df[ok_col] & df[raw].notna()
            if valid.sum() > 1:
                df.loc[valid, norm] = normalise_to_5(df.loc[valid, raw])

for prefix in ["season", "gw4"]:
    ok_col = f"{prefix}_ok"
    valid = att_mask & df[ok_col]
    if valid.sum() > 1:
        df.loc[valid, f"{prefix}_att_reliability_norm"] = normalise_to_5(df.loc[valid, f"{prefix}_start_rate"])
        df.loc[valid, f"{prefix}_att_mins90_norm"] = normalise_to_5(df.loc[valid, f"{prefix}_mins90_rate"])

# ── Calculate overall score from normalised dimension scores ──────────────────
# NOTE: overall weights untouched — new dimensions are additive columns only,
# so all existing overall ratings on the site remain identical.
print("Calculating overall scores...")

def calc_overall(row, position, prefix, weights):
    w = weights.get(position, {})
    mapping = {
        "goal": f"{prefix}_goal_score_norm",
        "creative": f"{prefix}_creative_score_norm",
        "dc": f"{prefix}_dc_score_norm",
        "cs": f"{prefix}_cs_score_norm",
        "save": f"{prefix}_save_score_norm",
        "attacking": f"{prefix}_attacking_score_norm",
        "bps": f"{prefix}_bps_score_norm",
        "reliability": f"{prefix}_reliability_score_norm",
        "mins90": f"{prefix}_mins90_score_norm"
    }
    score = 0
    total_weight = 0
    for dim, weight in w.items():
        col = mapping.get(dim)
        if col and col in row.index and pd.notna(row[col]):
            score += float(row[col]) * weight
            total_weight += weight
    return round(score / total_weight, 3) if total_weight > 0 else np.nan

def calc_att_overall(row, prefix, weights):
    w = weights.get("ATT", {})
    mapping = {
        "goal": f"{prefix}_att_goal_score_norm",
        "creative": f"{prefix}_att_creative_score_norm",
        "dc": f"{prefix}_att_dc_score_norm",
        "bps": f"{prefix}_att_bps_score_norm",
        "reliability": f"{prefix}_att_reliability_norm",
        "mins90": f"{prefix}_att_mins90_norm"
    }
    score = 0
    total_weight = 0
    for dim, weight in w.items():
        col = mapping.get(dim)
        if col and col in row.index and pd.notna(row[col]):
            score += float(row[col]) * weight
            total_weight += weight
    return round(score / total_weight, 3) if total_weight > 0 else np.nan

for prefix in ["season", "gw4"]:
    ok_col = f"{prefix}_ok"
    overall_scores = []
    att_overall_scores = []

    for _, row in df.iterrows():
        if row[ok_col]:
            overall_scores.append(calc_overall(row, row["position"], prefix, WEIGHTS))
        else:
            overall_scores.append(np.nan)

        if row["position"] in ["MID", "FWD"] and row[ok_col]:
            att_overall_scores.append(calc_att_overall(row, prefix, WEIGHTS))
        else:
            att_overall_scores.append(np.nan)

    df[f"{prefix}_overall_score"] = overall_scores
    df[f"{prefix}_att_overall_score"] = att_overall_scores

# ── Apply star ratings to all normalised scores ───────────────────────────────
print("Applying star ratings...")

norm_cols = [c for c in df.columns if c.endswith("_norm")]
for col in norm_cols:
    rating_col = col.replace("_norm", "_rating")
    df[rating_col] = df[col].apply(score_to_stars)

# Apply to overall scores
for prefix in ["season", "gw4"]:
    df[f"{prefix}_overall_rating"] = df[f"{prefix}_overall_score"].apply(score_to_stars)
    df[f"{prefix}_att_overall_rating"] = df[f"{prefix}_att_overall_score"].apply(score_to_stars)

# ── Save ──────────────────────────────────────────────────────────────────────
# Merge photo codes and ownership
ownership_map = season_summary[["id", "code", "selected_by_percent"]].rename(columns={"id": "element"})
df = df.merge(ownership_map, on="element", how="left")

# GATE: additive-only — every column the website relied on must still exist
LEGACY_SAMPLE = ["season_overall_rating", "gw4_overall_rating", "season_att_overall_rating",
                 "season_goal_score_rating", "season_cs_score_rating", "code",
                 "selected_by_percent", "season_ppg", "price"]
missing_out = [c for c in LEGACY_SAMPLE if c not in df.columns]
if missing_out:
    raise RuntimeError(f"GATE FAIL: output lost legacy columns {missing_out}")

output_path = os.path.join(OUTPUT_DIR, "fpl_analyser_ratings.csv")
df.to_csv(output_path, index=False)
print(f"  fpl_analyser_ratings.csv written ({len(df)} rows, {len(df.columns)} columns)")

# ── Validation snapshot ───────────────────────────────────────────────────────
print("\n── VALIDATION SNAPSHOT ──────────────────────────────────────")

print("\nNEW DIMENSIONS — Top 10 Shot Quality (season, MID/FWD):")
sq = df[df["position"].isin(["MID", "FWD"]) & df["season_shot_quality_score"].notna()] \
    .sort_values("season_shot_quality_score", ascending=False).head(10)
for _, r in sq.iterrows():
    print(f"  {r['web_name']:<20} npxG/shot: {r['season_shot_quality_score']:.3f} {r['season_shot_quality_score_rating']}")

print("\nNEW DIMENSIONS — Top 10 Creativity Depth (season, MID/FWD):")
cd = df[df["position"].isin(["MID", "FWD"]) & df["season_creativity_depth_score"].notna()] \
    .sort_values("season_creativity_depth_score", ascending=False).head(10)
for _, r in cd.iterrows():
    print(f"  {r['web_name']:<20} chain+buildup/90: {r['season_creativity_depth_score']:.2f} {r['season_creativity_depth_score_rating']}")

print("\nNEW DIMENSIONS — Top 10 Set Piece Involvement (season):")
sp = df[df["season_set_piece_score"].notna()].sort_values(
    "season_set_piece_score", ascending=False).head(10)
for _, r in sp.iterrows():
    print(f"  {r['web_name']:<20} {r['position']:<4} deliveries/90: {r['season_set_piece_score']:.2f} {r['season_set_piece_score_rating']}")

print("\nNEW DIMENSIONS — Finishing Skill extremes (season, MID/FWD):")
fs = df[df["position"].isin(["MID", "FWD"]) & df["season_finishing_skill_score"].notna()]
for label, sub in [("Overperformers", fs.nlargest(5, "season_finishing_skill_score")),
                   ("Underperformers", fs.nsmallest(5, "season_finishing_skill_score"))]:
    print(f"  {label}:")
    for _, r in sub.iterrows():
        print(f"    {r['web_name']:<20} Σxg_delta: {r['season_finishing_skill_score']:+.2f} {r['season_finishing_skill_score_rating']}")

print("\nKey player checks:")
for name in ["Haaland", "Thiago", "Saka", "B.Fernandes", "M.Salah", "Foden"]:
    p = df[df["web_name"] == name]
    if len(p) > 0:
        r = p.iloc[0]
        print(f"  {name:<20} Season:{r['season_overall_rating']} | ATT:{r['season_att_overall_rating']} | Score:{r.get('season_overall_score', 0):.2f} | PPG:{r.get('season_ppg', 0):.2f}")
    else:
        print(f"  {name:<20} Not found")

print("\nDone!")
