import pandas as pd
import numpy as np
import os

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR = os.environ.get("FPL_DATA_DIR") or os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-stefcourt2004@gmail.com/My Drive/FPL/FPL_2025-26_historical")
# CHANGED: enriched dataset replaces player_gw_history.csv (superset of its columns)
GW_HISTORY_FILE = os.environ.get("FPL_ENRICHED_FILE") or os.path.join(DATA_DIR, "player_gw_enriched.csv")
ROLLING_4GW_FILE = os.path.join(DATA_DIR, "rolling_4gw.csv")
ROLLING_6GW_FILE = os.path.join(DATA_DIR, "rolling_6gw.csv")
SEASON_SUMMARY_FILE = os.path.join(DATA_DIR, "season_summary.csv")  # NEW: set-piece orders + ownership
OUTPUT_DIR = DATA_DIR

print("Loading data...")
gw_history = pd.read_csv(GW_HISTORY_FILE)
r4 = pd.read_csv(ROLLING_4GW_FILE)
r6 = pd.read_csv(ROLLING_6GW_FILE)
season_summary = pd.read_csv(SEASON_SUMMARY_FILE)

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

gw_history = force_numeric(gw_history)
r4 = force_numeric(r4)
r6 = force_numeric(r6)

# NEW: set-piece taker orders + ownership from season summary
SP_COLS = ["corners_and_indirect_freekicks_order", "direct_freekicks_order", "penalties_order"]
missing_sp = [c for c in SP_COLS + ["selected_by_percent"] if c not in season_summary.columns]
if missing_sp:
    raise RuntimeError(f"GATE FAIL: season_summary.csv missing columns: {missing_sp}")
sp_map = season_summary[["id", "selected_by_percent"] + SP_COLS].rename(columns={"id": "element"})
for c in SP_COLS:
    sp_map[c] = pd.to_numeric(sp_map[c], errors="coerce")  # NaN = not a taker
sp_map["selected_by_percent"] = pd.to_numeric(sp_map["selected_by_percent"], errors="coerce")

# Check what starts and minutes columns are called in rolling files
r4_cols = [c for c in r4.columns if "start" in c.lower() or "minute" in c.lower()]
print(f"  Starts/minutes columns in rolling files: {r4_cols}")

r4_final = r4.sort_values("gw_from_fixture").groupby("element").last().reset_index()
r6_final = r6.sort_values("gw_from_fixture").groupby("element").last().reset_index()

print(f"  {len(r4_final)} players in rolling 4GW final snapshot")
print(f"  {len(r6_final)} players in rolling 6GW final snapshot")

# GATE: new enrichment columns must be present in rolling files
REQUIRED_ENRICH = ["us_npxg_per90_4gw", "pl_chances_created_per90_4gw", "us_valid_mins_4gw"]
missing = [c for c in REQUIRED_ENRICH if c not in r4.columns]
if missing:
    raise RuntimeError(f"GATE FAIL: rolling_4gw.csv missing enrichment columns {missing} — rerun rolling_calculations.py")

# ── Defensive contributions ───────────────────────────────────────────────────
print("Calculating defensive contribution hit rates...")

def def_contrib_stats(gw_history, position, threshold):
    pos_data = gw_history[gw_history["position"] == position].copy()
    if "defensive_contribution" not in pos_data.columns:
        return pd.DataFrame()
    pos_data = pos_data.sort_values("gw_from_fixture")
    results = []
    for element, group in pos_data.groupby("element"):
        last4 = group.tail(4)
        last6 = group.tail(6)
        hits4 = (last4["defensive_contribution"] >= threshold).sum()
        hits6 = (last6["defensive_contribution"] >= threshold).sum()
        near4 = ((last4["defensive_contribution"] >= threshold - 3) &
                 (last4["defensive_contribution"] < threshold)).sum()
        near6 = ((last6["defensive_contribution"] >= threshold - 3) &
                 (last6["defensive_contribution"] < threshold)).sum()
        avg4 = last4["defensive_contribution"].mean()
        avg6 = last6["defensive_contribution"].mean()
        # NEW: season-level hits for personas_season
        hits_season = (group["defensive_contribution"] >= threshold).sum()
        near_season = ((group["defensive_contribution"] >= threshold - 3) &
                       (group["defensive_contribution"] < threshold)).sum()
        results.append({
            "element": element,
            "dc_hits_4gw": hits4,
            "dc_hits_6gw": hits6,
            "dc_near_miss_4gw": near4,
            "dc_near_miss_6gw": near6,
            "dc_avg_per_game_4gw": round(avg4, 1),
            "dc_avg_per_game_6gw": round(avg6, 1),
            "dc_hits_season": hits_season,
            "dc_near_miss_season": near_season
        })
    return pd.DataFrame(results)

