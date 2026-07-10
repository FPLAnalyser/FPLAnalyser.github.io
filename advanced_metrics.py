import pandas as pd
import numpy as np
import os

DATA_DIR = os.environ.get("FPL_DATA_DIR") or os.path.expanduser("~/Library/CloudStorage/GoogleDrive-stefcourt2004@gmail.com/My Drive/FPL/FPL_2025-26_historical")
# CHANGED: enriched dataset replaces player_gw_history.csv (superset of its columns)
GW_HISTORY_FILE = os.environ.get("FPL_ENRICHED_FILE") or os.path.join(DATA_DIR, "player_gw_enriched.csv")
SEASON_SUMMARY_FILE = os.path.join(DATA_DIR, "season_summary.csv")
OUTPUT_DIR = DATA_DIR

print("Loading data...")
gw = pd.read_csv(GW_HISTORY_FILE)
season = pd.read_csv(SEASON_SUMMARY_FILE)

ENRICH_MARKERS = ("us_", "pl_", "xg_delta", "xa_delta", "xgi_delta")

def force_numeric(df):
    for c in df.columns:
        if c in ["web_name", "team", "position", "was_home", "kickoff_time"]:
            continue
        if c.startswith(ENRICH_MARKERS):
            df[c] = pd.to_numeric(df[c], errors="coerce")  # NaN preserved: missing != 0
        else:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    return df

gw = force_numeric(gw)
season = force_numeric(season)

print(f"  {len(gw)} GW rows loaded")
print(f"  {len(season)} players in season summary")

gw = gw.sort_values(["element", "gw_from_fixture"]).reset_index(drop=True)

# ── Benchmark: average points per game by position ────────────────────────────
print("Calculating position benchmarks...")
position_avg = gw.groupby("position")["total_points"].mean()
print(f"  Position averages: {position_avg.to_dict()}")

# ── Helper: safe divide ───────────────────────────────────────────────────────
def safe_divide(numerator, denominator, min_denominator=0.1):
    if abs(denominator) < min_denominator:
        return 0
    return round(numerator / denominator, 3)

# ── Player level metrics ──────────────────────────────────────────────────────
print("Calculating player level metrics...")

results = []

for element, group in gw.groupby("element"):
    group = group.sort_values("gw_from_fixture").reset_index(drop=True)

    web_name = group["web_name"].iloc[-1]
    team = group["team"].iloc[-1]
    position = group["position"].iloc[-1]

    # Minimum starts filter — must have started 3 of last 4 games
    last4_starts = group.tail(4)["starts"].sum()
    if last4_starts < 3:
        continue

    benchmark = position_avg.get(position, 0)

    def calc_metrics(games, window_label):
        if len(games) < 2:
            return {}

        pts = games["total_points"].values
        was_home = games["was_home"].values if "was_home" in games.columns else None

        n = len(pts)
        avg_pts = np.mean(pts)
        std_pts = np.std(pts)

        # Alpha
        alpha = avg_pts - benchmark

        # Sharpe
        sharpe = safe_divide(alpha, std_pts)

        # Sortino
        downside = pts[pts < benchmark] - benchmark
        downside_std = np.std(downside) if len(downside) > 0 else 0
        sortino = safe_divide(alpha, downside_std)

        # Consistency score
        consistency = safe_divide(std_pts, avg_pts) if avg_pts > 0 else 0

        # Maximum drawdown
        below = pts < benchmark
        max_drawdown = 0
        current = 0
        for b in below:
            if b:
                current += 1
                max_drawdown = max(max_drawdown, current)
            else:
                current = 0

        # Information ratio
        excess_returns = pts - benchmark
        excess_std = np.std(excess_returns)
        info_ratio = safe_divide(np.mean(excess_returns), excess_std)

        # Home vs Away
        if was_home is not None:
            home_mask = was_home == 1
            away_mask = was_home == 0
            home_avg = round(np.mean(pts[home_mask]), 2) if home_mask.sum() > 0 else 0
            away_avg = round(np.mean(pts[away_mask]), 2) if away_mask.sum() > 0 else 0
            home_away_diff = round(home_avg - away_avg, 2)
        else:
            home_avg = away_avg = home_away_diff = 0

        # NEW: finishing/creation deltas (linear — summed over the window)
        xg_d = round(games["xg_delta"].sum(), 2) if "xg_delta" in games.columns else 0
        xgi_d = round(games["xgi_delta"].sum(), 2) if "xgi_delta" in games.columns else 0

        return {
            f"avg_pts_{window_label}": round(avg_pts, 2),
            f"xg_delta_{window_label}": xg_d,
            f"xgi_delta_{window_label}": xgi_d,
            f"alpha_{window_label}": round(alpha, 2),
            f"sharpe_{window_label}": sharpe,
            f"sortino_{window_label}": sortino,
            f"info_ratio_{window_label}": info_ratio,
            f"consistency_{window_label}": round(consistency, 3),
            f"max_drawdown_{window_label}": max_drawdown,
            f"home_avg_{window_label}": home_avg,
            f"away_avg_{window_label}": away_avg,
            f"home_away_diff_{window_label}": home_away_diff
        }

    last4 = group.tail(4)
    last6 = group.tail(6)
    season_to_date = group

    m4 = calc_metrics(last4, "4gw")
    m6 = calc_metrics(last6, "6gw")
    ms = calc_metrics(season_to_date, "season")

    # Beta — season to date only
    if len(season_to_date) >= 5:
        pts_series = season_to_date["total_points"].values
        gc_series = season_to_date["goals_conceded"].values
        if np.std(gc_series) > 0.1 and np.std(pts_series) > 0.1:
            beta = round(np.corrcoef(pts_series, gc_series)[0, 1], 3)
        else:
            beta = 0
    else:
        beta = 0

    row = {
        "element": element,
        "web_name": web_name,
        "team": team,
        "position": position,
        "benchmark_ppg": round(benchmark, 2),
        "beta_season": beta
    }
    row.update(m4)
    row.update(m6)
    row.update(ms)
    results.append(row)

