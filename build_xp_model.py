#!/usr/bin/env python3
"""build_xp_model.py — per-player and per-team baselines for the component
xP engine, from last season's per-gameweek data.

The frontend combines these with (a) the daily market lambdas in odds.json
where bookmakers have priced a fixture, and (b) opponent/venue scaling from
fixture_ease beyond the market horizon, then multiplies by the live
availability factor. This file is the season-start artifact: player per-90
rates shrunk toward position means, minutes profile, def-con hit rates with
their fixture curve, team attack/defence strengths, and the venue effect —
all measured, none guessed.

Run from the repo root with the season CSVs present. Writes
site_data/<newest season>/xp_model.json.
"""
import json
import os

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site_data")

with open(os.path.join(SITE, "seasons.json"), encoding="utf-8") as f:
    season = json.load(f)["seasons"][0]["id"]

gw = pd.read_csv(os.path.join(ROOT, "player_gw_enriched.csv"))
codes = pd.read_csv(os.path.join(ROOT, "fpl_analyser_ratings.csv"), usecols=["element", "code"])
gw = gw.merge(codes.drop_duplicates("element"), on="element", how="left")

played = gw[gw["minutes"] > 0]
starters = gw[gw["minutes"] >= 60]

# ── teams: attack (xG/game) and defence (xGC/game), full season ─────────────
team_games = gw.groupby("team")["round"].nunique()
att = (played.groupby("team")["expected_goals"].sum() / team_games).to_dict()
gk = starters[starters["position"] == "GKP"]
dfc = gk.groupby("team")["expected_goals_conceded"].mean().to_dict()

with open(os.path.join(SITE, season, "teams.json"), encoding="utf-8") as f:
    tj = json.load(f)
current = [t["short_name"] for t in (tj["rows"] if isinstance(tj, dict) and "rows" in tj else tj)]

# Promoted clubs have no PL record: give them the mean of last season's three
# weakest attacks / leakiest defences — a modest prior the market will
# overrule for every fixture it prices.
weak_att = float(np.mean(sorted(att.values())[:3]))
weak_def = float(np.mean(sorted(dfc.values())[-3:]))
teams = {}
for short in current:
    teams[short] = {
        "att": round(att.get(short, weak_att), 3),
        "def": round(dfc.get(short, weak_def), 3),
    }

h_att = float(np.sqrt(
    played[played["was_home"]]["expected_goals"].sum()
    / max(played[~played["was_home"]]["expected_goals"].sum(), 1e-9)))
league = {
    "att": round(float(np.mean(list(att.values()))), 3),
    "def": round(float(np.mean(list(dfc.values()))), 3),
    "hAtt": round(h_att, 4),
}

# ── def-con fixture curve (within-player, measured last season) ─────────────
DC_THR = {"DEF": 10, "MID": 12, "FWD": 12}
DC_CURVE = {
    "DEF": {1: 0.55, 2: 0.80, 3: 1.08, 4: 1.08, 5: 0.92},
    "MID": {1: 0.83, 2: 0.88, 3: 1.03, 4: 0.99, 5: 1.15},
    "FWD": {1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0, 5: 1.0},
}

# ── players: per-90 rates shrunk to position means (M = 600 minutes) ────────
agg = played.groupby("element").agg(
    code=("code", "first"), pos=("position", "first"),
    mins=("minutes", "sum"), games=("round", "nunique"),
    xg=("expected_goals", "sum"), xa=("expected_assists", "sum"),
    saves=("saves", "sum"), bonus=("bonus", "sum"), yellows=("yellow_cards", "sum"))
st = starters.copy()
st["dc_hit"] = (st["defensive_contribution"] >= st["position"].map(DC_THR).fillna(99)).astype(int)
agg = agg.join(st.groupby("element")["dc_hit"].mean().rename("dc")).fillna({"dc": 0})
n_gws = gw["round"].nunique()
agg["p60"] = starters.groupby("element")["round"].nunique().reindex(agg.index).fillna(0) / n_gws
agg["ppl"] = played.groupby("element")["round"].nunique().reindex(agg.index).fillna(0) / n_gws

M = 600.0
for col, name in [("xg", "xg90"), ("xa", "xa90"), ("saves", "sv90")]:
    pos_rate = agg.groupby("pos")[col].sum() / agg.groupby("pos")["mins"].sum() * 90
    prior = agg["pos"].map(pos_rate)
    agg[name] = (agg[col] / agg["mins"].clip(lower=1) * 90 * agg["mins"] + prior * M) / (agg["mins"] + M)

players = []
for _, r in agg.iterrows():
    if pd.isna(r["code"]) or r["mins"] < 270:   # too little record to project
        continue
    players.append({
        "code": int(r["code"]),
        "xg90": round(float(r["xg90"]), 4), "xa90": round(float(r["xa90"]), 4),
        "sv90": round(float(r["sv90"]), 3), "dc": round(float(r["dc"]), 3),
        "bon": round(float(r["bonus"] / max(r["games"], 1)), 3),
        "yel": round(float(r["yellows"] / max(r["games"], 1)), 3),
        "p60": round(float(r["p60"]), 3), "ppl": round(float(r["ppl"]), 3),
    })

payload = {
    "league": league,
    "teams": teams,
    "dcCurve": {p: {str(k): v for k, v in c.items()} for p, c in DC_CURVE.items()},
    "players": players,
}
out = os.path.join(SITE, season, "xp_model.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
print(f"{out}: {len(players)} players, {len(teams)} teams "
      f"(promoted prior att {weak_att:.2f} / def {weak_def:.2f}), home-attack x{h_att:.3f}")