def_dc = def_contrib_stats(gw_history, "DEF", 10)
mid_dc = def_contrib_stats(gw_history, "MID", 12)
fwd_dc = def_contrib_stats(gw_history, "FWD", 12)
all_dc_list = [x for x in [def_dc, mid_dc, fwd_dc] if not x.empty]
if all_dc_list:
    all_dc = pd.concat(all_dc_list)
else:
    print("  WARNING: No defensive contribution data found")
    all_dc = pd.DataFrame(columns=["element", "dc_hits_4gw", "dc_hits_6gw",
                                    "dc_near_miss_4gw", "dc_near_miss_6gw",
                                    "dc_avg_per_game_4gw", "dc_avg_per_game_6gw",
                                    "dc_hits_season", "dc_near_miss_season"])

# ── Saves stats ───────────────────────────────────────────────────────────────
print("Calculating save hit rates...")

gkp_data = gw_history[gw_history["position"] == "GKP"].copy()
gkp_data = gkp_data.sort_values("gw_from_fixture")
save_results = []
for element, group in gkp_data.groupby("element"):
    last4 = group.tail(4)
    last6 = group.tail(6)
    save_results.append({
        "element": element,
        "saves3_games_4gw": (last4["saves"] >= 3).sum(),
        "saves3_games_6gw": (last6["saves"] >= 3).sum(),
        "saves6_games_4gw": (last4["saves"] >= 6).sum(),
        "saves6_games_6gw": (last6["saves"] >= 6).sum(),
        "avg_saves_per_game_4gw": round(last4["saves"].mean(), 1),
        "avg_saves_per_game_6gw": round(last6["saves"].mean(), 1)
    })
saves_df = pd.DataFrame(save_results)

# ── Points variance ───────────────────────────────────────────────────────────
print("Calculating points variance...")

variance_results = []
for element, group in gw_history.groupby("element"):
    last4 = group.tail(4)
    last6 = group.tail(6)
    played = group[group["minutes"] > 0]
    variance_results.append({
        "element": element,
        "points_std_4gw": round(last4["total_points"].std(), 2),
        "points_std_6gw": round(last6["total_points"].std(), 2),
        "points_std_season": round(played["total_points"].std(), 2) if len(played) > 1 else 0
    })
variance_df = pd.DataFrame(variance_results)

# ── Starts per player from GW history ────────────────────────────────────────
print("Calculating starts from GW history...")

starts_results = []
for element, group in gw_history.groupby("element"):
    group = group.sort_values("gw_from_fixture")
    last4 = group.tail(4)
    last6 = group.tail(6)
    starts_results.append({
        "element": element,
        "starts_last4": last4["starts"].sum() if "starts" in last4.columns else 0,
        "starts_last6": last6["starts"].sum() if "starts" in last6.columns else 0,
        "mins_last4": last4["minutes"].sum(),
        "mins_last6": last6["minutes"].sum(),
        "starts_season": group["starts"].sum() if "starts" in group.columns else 0,
        "mins_season": group["minutes"].sum(),
        "games_played_season": (group["minutes"] > 0).sum()
    })
starts_df = pd.DataFrame(starts_results)

# ── NEW: season-window enrichment aggregates (for season personas & shifts) ───
print("Building season enrichment aggregates...")

