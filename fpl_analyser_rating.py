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

# ── Percentile rating: dimensions are blends of scouting-report sub-metrics ───
# Every dimension score is a weighted average of position-relative PERCENTILES
# of its underlying stats (mirrors the team Attack/Defence ratings), then mapped
# back to the 1–5 scale the rest of the app consumes. Robust to outliers and
# uses (nearly) the whole scouting-report stat set. NaN-out below minimum
# thresholds — a player is never scored 0 on missing data.
MIN_VALID = {"season": 450, "gw4": 180}
MIN_SHOTS = {"season": 10, "gw4": 4}

def combined_per90(group, cols, min_valid):
    """NaN-aware per-90 of the row-wise sum of several source columns."""
    present = [c for c in cols if c in group.columns]
    if not present:
        return np.nan
    sub = group[present]
    mask = sub.notna().any(axis=1)
    vmins = group.loc[mask, "minutes"].sum()
    if vmins < min_valid:
        return np.nan
    return round(sub.loc[mask].fillna(0).sum(axis=1).sum() / vmins * 90, 3)

def calc_metrics(group, position, mins, wk):
    """Raw per-90 (and ratio/sum) sub-metrics for a player-window. Percentiled
    and blended into dimensions downstream."""
    p = lambda c: per90(group, c, mins)          # plain per-90 (FPL cols, 0-filled)
    vp = lambda c: valid_per90(group, c, MIN_VALID[wk])  # NaN-aware (us_/pl_ cols)
    mv = MIN_VALID[wk]
    m = {}
    shots = valid_sum(group, "us_shots")
    enough = (not pd.isna(shots)) and shots >= MIN_SHOTS[wk]
    ratio = lambda numer: round(numer / shots, 4) if enough and not pd.isna(numer) else np.nan

    if position in ("MID", "FWD", "DEF"):
        m["xg"] = p("expected_goals")
        m["xa"] = p("expected_assists")
        m["goals"] = p("goals_scored")
        m["assists"] = p("assists")
        m["npxg"] = vp("us_npxg")
        m["sot"] = vp("us_sot")
        m["headed"] = vp("us_shots_head")
        m["touches_box"] = vp("pl_touches_opp_box")
        m["box_shots"] = combined_per90(group, ["us_shots_six_yard", "us_shots_penalty_area"], mv)
        m["chances"] = vp("pl_chances_created")
        m["big_chances"] = vp("pl_big_chances_created")
        m["creativity_depth"] = combined_per90(group, ["us_xg_chain", "us_xg_buildup"], mv)
        m["set_piece"] = combined_per90(group, ["pl_crosses", "pl_corners_taken", "pl_fk_crosses"], mv)
        box = valid_sum(group, "us_shots_six_yard")
        pen = valid_sum(group, "us_shots_penalty_area")
        m["shot_quality"] = ratio(valid_sum(group, "us_npxg"))
        boxpen = (0 if pd.isna(box) else box) + (0 if pd.isna(pen) else pen)
        m["box_share"] = ratio(boxpen) if not (pd.isna(box) and pd.isna(pen)) else np.nan
        m["sot_rate"] = ratio(valid_sum(group, "us_sot"))
        played = group[group["minutes"] > 0]
        m["finishing"] = round(played["xg_delta"].sum(), 3) if len(played) else np.nan
        m["xa_over"] = round(played["xa_delta"].sum(), 3) \
            if len(played) and played["xa_delta"].notna().any() else np.nan
        m["tackles"] = p("tackles")
        m["cbi"] = p("clearances_blocks_interceptions")
        m["recoveries"] = p("recoveries")
        m["dc_hit"] = dc_hit_rate(group, position)
        m["bps"] = p("bps")
        m["bonus"] = p("bonus")

    if position in ("GKP", "DEF"):
        m["cs_rate"] = round(group["clean_sheets"].mean(), 4)
        m["xgc"] = p("expected_goals_conceded")
        m["prevented"] = round(p("expected_goals_conceded") - p("goals_conceded"), 3)

    if position == "GKP":
        m["saves"] = p("saves")
        m["bps"] = p("bps")
        m["bonus"] = p("bonus")
        # Shot-load faced by the keeper's defence (team-level, attributed by club).
        sl = TEAM_SHOTLOAD.get(group["team"].iloc[-1], {})
        m["shots_faced"] = sl.get("shots_pg", np.nan)
        m["box_faced"] = sl.get("box_share", np.nan)
        m["dist_faced"] = sl.get("dist_avg", np.nan)
    return m