player_metrics = pd.DataFrame(results)
print(f"  {len(player_metrics)} players processed")

# ── Team xG and xA share ──────────────────────────────────────────────────────
print("Calculating team xG and xA shares...")

def team_share(gw, window):
    rows = []
    for element, group in gw.groupby("element"):
        games = group.sort_values("gw_from_fixture").tail(window)
        
        # Only include players who started 3 of last 4 games
        last4_starts = group.tail(4)["starts"].sum()
        if last4_starts < 3:
            continue
            
        team = games["team"].iloc[-1]
        web_name = games["web_name"].iloc[-1]
        position = games["position"].iloc[-1]
        player_xg = games["expected_goals"].sum()
        player_xa = games["expected_assists"].sum()
        # NEW: npxG (Understat) — NaN-aware sum, never zero-filled
        player_npxg = games["us_npxg"].sum(skipna=True) if games["us_npxg"].notna().any() else np.nan
        rows.append({
            "element": element,
            "web_name": web_name,
            "team": team,
            "position": position,
            f"player_xg_{window}gw": player_xg,
            f"player_xa_{window}gw": player_xa,
            f"player_npxg_{window}gw": player_npxg
        })
    df = pd.DataFrame(rows)

    team_xg = df.groupby("team")[f"player_xg_{window}gw"].sum().reset_index()
    team_xg.columns = ["team", f"team_xg_{window}gw"]
    team_xa = df.groupby("team")[f"player_xa_{window}gw"].sum().reset_index()
    team_xa.columns = ["team", f"team_xa_{window}gw"]

    df = df.merge(team_xg, on="team", how="left")
    df = df.merge(team_xa, on="team", how="left")

    # NEW: team npxG (NaN rows excluded from both numerator and denominator)
    team_npxg = df.groupby("team")[f"player_npxg_{window}gw"].sum().reset_index()
    team_npxg.columns = ["team", f"team_npxg_{window}gw"]
    df = df.merge(team_npxg, on="team", how="left")

    df[f"xg_share_{window}gw"] = (df[f"player_xg_{window}gw"] / df[f"team_xg_{window}gw"]).round(3)
    df[f"xa_share_{window}gw"] = (df[f"player_xa_{window}gw"] / df[f"team_xa_{window}gw"]).round(3)
    df[f"npxg_share_{window}gw"] = (df[f"player_npxg_{window}gw"] / df[f"team_npxg_{window}gw"]).round(3)

    return df[["element", f"xg_share_{window}gw", f"xa_share_{window}gw",
               f"npxg_share_{window}gw",
               f"team_xg_{window}gw", f"team_xa_{window}gw", f"team_npxg_{window}gw"]]

share4 = team_share(gw, 4)
share6 = team_share(gw, 6)

# Season xG/xA share
print("Calculating season xG and xA shares...")