season_rows = []
for element, group in gw_history.groupby("element"):
    group = group.sort_values("gw_from_fixture")
    row = {"element": element}
    # legacy FPL sums, season scale
    for col in ["total_points", "goals_scored", "assists", "clean_sheets", "bps",
                "expected_goals", "expected_assists", "expected_goal_involvements",
                "expected_goals_conceded", "goals_conceded", "saves"]:
        row[f"{col}_season"] = group[col].sum()
    # NaN-aware enrichment sums + valid minutes per source
    us_valid = group["minutes"].where(group["us_npxg"].notna())
    pl_valid = group["minutes"].where(group["pl_touches_opp_box"].notna())
    row["us_valid_mins_season"] = us_valid.sum()
    row["pl_valid_mins_season"] = pl_valid.sum()
    for col in ["us_npxg", "us_xg_chain", "us_xg_buildup", "us_shots",
                "us_shots_six_yard", "us_shots_penalty_area", "us_shots_out_of_box",
                "pl_touches_opp_box", "pl_crosses", "pl_corners_taken",
                "pl_fk_crosses", "pl_fk_shots", "pl_chances_created", "xg_delta"]:
        row[f"{col}_season"] = group[col].sum(skipna=True) if group[col].notna().any() else np.nan
    season_rows.append(row)
season_enrich = pd.DataFrame(season_rows)

MIN_VALID = {"4": 180, "6": 270, "season": 450}

def add_season_per90(df):
    for col, src in [("us_npxg", "us"), ("us_xg_chain", "us"), ("us_xg_buildup", "us"),
                     ("us_shots", "us"), ("us_shots_six_yard", "us"),
                     ("us_shots_penalty_area", "us"), ("us_shots_out_of_box", "us"),
                     ("pl_touches_opp_box", "pl"), ("pl_crosses", "pl"),
                     ("pl_corners_taken", "pl"), ("pl_fk_crosses", "pl"),
                     ("pl_fk_shots", "pl"), ("pl_chances_created", "pl")]:
        vm = df[f"{src}_valid_mins_season"]
        per90 = (df[f"{col}_season"] / vm * 90).round(3)
        df[f"{col}_per90_season"] = per90.where(vm >= MIN_VALID["season"])
    return df

season_enrich = add_season_per90(season_enrich)

# ── Merge everything ──────────────────────────────────────────────────────────
print("Merging data...")

def build_frame(base):
    d = base.merge(all_dc, on="element", how="left")
    d = d.merge(saves_df, on="element", how="left")
    d = d.merge(variance_df, on="element", how="left")
    d = d.merge(starts_df, on="element", how="left")
    d = d.merge(sp_map, on="element", how="left")  # NEW: SP orders + ownership
    # fillna(0) ONLY on non-enrichment columns — NaN semantics preserved
    legacy = [c for c in d.columns if not c.startswith(ENRICH_MARKERS) and c not in SP_COLS]
    d[legacy] = d[legacy].fillna(0)
    return d

df4 = build_frame(r4_final)
df6 = build_frame(r6_final)

# Season frame: identity from r4_final + season aggregates
identity = r4_final[["element", "web_name", "team", "position", "gw_from_fixture", "value"]]
dfS = identity.merge(season_enrich, on="element", how="left")
dfS = build_frame(dfS)

# ── NEW: percentile thresholds for enhanced personas ─────────────────────────
# Percentiles computed among eligible attackers (MID+FWD pooled, matching the
# combined-attacker convention) with enough valid source minutes.
print("Computing percentile thresholds...")