# Dimension = weighted blend of sub-metric percentiles. Weights sum to 1.
GOAL_BLEND = {"xg": 0.22, "npxg": 0.13, "goals": 0.15, "shot_quality": 0.12,
              "finishing": 0.13, "box_share": 0.10, "sot_rate": 0.05, "touches_box": 0.10}
CREATIVE_BLEND = {"xa": 0.25, "assists": 0.12, "chances": 0.15, "big_chances": 0.13,
                  "creativity_depth": 0.15, "xa_over": 0.10, "set_piece": 0.10}
# Recoveries count toward the defensive-contribution threshold only for MID/FWD,
# NOT defenders (a defender's DC is CBIT: clearances, blocks, interceptions,
# tackles). So recoveries feed the DC blend for attackers only.
DC_BLEND_DEF = {"dc_hit": 0.40, "tackles": 0.30, "cbi": 0.30}
DC_BLEND_ATT = {"dc_hit": 0.40, "tackles": 0.20, "cbi": 0.20, "recoveries": 0.20}
ATTACKING_BLEND = {"xa": 0.30, "xg": 0.20, "box_shots": 0.15, "headed": 0.10,
                   "touches_box": 0.15, "chances": 0.10}
CS_BLEND = {"cs_rate": 0.45, "xgc": 0.35, "prevented": 0.20}
SAVE_BLEND = {"saves": 0.30, "prevented": 0.35, "shots_faced": 0.15,
              "box_faced": 0.10, "dist_faced": 0.10}
BPS_BLEND = {"bps": 0.6, "bonus": 0.4}

DIM_BLENDS = {
    "GKP": {"save": SAVE_BLEND, "cs": CS_BLEND, "bps": BPS_BLEND},
    "DEF": {"cs": CS_BLEND, "dc": DC_BLEND_DEF, "attacking": ATTACKING_BLEND, "bps": BPS_BLEND},
    "MID": {"goal": GOAL_BLEND, "creative": CREATIVE_BLEND, "dc": DC_BLEND_ATT, "bps": BPS_BLEND},
    "FWD": {"goal": GOAL_BLEND, "creative": CREATIVE_BLEND, "dc": DC_BLEND_ATT, "bps": BPS_BLEND},
}
# Combined MID+FWD attacker pool → the *_att_* overall (cross-position ranking).
ATT_BLENDS = {"goal": GOAL_BLEND, "creative": CREATIVE_BLEND, "dc": DC_BLEND_ATT, "bps": BPS_BLEND}
# Metrics where a LOWER raw value is better (percentile inverted).
INVERT = {"xgc", "dist_faced"}
# Orphan dimensions surfaced on the card AND folded into a parent above.
ORPHAN_DIMS = {"shot_quality": "shot_quality", "finishing_skill": "finishing",
               "creativity_depth": "creativity_depth", "set_piece": "set_piece"}

# ── Overall rating weights (UNCHANGED — existing overall ratings identical) ──
WEIGHTS = {
    "GKP": {"save": 0.25, "cs": 0.35, "bps": 0.15, "reliability": 0.15, "mins90": 0.10},
    "DEF": {"cs": 0.30, "dc": 0.20, "attacking": 0.15, "bps": 0.15, "reliability": 0.15, "mins90": 0.05},
    "MID": {"goal": 0.28, "creative": 0.22, "dc": 0.10, "bps": 0.15, "reliability": 0.15, "mins90": 0.10},
    "FWD": {"goal": 0.25, "creative": 0.20, "dc": 0.10, "bps": 0.15, "reliability": 0.20, "mins90": 0.10},
    "ATT": {"goal": 0.27, "creative": 0.21, "dc": 0.10, "bps": 0.15, "reliability": 0.17, "mins90": 0.10}
}

