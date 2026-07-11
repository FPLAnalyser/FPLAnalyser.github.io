import pandas as pd
import numpy as np
import os

# ── Paths ─────────────────────────────────────────────────────────────────────
# FPL_DATA_DIR env var overrides the default Google Drive location (used for testing).
DATA_DIR = os.environ.get("FPL_DATA_DIR") or os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-stefcourt2004@gmail.com/My Drive/FPL/FPL_2025-26_historical")
# CHANGED: input is now the enriched dataset (superset of player_gw_history.csv).
# If player_gw_enriched.csv lives in your repo root instead of the Drive folder,
# set ENRICHED_FILE accordingly.
ENRICHED_FILE = os.environ.get("FPL_ENRICHED_FILE") or os.path.join(DATA_DIR, "player_gw_enriched.csv")
OUTPUT_DIR = DATA_DIR

print("Loading enriched player GW history...")
df = pd.read_csv(ENRICHED_FILE)
print(f"  {len(df)} rows loaded")
print(f"  {len(df.columns)} columns found")

df = df.sort_values(["element", "gw_from_fixture"]).reset_index(drop=True)

# Identity columns we want to keep as-is
IDENTITY_COLS = [
    "element", "web_name", "team", "position", "element_type",
    "round", "gw_from_fixture", "fixture", "opponent_team", "value",
    "was_home", "kickoff_time", "team_h_score", "team_a_score"
]
IDENTITY_COLS = [c for c in IDENTITY_COLS if c in df.columns]

# NEW: enrichment columns get NaN-aware treatment (missing data excluded, never zero)
ENRICH_PREFIXES = ("us_", "pl_")
DELTA_COLS = ["xg_delta", "xa_delta", "xgi_delta"]
# Join metadata and fixture-level per90s are never rolled
# (per-90 RULE: rolling per90s must be recomputed from sums, never averaged)
EXCLUDE_COLS = [
    "understat_id", "join_method_un", "join_conf_un",
    "pl_id", "join_method_pl", "join_conf_pl", "modified"
]
EXCLUDE_COLS += [c for c in df.columns if c.endswith("_per90")]

ENRICH_COLS = [
    c for c in df.columns
    if (c.startswith(ENRICH_PREFIXES) or c in DELTA_COLS)
    and c not in EXCLUDE_COLS
    and pd.api.types.is_numeric_dtype(df[c])
]

# Legacy FPL columns: identical behaviour to before (fillna(0), rolling sum)
ROLLING_COLS = [
    c for c in df.columns
    if c not in IDENTITY_COLS
    and c not in ENRICH_COLS
    and c not in EXCLUDE_COLS
    and pd.api.types.is_numeric_dtype(df[c])
]

print(f"  Identity columns: {len(IDENTITY_COLS)}")
print(f"  Legacy rolling columns: {len(ROLLING_COLS)}")
print(f"  Enrichment rolling columns (NaN-aware): {len(ENRICH_COLS)}")
print(f"  Excluded (join meta / fixture per90s): {len(EXCLUDE_COLS)}")

# Force numeric on legacy cols only — enrichment cols must keep their NaNs
for c in ROLLING_COLS:
    df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
for c in ENRICH_COLS:
    df[c] = pd.to_numeric(df[c], errors="coerce")  # NO fillna — NaN means missing

# Minimum minutes of valid source data before a rolling per90 is scored
MIN_VALID_MINS = {4: 180, 6: 270}

# New per90s recomputed over windows: sum(stat) / sum(valid minutes) * 90
ENRICH_PER90 = [
    "us_npxg", "us_xg_chain", "us_xg_buildup", "us_shots", "us_sot",
    "us_shots_six_yard", "us_shots_penalty_area", "us_shots_out_of_box",
    "us_shots_head",
    "pl_touches_opp_box", "pl_crosses", "pl_corners_taken",
    "pl_fk_crosses", "pl_fk_shots", "pl_chances_created", "pl_big_chances_created"
]