def pct_thresholds(frame, wl):
    att = frame[frame["position"].isin(["MID", "FWD"])].copy()
    min_starts = {"4": 3, "6": 5, "season": 10}[wl]
    starts_col = {"4": "starts_last4", "6": "starts_last6", "season": "starts_season"}[wl]
    elig = att[(att[starts_col] >= min_starts)]

    def p(col, q):
        s = elig[col].dropna()
        return s.quantile(q) if len(s) >= 10 else np.nan

    box_shots = (elig[f"us_shots_six_yard_per90_{wl}gw" if wl != "season" else "us_shots_six_yard_per90_season"]
                 .add(elig[f"us_shots_penalty_area_per90_{wl}gw" if wl != "season" else "us_shots_penalty_area_per90_season"]))
    creat_depth = (elig[f"us_xg_chain_per90_{wl}gw" if wl != "season" else "us_xg_chain_per90_season"]
                   .add(elig[f"us_xg_buildup_per90_{wl}gw" if wl != "season" else "us_xg_buildup_per90_season"]))
    sfx = f"{wl}gw" if wl != "season" else "season"
    deliveries = (elig[f"pl_corners_taken_per90_{sfx}"]
                  .add(elig[f"pl_fk_crosses_per90_{sfx}"])
                  .add(elig[f"pl_fk_shots_per90_{sfx}"]))
    npxg_per_shot = (elig[f"us_npxg_{sfx}"] / elig[f"us_shots_{sfx}"]).replace([np.inf, -np.inf], np.nan)
    oob_share = (elig[f"us_shots_out_of_box_{sfx}"] / elig[f"us_shots_{sfx}"]).replace([np.inf, -np.inf], np.nan)
    sy_share = (elig[f"us_shots_six_yard_{sfx}"] / elig[f"us_shots_{sfx}"]).replace([np.inf, -np.inf], np.nan)

    def q(series, quant):
        s = series.dropna()
        return s.quantile(quant) if len(s) >= 10 else np.nan

    t = {
        "npxg_p80": p(f"us_npxg_per90_{sfx}", 0.80),
        "box_shots_p75": q(box_shots, 0.75),
        "chances_p75": p(f"pl_chances_created_per90_{sfx}", 0.75),
        "creat_depth_p75": q(creat_depth, 0.75),
        "creat_depth_p80": q(creat_depth, 0.80),
        "npxg_p40": p(f"us_npxg_per90_{sfx}", 0.40),
        "buildup_p25": p(f"us_xg_buildup_per90_{sfx}", 0.25),
        "oob_share_p75": q(oob_share, 0.75),
        "npxg_per_shot_p25": q(npxg_per_shot, 0.25),
        "sy_share_p80": q(sy_share, 0.80),
        "deliveries_p75": q(deliveries, 0.75),
        "deliveries_p90": q(deliveries, 0.90),
        "touches_box_p75": p(f"pl_touches_opp_box_per90_{sfx}", 0.75),
    }
    # DEF-specific deliveries/touches percentiles for Set Piece Threat
    defs = frame[(frame["position"] == "DEF") & (frame[starts_col] >= min_starts)]
    d_deliv = (defs[f"pl_corners_taken_per90_{sfx}"]
               .add(defs[f"pl_fk_crosses_per90_{sfx}"])
               .add(defs[f"pl_fk_shots_per90_{sfx}"]))
    t["def_deliveries_p75"] = q(d_deliv, 0.75)
    t["def_deliveries_p90"] = q(d_deliv, 0.90)
    t["def_touches_box_p75"] = defs[f"pl_touches_opp_box_per90_{sfx}"].dropna().quantile(0.75) \
        if defs[f"pl_touches_opp_box_per90_{sfx}"].notna().sum() >= 10 else np.nan
    if any(pd.isna(v) for v in t.values()):
        bad = [k for k, v in t.items() if pd.isna(v)]
        raise RuntimeError(f"GATE FAIL: percentile thresholds undefined for {wl}: {bad} "
                           f"(too few eligible players with valid source data)")
    return t

# ── Persona functions ─────────────────────────────────────────────────────────

def get_starts_mins(row, window):
    if window == "season":
        return row.get("starts_season", 0), row.get("mins_season", 0)
    starts = row.get(f"starts_last{window}", 0)
    mins = row.get(f"mins_last{window}", 0)
    return starts, mins

def get_flags(starts, mins, window):
    flags = []
    if window == "season":
        return flags  # minutes flags are rolling-window concepts
    min_starts = 3 if window == 4 else 5
    if starts < min_starts:
        flags.append("Minutes Risk")
    if (window == 4 and starts >= 4 and mins >= 340) or \
       (window == 6 and starts >= 6 and mins >= 510):
        flags.append("Minutes Monster")
    return flags

def sfx_of(window):
    return "season" if window == "season" else f"{window}gw"

def nn(row, col):
    """Fetch a value preserving NaN semantics (returns np.nan if missing/NaN)."""
    v = row.get(col, np.nan)
    try:
        return float(v)
    except (TypeError, ValueError):
        return np.nan

def sp_order_signal(row):
    corners = nn(row, "corners_and_indirect_freekicks_order")
    dfk = nn(row, "direct_freekicks_order")
    return (not pd.isna(corners) and corners <= 2) or (not pd.isna(dfk) and dfk <= 2)