# ── Goalkeeper shot-load faced (team-level, attributed to a club's keepers) ───
# From data/understat_shots.csv: for each defending team, how many shots they
# face per game, what share are in the box, and the average shot distance faced.
# distanceYards mirrors src/lib/shotzones.ts / scouting_percentiles.py.
SHOTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "data", "understat_shots.csv")
TEAM_SHOTLOAD = {}
if os.path.exists(SHOTS_FILE):
    print("Computing goalkeeper shot-load faced...")
    _sh = pd.read_csv(SHOTS_FILE)
    _depth = (1 - _sh["x"]) * 105
    _width = (_sh["y"] - 0.5) * 68
    _sh["dist_yd"] = np.sqrt(_depth ** 2 + _width ** 2) * 1.09361
    _sh["is_box"] = _sh["zone"].isin(["six_yard", "penalty_area"])
    for team, sub in _sh.groupby("conceded_by"):
        games = sub["understat_match_id"].nunique()
        if games == 0:
            continue
        TEAM_SHOTLOAD[team] = {
            "shots_pg": round(len(sub) / games, 3),
            "box_share": round(float(sub["is_box"].mean()), 4),
            "dist_avg": round(float(sub["dist_yd"].mean()), 3),
        }
    print(f"  shot-load for {len(TEAM_SHOTLOAD)} teams")
else:
    print("  data/understat_shots.csv not found — GKP shot-load unavailable")

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

    season_m = calc_metrics(group, position, total_mins, "season") if season_ok else {}
    season_start, season_mins90, season_rot = minutes_scores(group) if season_ok else (0, 0, 0)
    season_ppg = pts_per_game(group) if season_ok else 0
    season_value_score = season_ppg / price if price > 0 and season_ok else 0

    gw4_m = calc_metrics(last4, position, last4_mins, "gw4") if gw4_ok else {}
    gw4_start, gw4_mins90, gw4_rot = minutes_scores(last4) if gw4_ok else (0, 0, 0)
    gw4_ppg = pts_per_game(last4) if gw4_ok else 0
    gw4_value_score = gw4_ppg / price if price > 0 and gw4_ok else 0

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

    # Store raw sub-metrics as {prefix}_m_{name}; percentiled + blended below.
    for k, v in season_m.items():
        row[f"season_m_{k}"] = v
    for k, v in gw4_m.items():
        row[f"gw4_m_{k}"] = v
    # Orphan display scores (also folded into a parent dimension downstream).
    for orphan, metric in ORPHAN_DIMS.items():
        row[f"season_{orphan}_score"] = season_m.get(metric, np.nan)
        row[f"gw4_{orphan}_score"] = gw4_m.get(metric, np.nan)
    # value / start / mins90 live in the metric namespace too so they percentile
    # through the same path (value stays out of the overall weights, though).
    row["season_m_value"] = season_value_score if season_ok else np.nan
    row["gw4_m_value"] = gw4_value_score if gw4_ok else np.nan
    row["season_m_start_rate"] = season_start if season_ok else np.nan
    row["gw4_m_start_rate"] = gw4_start if gw4_ok else np.nan
    row["season_m_mins90_rate"] = season_mins90 if season_ok else np.nan
    row["gw4_m_mins90_rate"] = gw4_mins90 if gw4_ok else np.nan

    results.append(row)

df = pd.DataFrame(results)
print(f"  {len(df)} players processed")

# ── Percentile-rank every sub-metric, then blend into 1-5 dimension scores ────
print("Percentile-ranking sub-metrics and blending dimensions...")

# Discover every stored metric name (columns like season_m_<name> / gw4_m_<name>)
metric_names = set()
for c in df.columns:
    for prefix in ("season", "gw4"):
        pre = f"{prefix}_m_"
        if c.startswith(pre):
            metric_names.add(c[len(pre):])

def add_percentiles(mask, pool):
    """Write {prefix}_{pool}_{metric} percentile (0-100) over `mask` per window."""
    for prefix in ("season", "gw4"):
        ok = df[f"{prefix}_ok"].fillna(False)
        for name in metric_names:
            col = f"{prefix}_m_{name}"
            if col not in df.columns:
                continue
            valid = mask & ok & df[col].notna()
            if valid.sum() > 1:
                asc = name not in INVERT
                df.loc[valid, f"{prefix}_{pool}_{name}"] = (
                    df.loc[valid, col].rank(pct=True, ascending=asc) * 100)