def team_share_season(gw):
    rows = []
    for element, group in gw.groupby("element"):
        total_mins = group["minutes"].sum()
        total_starts = group["starts"].sum()
        if total_mins < 900 or total_starts < 10:
            continue
        team = group["team"].iloc[-1]
        web_name = group["web_name"].iloc[-1]
        position = group["position"].iloc[-1]
        player_xg = group["expected_goals"].sum()
        player_xa = group["expected_assists"].sum()
        rows.append({
            "element": element,
            "web_name": web_name,
            "team": team,
            "position": position,
            "player_xg_season": player_xg,
            "player_xa_season": player_xa
        })
    df = pd.DataFrame(rows)
    team_xg = df.groupby("team")["player_xg_season"].sum().reset_index()
    team_xg.columns = ["team", "team_xg_season"]
    team_xa = df.groupby("team")["player_xa_season"].sum().reset_index()
    team_xa.columns = ["team", "team_xa_season"]
    df = df.merge(team_xg, on="team", how="left")
    df = df.merge(team_xa, on="team", how="left")
    df["xg_share_season"] = (df["player_xg_season"] / df["team_xg_season"]).round(3)
    df["xa_share_season"] = (df["player_xa_season"] / df["team_xa_season"]).round(3)
    return df[["element", "xg_share_season", "xa_share_season"]]

share_season = team_share_season(gw)
player_metrics = player_metrics.merge(share4, on="element", how="left")
player_metrics = player_metrics.merge(share6, on="element", how="left")
player_metrics = player_metrics.merge(share_season, on="element", how="left")

# ── Form trajectory ───────────────────────────────────────────────────────────
print("Calculating form trajectory...")

trajectory_results = []
for element, group in gw.groupby("element"):
    last4_starts = group.tail(4)["starts"].sum()
    if last4_starts < 3:
        continue
    group = group.sort_values("gw_from_fixture")
    last4_avg = group.tail(4)["total_points"].mean()
    season_avg = group["total_points"].mean()
    trajectory = round(last4_avg - season_avg, 2)
    trajectory_results.append({
        "element": element,
        "form_trajectory": trajectory,
        "form_direction": "Rising" if trajectory > 0.5 else "Falling" if trajectory < -0.5 else "Stable"
    })

trajectory_df = pd.DataFrame(trajectory_results)
player_metrics = player_metrics.merge(trajectory_df, on="element", how="left")

# ── Save ──────────────────────────────────────────────────────────────────────
# ── VALIDATION GATES ──────────────────────────────────────────────────────────
LEGACY_COLS = ["element", "web_name", "team", "position", "benchmark_ppg", "beta_season",
               "sharpe_4gw", "sortino_4gw", "info_ratio_4gw", "consistency_4gw",
               "consistency_season", "xg_share_4gw", "xa_share_4gw", "xg_share_season",
               "form_trajectory", "form_direction"]
_missing = [c for c in LEGACY_COLS if c not in player_metrics.columns]
if _missing:
    raise RuntimeError(f"GATE FAIL: advanced_metrics.csv lost legacy columns {_missing}")
for c in ["npxg_share_4gw", "xg_delta_4gw", "xg_delta_season"]:
    if c not in player_metrics.columns:
        raise RuntimeError(f"GATE FAIL: expected new column {c} missing")
    if player_metrics[c].notna().sum() == 0:
        raise RuntimeError(f"GATE FAIL: {c} is all-NaN — enrichment join broken?")
print(f"  Gates passed. npxg_share_4gw NaN share: {player_metrics['npxg_share_4gw'].isna().mean():.3f}")

output_path = os.path.join(OUTPUT_DIR, "advanced_metrics.csv")
player_metrics.to_csv(output_path, index=False)
print(f"\n  advanced_metrics.csv written ({len(player_metrics)} rows, {len(player_metrics.columns)} columns)")

# ── Validation snapshot ───────────────────────────────────────────────────────
print("\n── VALIDATION SNAPSHOT ──────────────────────────────────────")

for pos in ["GKP", "DEF", "MID", "FWD"]:
    print(f"\n{pos} — Top 5 by Sharpe (4GW):")
    subset = player_metrics[player_metrics["position"] == pos].sort_values(
        "sharpe_4gw", ascending=False).head(5)
    for _, r in subset.iterrows():
        print(f"  {r['web_name']:<20} Sharpe: {r['sharpe_4gw']:.2f} | Alpha: {r['alpha_4gw']:.2f} | Consistency: {r['consistency_4gw']:.2f} | Trajectory: {r['form_direction']}")

print("\n── TOP 10 xG SHARE (4GW) — MID/FWD ─────────────────────────")
top_xg = player_metrics[player_metrics["position"].isin(["MID", "FWD"])].sort_values(
    "xg_share_4gw", ascending=False).head(10)
for _, r in top_xg.iterrows():
    print(f"  {r['web_name']:<20} {r['team']:<5} xG share: {r['xg_share_4gw']:.1%}")

print("\n── TOP 10 xA SHARE (4GW) — MID/FWD ─────────────────────────")
top_xa = player_metrics[player_metrics["position"].isin(["MID", "FWD"])].sort_values(
    "xa_share_4gw", ascending=False).head(10)
for _, r in top_xa.iterrows():
    print(f"  {r['web_name']:<20} {r['team']:<5} xA share: {r['xa_share_4gw']:.1%}")

print("\nDone!")