def assign_set_piece_threat(row, t, sfx, is_def):
    """NEW persona — score-based: taker order, deliveries volume, box presence."""
    deliv = np.nansum([nn(row, f"pl_corners_taken_per90_{sfx}"),
                       nn(row, f"pl_fk_crosses_per90_{sfx}"),
                       nn(row, f"pl_fk_shots_per90_{sfx}")])
    if pd.isna(nn(row, f"pl_corners_taken_per90_{sfx}")):
        return False  # no valid PL data — do not score
    touches = nn(row, f"pl_touches_opp_box_per90_{sfx}")
    deliv_thr = t["def_deliveries_p75"] if is_def else t["deliveries_p75"]
    touch_thr = t["def_touches_box_p75"] if is_def else t["touches_box_p75"]
    deliv_p90 = t["def_deliveries_p90"] if is_def else t["deliveries_p90"]
    score = 0
    if sp_order_signal(row):
        score += 2
    if deliv >= deliv_p90:
        score += 3  # elite delivery volume is sufficient evidence on its own
    elif deliv >= deliv_thr:
        score += 1
    if not pd.isna(touches) and touches >= touch_thr:
        score += 1
    return score >= 3  # taker + volume signal, or elite (P90) delivery volume

def assign_gkp_personas(row, window):
    starts, mins = get_starts_mins(row, window)
    flags = get_flags(starts, mins, window)
    personas = []

    if window == "season":
        n = max(row.get("games_played_season", 0), 1)
        scale = n / 4.0
        min_starts, w = 10, 4
    else:
        scale = 1.0
        min_starts, w = (3, 4) if window == 4 else (5, 6)
    sfx = sfx_of(window)

    if starts >= min_starts:
        saves = row[f"saves_{sfx}"]
        xgc = row[f"expected_goals_conceded_{sfx}"]
        gc = row[f"goals_conceded_{sfx}"]
        bps = row[f"bps_{sfx}"]
        avg_saves = row.get(f"avg_saves_per_game_{w}gw", saves / max(row.get("games_played_season", 1), 1) if window == "season" else 0)

        base = {4: {"saves_hi": 9, "xgc_hi": 4, "saves_lo": 7, "xgc_lo": 3, "bps": 58},
                6: {"saves_hi": 14, "xgc_hi": 7, "saves_lo": 10, "xgc_lo": 5, "bps": 87}}[w]
        t = {k: v * scale for k, v in base.items()} if window == "season" else base

        if saves > t["saves_hi"] and xgc > t["xgc_hi"] and avg_saves >= 3:
            personas.append("Shot Stopper")
        if saves > t["saves_hi"] and xgc <= t["xgc_hi"] and avg_saves >= 3:
            personas.append("Premium Keeper")
        if saves <= t["saves_lo"] and xgc <= t["xgc_lo"]:
            personas.append("Sweeper Keeper")
        if xgc > 0 and round(xgc - gc, 2) >= 1.0 * scale:
            personas.append("Overperformer")
        if round(gc - xgc, 2) >= 1.0 * scale:
            personas.append("Liability")
        if bps > t["bps"]:
            personas.append("Bonus Magnet")

    return personas, flags