# Position-relative percentiles + a combined MID+FWD "ATT" pool.
for pos in ("GKP", "DEF", "MID", "FWD"):
    add_percentiles(df["position"] == pos, "pct")
add_percentiles(df["position"].isin(["MID", "FWD"]), "attpct")

def blend_to_5(row, prefix, blend, pool):
    """Weighted mean of sub-metric percentiles → 1-5 (missing metrics drop out,
    remaining weights rescale — same pattern as calc_overall)."""
    s = w = 0.0
    for name, wt in blend.items():
        col = f"{prefix}_{pool}_{name}"
        if col in row.index and pd.notna(row[col]):
            s += float(row[col]) * wt
            w += wt
    return round(1 + (s / w) / 100 * 4, 3) if w > 0 else np.nan

pct_to_5 = lambda v: round(1 + float(v) / 100 * 4, 3) if pd.notna(v) else np.nan

for prefix in ("season", "gw4"):
    ok = df[f"{prefix}_ok"].fillna(False)
    # Position-cohort dimensions
    for pos, dims in DIM_BLENDS.items():
        pm = (df["position"] == pos) & ok
        if not pm.any():
            continue
        for dim, blend in dims.items():
            norm = df.loc[pm].apply(lambda r: blend_to_5(r, prefix, blend, "pct"), axis=1)
            df.loc[pm, f"{prefix}_{dim}_score_norm"] = norm
            # Raw 0-100 composite kept for sort/ranking consumers (Rankings.tsx)
            df.loc[pm, f"{prefix}_{dim}_score"] = ((norm - 1) / 4 * 100).round(1)
    # Orphan display dims (percentile of their own metric)
    for orphan, metric in ORPHAN_DIMS.items():
        col = f"{prefix}_pct_{metric}"
        if col in df.columns:
            df.loc[ok, f"{prefix}_{orphan}_score_norm"] = df.loc[ok, col].apply(pct_to_5)
    # Value (surfaced, NOT in overall weights) + reliability + mins90
    for dim, metric in (("value_score", "value"), ("reliability_score", "start_rate"),
                        ("mins90_score", "mins90_rate")):
        col = f"{prefix}_pct_{metric}"
        if col in df.columns:
            df.loc[ok, f"{prefix}_{dim}_norm"] = df.loc[ok, col].apply(pct_to_5)
    # Combined attacker pool → *_att_* dimensions used by the ATT overall
    am = df["position"].isin(["MID", "FWD"]) & ok
    for dim, blend in ATT_BLENDS.items():
        df.loc[am, f"{prefix}_att_{dim}_score_norm"] = df.loc[am].apply(
            lambda r: blend_to_5(r, prefix, blend, "attpct"), axis=1)
    for metric, out in (("start_rate", "reliability"), ("mins90_rate", "mins90"),
                        ("value", "value_score")):
        col = f"{prefix}_attpct_{metric}"
        if col in df.columns:
            df.loc[am, f"{prefix}_att_{out}_norm"] = df.loc[am, col].apply(pct_to_5)

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

# ── NEW: Next-4-GW fixture-adjusted rating ───────────────────────────────────
# Blends the player's own quality/form (season + last-4 overall scores) with
# how attackable their next four gameweeks of opponents are. Opponent strength
# comes from team_metrics.csv recent windows: xGC per game (how easy to attack)
# and xG per game (how dangerous to defend against).
print("Calculating next-4-GW fixture-adjusted ratings...")

FIXTURES_FILE = os.path.join(DATA_DIR, "fixtures_enriched.csv")
TEAM_METRICS_FILE = os.path.join(DATA_DIR, "team_metrics.csv")