def build_rolling(df, window):
    print(f"\nBuilding {window}GW rolling window...")
    try:
        rolled = df.groupby("element")[ROLLING_COLS].transform(
            lambda x: x.rolling(window, min_periods=1).sum()
        )
        print(f"  Legacy rolling calculation done")

        rolled.columns = [f"{c}_{window}gw" for c in rolled.columns]

        result = pd.concat([df[IDENTITY_COLS], rolled], axis=1)
        result[f"mins_per_game_{window}gw"] = result[f"minutes_{window}gw"] / window

        # Per 90 rate stats (legacy — unchanged)
        mins_col = f"minutes_{window}gw"
        per90_cols = [
            "expected_goals", "expected_assists", "expected_goal_involvements",
            "expected_goals_conceded", "goals_scored", "assists",
            "threat", "creativity", "influence", "ict_index",
            "clearances_blocks_interceptions", "tackles", "interceptions",
            "defensive_contributions", "saves"
        ]
        for col in per90_cols:
            rolled_col = f"{col}_{window}gw"
            if rolled_col in result.columns:
                per90 = []
                for idx, row in result.iterrows():
                    mins = row[mins_col]
                    if mins > 0:
                        per90.append(round(row[rolled_col] / (mins / 90), 2))
                    else:
                        per90.append(None)
                result[f"{col}_per90_{window}gw"] = per90

        # ── NEW: enrichment columns, NaN-aware ────────────────────────────────
        # Rolling sum skips NaN fixtures; valid-minutes = FPL minutes on fixtures
        # where the source reported data, tracked separately per source.
        print(f"  Rolling enrichment columns (NaN-aware)...")
        g = df.groupby("element")

        # Valid minutes per source (Understat / PL API can differ in coverage)
        for src, probe in [("us", "us_npxg"), ("pl", "pl_touches_opp_box")]:
            valid_mins = df["minutes"].where(df[probe].notna())
            result[f"{src}_valid_mins_{window}gw"] = (
                valid_mins.groupby(df["element"]).transform(
                    lambda x: x.rolling(window, min_periods=1).sum())
            )

        for col in ENRICH_COLS:
            rolled_col = f"{col}_{window}gw"
            # rolling().sum() skips NaN; min_periods=1 needs one valid obs, else NaN
            result[rolled_col] = g[col].transform(
                lambda x: x.rolling(window, min_periods=1).sum())

        # Recomputed per90s with minimum-minutes gate — never averaged per90s
        min_mins = MIN_VALID_MINS[window]
        for col in ENRICH_PER90:
            rolled_col = f"{col}_{window}gw"
            if rolled_col not in result.columns:
                continue
            src = "us" if col.startswith("us_") else "pl"
            vm = result[f"{src}_valid_mins_{window}gw"]
            per90 = (result[rolled_col] / vm * 90).round(3)
            per90 = per90.where(vm >= min_mins)  # NaN below threshold, never 0
            result[f"{col}_per90_{window}gw"] = per90

        # xg_delta and friends are linear: rolled sums above are directly usable

        # ── VALIDATION GATES ──────────────────────────────────────────────────
        assert len(result) == len(df), \
            f"GATE FAIL: row count changed ({len(result)} vs {len(df)})"
        for col in ENRICH_COLS:
            rc = f"{col}_{window}gw"
            if result[rc].notna().sum() == 0:
                raise RuntimeError(f"GATE FAIL: {rc} is all-NaN — join broke upstream?")
        # No new per90 may be a plain average of fixture per90s (by construction),
        # and no enrichment column may have been zero-filled:
        for col in ENRICH_COLS:
            if df[col].isna().sum() == 0 and col.startswith(ENRICH_PREFIXES):
                print(f"    note: {col} has zero NaNs in input (unusual — verify source)")
        nan_report = {f"{c}_{window}gw": round(result[f"{c}_{window}gw"].isna().mean(), 3)
                      for c in ENRICH_COLS[:6]}
        print(f"    NaN share (sample): {nan_report}")

        output_path = os.path.join(OUTPUT_DIR, f"rolling_{window}gw.csv")
        result.to_csv(output_path, index=False)
        print(f"  rolling_{window}gw.csv written ({len(result)} rows, {len(result.columns)} columns)")
        return result

    except Exception as e:
        print(f"  ERROR: {e}")
        raise  # fail loudly — do not continue the pipeline on a broken window

r4 = build_rolling(df, 4)
r6 = build_rolling(df, 6)

if r4 is not None:
    print("\nSanity check - Haaland last 4GW totals:")
    haaland = r4[r4["web_name"] == "Haaland"].tail(1)
    if not haaland.empty:
        print(f"  Points: {haaland['total_points_4gw'].values[0]}")
        print(f"  Goals:  {haaland['goals_scored_4gw'].values[0]}")
        print(f"  Assists:{haaland['assists_4gw'].values[0]}")
        print(f"  npxG:   {haaland['us_npxg_4gw'].values[0]}")
        print(f"  npxG/90:{haaland['us_npxg_per90_4gw'].values[0]}")
        print(f"  Box touches/90: {haaland['pl_touches_opp_box_per90_4gw'].values[0]}")
    else:
        print("  Haaland not found")

print("\nAll done!")