def assign_def_personas(row, window, t):
    starts, mins = get_starts_mins(row, window)
    flags = get_flags(starts, mins, window)
    personas = []

    if window == "season":
        n = max(row.get("games_played_season", 0), 1)
        scale = n / 4.0
        min_starts, w = 10, 4
    else:
        scale = 1.0
        min_starts, w = (3, 4) if window == 4 else (5, 6)
    sfx = sfx_of(window)

    if starts >= min_starts:
        cs = row[f"clean_sheets_{sfx}"]
        xgc = row[f"expected_goals_conceded_{sfx}"]
        gc = row[f"goals_conceded_{sfx}"]
        xA = row[f"expected_assists_{sfx}"]
        xG = row[f"expected_goals_{sfx}"]
        bps = row[f"bps_{sfx}"]
        cost = row.get("value", 999)
        dc_hits = row.get(f"dc_hits_{sfx}", 0)
        dc_near = row.get(f"dc_near_miss_{sfx}", 0)

        base = {4: {"cs": 2, "xA": 0.40, "xG": 0.40, "bps": 46, "cost": 45},
                6: {"cs": 3, "xA": 0.60, "xG": 0.60, "bps": 68, "cost": 45}}[w]
        if window == "season":
            t_ = {k: (v * scale if k != "cost" else v) for k, v in base.items()}
        else:
            t_ = base

        if cs >= t_["cs"] and gc < xgc:
            personas.append("Reliable Shieldwall")
        if cs >= t_["cs"] and gc >= xgc:
            personas.append("Flattering Back")
        if xA >= t_["xA"]:
            personas.append("Attacking Defender")
        if xG >= t_["xG"]:
            personas.append("Scoring Defender")
        dc_thr = 2 if w == 4 else 3
        if window == "season":
            dc_thr = max(2, round(0.5 * row.get("games_played_season", 0)))
        if dc_hits >= dc_thr:
            personas.append("Defensive Workhorse")
        if dc_hits == 0 and dc_near >= (2 * scale if window == "season" else 2):
            personas.append("Emerging Contributor")
        if cost <= t_["cost"] and starts >= min_starts and cs >= (1 * scale if window == "season" else 1):
            personas.append("Budget Enabler")
        if bps > t_["bps"]:
            personas.append("Bonus Magnet")

        # NEW: Set Piece Threat (DEF)
        if assign_set_piece_threat(row, t, sfx, is_def=True):
            personas.append("Set Piece Threat")
        # NEW: Deep Lying Creator (ball-playing defenders qualify)
        cd = np.nansum([nn(row, f"us_xg_chain_per90_{sfx}"), nn(row, f"us_xg_buildup_per90_{sfx}")])
        npxg90 = nn(row, f"us_npxg_per90_{sfx}")
        if not pd.isna(nn(row, f"us_xg_buildup_per90_{sfx}")) and not pd.isna(npxg90):
            if cd >= t["creat_depth_p80"] and npxg90 <= t["npxg_p40"]:
                personas.append("Deep Lying Creator")

    return personas, flags