def build_next4():
    if not (os.path.exists(FIXTURES_FILE) and os.path.exists(TEAM_METRICS_FILE)):
        print("  SKIPPED: fixtures_enriched.csv / team_metrics.csv not found")
        return
    fixtures = pd.read_csv(FIXTURES_FILE)
    tm = pd.read_csv(TEAM_METRICS_FILE)

    # Opponent strength per game: blend last-4 and last-6 windows (recent form
    # matters more than season aggregates for a forward-looking view)
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
    if upcoming.empty:
        print("  SKIPPED: no upcoming fixtures")
        return
    next4_gws = sorted(upcoming["gw"].unique())[:4]
    window = upcoming[upcoming["gw"].isin(next4_gws)]

    # Per-team fixture factors over the next 4 gameweeks. >1 = easier than the
    # average run, <1 = harder. Home fixtures get a 5% boost, away a 5% cut.
    # A blank GW just means fewer fixtures; a double GW counts both.
    team_factors = {}
    for team in strength:
        att_f, def_f, n = [], [], 0
        for _, f in window.iterrows():
            if f["home_team"] == team or f["away_team"] == team:
                home = f["home_team"] == team
                opp = f["away_team"] if home else f["home_team"]
                if opp not in strength:
                    continue
                ha = 1.05 if home else 0.95
                att_f.append((strength[opp]["xgc_pg"] / league_xgc) * ha)
                def_f.append((league_xg / strength[opp]["xg_pg"]) * ha)
                n += 1
        if n:
            team_factors[team] = {
                "att": float(np.mean(att_f)), "def": float(np.mean(def_f)), "n": n}

    def player_factor(row):
        tf = team_factors.get(row["team"])
        if not tf:
            return np.nan, 0
        pos = row["position"]
        if pos in ["MID", "FWD"]:
            f = tf["att"]
        elif pos == "DEF":
            f = tf["def"] * 0.7 + tf["att"] * 0.3  # CS potential + attacking returns
        else:
            f = tf["def"]
        return min(max(f, 0.75), 1.30), tf["n"]

    factors, counts, raw = [], [], []
    for _, row in df.iterrows():
        f, n = player_factor(row)
        factors.append(f)
        counts.append(n)
        season_s, gw4_s = row.get("season_overall_score"), row.get("gw4_overall_score")
        if pd.isna(season_s) and pd.isna(gw4_s):
            base = np.nan
        elif pd.isna(gw4_s):
            base = season_s
        elif pd.isna(season_s):
            base = gw4_s
        else:
            base = season_s * 0.55 + gw4_s * 0.45
        raw.append(base * f if not pd.isna(base) and not pd.isna(f) else np.nan)

    df["next4_fixture_factor"] = np.round(factors, 3)
    df["next4_fixture_count"] = counts
    df["next4_raw"] = raw

    # Normalise 1-5 within position so the stars mean the same as other ratings
    for pos in ["GKP", "DEF", "MID", "FWD"]:
        valid = (df["position"] == pos) & df["next4_raw"].notna()
        if valid.sum() > 1:
            df.loc[valid, "next4_score"] = normalise_to_5(df.loc[valid, "next4_raw"])
    df["next4_overall_rating"] = df["next4_score"].apply(score_to_stars) \
        if "next4_score" in df.columns else "N/A"
    print(f"  next4 ratings for {df['next4_raw'].notna().sum()} players "
          f"over GWs {list(next4_gws)}")

build_next4()

# ── Save ──────────────────────────────────────────────────────────────────────
# Merge photo codes and ownership
ownership_map = season_summary[["id", "code", "selected_by_percent"]].rename(columns={"id": "element"})
df = df.merge(ownership_map, on="element", how="left")

# Penalty / set-piece taker FLAGS (Decision #3: surfaced, NOT in the rating —
# penalties already live inside xG, so a numeric bonus would double-count).
order_cols = ["penalties_order", "corners_and_indirect_freekicks_order", "direct_freekicks_order"]
takers = season_summary[["id"] + [c for c in order_cols if c in season_summary.columns]].rename(columns={"id": "element"})
df = df.merge(takers, on="element", how="left")
df["is_pen_taker"] = (df.get("penalties_order") == 1)
df["is_setpiece_taker"] = ((df.get("corners_and_indirect_freekicks_order") == 1) |
                           (df.get("direct_freekicks_order") == 1))

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