def assign_mf_personas(row, window, t):
    starts, mins = get_starts_mins(row, window)
    flags = get_flags(starts, mins, window)
    personas = []

    if window == "season":
        n = max(row.get("games_played_season", 0), 1)
        scale = n / 4.0
        min_starts, w = 10, 4
    else:
        scale = 1.0
        min_starts, w = (3, 4) if window == 4 else (5, 6)
    sfx = sfx_of(window)

    if starts >= min_starts:
        goals = row[f"goals_scored_{sfx}"]
        xG = row[f"expected_goals_{sfx}"]
        xA = row[f"expected_assists_{sfx}"]
        xGI = row[f"expected_goal_involvements_{sfx}"]
        total_pts = row[f"total_points_{sfx}"]
        bps = row[f"bps_{sfx}"]
        # FIXED: was row.get("selected_by_percent", 100) against rolling files
        # that never contained the column → Differential never fired.
        selected = nn(row, "selected_by_percent")
        pts_std = row.get(f"points_std_{sfx}", 0)
        dc_hits = row.get(f"dc_hits_{sfx}", 0)
        dc_near = row.get(f"dc_near_miss_{sfx}", 0)

        base = {4: {"xG": 0.80, "xA": 0.80, "xGI": 1.50, "pts_hi": 16,
                    "pts_mid": 9, "pts_lo": 7, "bps": 51, "selected": 0.8,
                    "std_lo": 2.5, "std_hi": 4.5, "goals_cf": 2},
                6: {"xG": 1.20, "xA": 1.20, "xGI": 2.25, "pts_hi": 24,
                    "pts_mid": 14, "pts_lo": 10, "bps": 77, "selected": 0.8,
                    "std_lo": 2.5, "std_hi": 4.5, "goals_cf": 3}}[w]
        if window == "season":
            no_scale = {"selected", "std_lo", "std_hi"}
            t_ = {k: (v * scale if k not in no_scale else v) for k, v in base.items()}
        else:
            t_ = base

        # Enrichment per90s (NaN = insufficient valid source minutes → skip)
        npxg90 = nn(row, f"us_npxg_per90_{sfx}")
        box_shots90 = np.nansum([nn(row, f"us_shots_six_yard_per90_{sfx}"),
                                 nn(row, f"us_shots_penalty_area_per90_{sfx}")]) \
            if not pd.isna(nn(row, f"us_shots_six_yard_per90_{sfx}")) else np.nan
        chances90 = nn(row, f"pl_chances_created_per90_{sfx}")
        creat_depth = np.nansum([nn(row, f"us_xg_chain_per90_{sfx}"),
                                 nn(row, f"us_xg_buildup_per90_{sfx}")]) \
            if not pd.isna(nn(row, f"us_xg_buildup_per90_{sfx}")) else np.nan
        shots = nn(row, f"us_shots_{sfx}")
        oob = nn(row, f"us_shots_out_of_box_{sfx}")
        sy = nn(row, f"us_shots_six_yard_{sfx}")
        buildup90 = nn(row, f"us_xg_buildup_per90_{sfx}")

        # ENHANCED: Goal Machine — xG rule OR underlying npxG + box-shot volume
        if xG >= t_["xG"] or \
           (not pd.isna(npxg90) and not pd.isna(box_shots90)
                and npxg90 >= t["npxg_p80"] and box_shots90 >= t["box_shots_p75"]):
            personas.append("Goal Machine")
        if goals >= t_["goals_cf"] and xG > 0 and (goals - xG) >= 1 * scale:
            personas.append("Clinical Finisher")
        if xG >= t_["xG"] and (xG - goals) >= 1 * scale:
            personas.append("Wasteful Striker")
        # ENHANCED: Creative Wizard — xA rule OR chance creation + chain/buildup
        if xA >= t_["xA"] or \
           (not pd.isna(chances90) and not pd.isna(creat_depth)
                and chances90 >= t["chances_p75"] and creat_depth >= t["creat_depth_p75"]):
            personas.append("Creative Wizard")
        if xGI >= t_["xGI"] and (goals + xA) < xGI:
            personas.append("xGI Beast")
        dc_thr = 2 if w == 4 else 3
        if window == "season":
            dc_thr = max(2, round(0.5 * row.get("games_played_season", 0)))
        if dc_hits >= dc_thr:
            personas.append("Defensive Contributor")
        if dc_hits == 0 and dc_near >= (2 * scale if window == "season" else 2):
            personas.append("Emerging Contributor")
        if total_pts >= t_["pts_hi"]:
            personas.append("Captaincy King")
        if total_pts >= t_["pts_mid"] and pts_std <= t_["std_lo"]:
            personas.append("Metronome")
        if total_pts >= t_["pts_lo"] and pts_std >= t_["std_hi"]:
            personas.append("Chaos Merchant")
        if not pd.isna(selected) and selected <= t_["selected"] and total_pts >= t_["pts_mid"]:
            personas.append("Differential")
        if bps > t_["bps"]:
            personas.append("Bonus Magnet")

        # NEW: Volume Shooter — pot-shots from range, poor shot quality
        min_shots = {4: 6, 6: 9}.get(w if window != "season" else None,
                                     max(15, row.get("games_played_season", 0) * 1.5))
        if window == "season":
            min_shots = max(15, row.get("games_played_season", 0) * 1.5)
        if not pd.isna(shots) and shots >= min_shots and not pd.isna(oob):
            oob_share = oob / shots if shots > 0 else np.nan
            npxg_ps = nn(row, f"us_npxg_{sfx}") / shots if shots > 0 else np.nan
            if not pd.isna(oob_share) and oob_share >= t["oob_share_p75"] \
                    and not pd.isna(npxg_ps) and npxg_ps <= t["npxg_per_shot_p25"]:
                personas.append("Volume Shooter")

        # NEW: Poacher — lives in the six-yard box, uninvolved in buildup
        min_shots_p = {4: 4, 6: 6}.get(w if window != "season" else None, 10)
        if window == "season":
            min_shots_p = max(10, row.get("games_played_season", 0))
        if not pd.isna(shots) and shots >= min_shots_p and not pd.isna(sy) and not pd.isna(buildup90):
            sy_share = sy / shots if shots > 0 else np.nan
            if not pd.isna(sy_share) and sy_share >= t["sy_share_p80"] and buildup90 <= t["buildup_p25"]:
                personas.append("Poacher")

        # NEW: Set Piece Threat
        if assign_set_piece_threat(row, t, sfx, is_def=False):
            personas.append("Set Piece Threat")

        # NEW: Deep Lying Creator — high chain/buildup, low direct goal threat
        if not pd.isna(creat_depth) and not pd.isna(npxg90):
            if creat_depth >= t["creat_depth_p80"] and npxg90 <= t["npxg_p40"]:
                personas.append("Deep Lying Creator")

    return personas, flags

# ── Apply personas ────────────────────────────────────────────────────────────
print("Assigning personas...")

def apply_personas(df, window):
    wl = "season" if window == "season" else str(window)
    t = pct_thresholds(df, wl)
    sfx = sfx_of(window)
    persona_rows = []
    for _, row in df.iterrows():
        pos = row.get("position", "")
        if pos == "GKP":
            personas, flags = assign_gkp_personas(row, window)
        elif pos == "DEF":
            personas, flags = assign_def_personas(row, window, t)
        elif pos in ["MID", "FWD"]:
            personas, flags = assign_mf_personas(row, window, t)
        else:
            personas, flags = [], []

        out = {
            "element": row["element"],
            "web_name": row["web_name"],
            "team": row["team"],
            "position": pos,
            "gw_from_fixture": row["gw_from_fixture"],
            f"total_points_{sfx}": row.get(f"total_points_{sfx}", 0),
            f"minutes_{sfx}": row.get(f"minutes_{sfx}", row.get("mins_season", 0)),
            "personas": ", ".join(personas) if personas else "None",
            "flags": ", ".join(flags) if flags else "",
            "persona_count": len(personas)
        }
        if window != "season":
            out[f"starts_last{window}"] = row.get(f"starts_last{window}", 0)
        else:
            out["starts_season"] = row.get("starts_season", 0)
        persona_rows.append(out)

    return pd.DataFrame(persona_rows)

personas_4gw = apply_personas(df4, 4)
personas_6gw = apply_personas(df6, 6)
personas_season = apply_personas(dfS, "season")  # NEW output (persona shift detector input)

# GATE: original output columns must all still exist (additive-only guarantee)
ORIG_4GW_COLS = ["element", "web_name", "team", "position", "gw_from_fixture",
                 "total_points_4gw", "minutes_4gw", "starts_last4",
                 "personas", "flags", "persona_count"]
missing_out = [c for c in ORIG_4GW_COLS if c not in personas_4gw.columns]
if missing_out:
    raise RuntimeError(f"GATE FAIL: personas_4gw.csv lost columns {missing_out}")

personas_4gw.to_csv(os.path.join(OUTPUT_DIR, "personas_4gw.csv"), index=False)
personas_6gw.to_csv(os.path.join(OUTPUT_DIR, "personas_6gw.csv"), index=False)
personas_season.to_csv(os.path.join(OUTPUT_DIR, "personas_season.csv"), index=False)

print("\nDone! Files saved:")
print(f"  personas_4gw.csv — {len(personas_4gw)} players")
print(f"  personas_6gw.csv — {len(personas_6gw)} players")
print(f"  personas_season.csv — {len(personas_season)} players (NEW)")

# ── Validation snapshot ───────────────────────────────────────────────────────
print("\n── VALIDATION SNAPSHOT ──────────────────────────────────────")
for pos in ["GKP", "DEF", "MID", "FWD"]:
    print(f"\n{pos} — 4GW personas (top 10 by points):")
    subset = personas_4gw[personas_4gw["position"] == pos].sort_values(
        "total_points_4gw", ascending=False).head(10)
    for _, r in subset.iterrows():
        flags_str = f" [{r['flags']}]" if r['flags'] else ""
        print(f"  {r['web_name']:<20} {r['personas']}{flags_str}")

print("\n── NEW PERSONA COUNTS (4GW) ────────────────────────────────")
for p in ["Volume Shooter", "Poacher", "Set Piece Threat", "Deep Lying Creator", "Differential"]:
    hits = personas_4gw[personas_4gw["personas"].str.contains(p, na=False)]
    names = ", ".join(hits["web_name"].head(8).tolist())
    print(f"  {p:<20} {len(hits):>3} players — {names}")

print("\n── MINUTES RISK PLAYERS (4GW) ───────────────────────────────")
risk = personas_4gw[personas_4gw["flags"].str.contains("Minutes Risk", na=False)]
print(f"  {len(risk)} players flagged as Minutes Risk")

print("\n── MINUTES MONSTERS (4GW) ───────────────────────────────────")
for pos in ["GKP", "DEF", "MID", "FWD"]:
    monsters = personas_4gw[
        (personas_4gw["position"] == pos) &
        (personas_4gw["flags"].str.contains("Minutes Monster", na=False))
    ]
    print(f"  {pos}: {len(monsters)} — {', '.join(monsters['web_name'].tolist())}")
