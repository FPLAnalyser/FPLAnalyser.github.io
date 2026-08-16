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

from dc_rules import DC_THR, dc_hit  # noqa: F401  (DC_THR re-exported for clarity)

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

# Promoted clubs have no PL record: seed them with the mean of last season's
# three weakest attacks / leakiest defences and FLAG it as a prior, so the
# market layer can replace the guess with strengths implied by real odds.
weak_att = float(np.mean(sorted(att.values())[:3]))
weak_def = float(np.mean(sorted(dfc.values())[-3:]))
teams = {}
for short in current:
    known = short in att and short in dfc
    teams[short] = {
        "att": round(att.get(short, weak_att), 3),
        "def": round(dfc.get(short, weak_def), 3),
    }
    if not known:
        teams[short]["prior"] = True

h_att = float(np.sqrt(
    played[played["was_home"]]["expected_goals"].sum()
    / max(played[~played["was_home"]]["expected_goals"].sum(), 1e-9)))
league = {
    "att": round(float(np.mean(list(att.values()))), 3),
    "def": round(float(np.mean(list(dfc.values()))), 3),
    "hAtt": round(h_att, 4),
}

# ── def-con fixture curve (within-player, REFIT every run) ──────────────────
# This used to be five hand-written numbers per position with a comment saying
# they had been measured. They had — once — and nothing recomputed them, so the
# curve would have carried one season's relationship forward for ever with no
# way of noticing it had gone stale. It is fitted from the data below.
#
# What it is indexed on matters as much as the refit. The old version keyed on
# FPL's own 1–5 fixture difficulty, which (a) is an editorial number, and (b)
# does not exist for a historical fixture in any file we hold — so a refit
# against it was not even possible. It now keys on the attacking pressure the
# player's team is expected to face:
#
#     press = (opponent attack / league attack) x venue
#
# which is exactly the quantity componentXp() already computes for save volume.
# One notion of "how much defending there will be", computed the same way at
# fit time and at lookup time, and continuous rather than editorial.
# The shape is ONE parameter, not five, and that is a measured decision rather
# than a simplification. Scoring flat / one-slope / five-bucket against each
# other out of sample (fit on odd gameweeks, score on even, and back), on the
# season this is built from:
#
#     DEF   flat 0.4782   slope 0.4762   5-bucket 0.4795     slope wins
#     MID   flat 0.3642   slope 0.3644   5-bucket 0.3642     flat wins
#     FWD   flat 0.0385   slope 0.0394   5-bucket 0.0388     flat wins
#
# Five buckets are WORSE than assuming no effect at all for defenders — they
# fit the noise between quintiles. And the fixture effect on a midfielder's
# def-con is nil: the old hand-written MID curve ran 0.83 to 1.15 across the
# difficulty range, and none of that swing survives contact with a holdout.
# So the fit below keeps a slope only where it earns one.
DC_MIN_STARTS = 8       # a player needs this many starts to inform the shape
DC_BETA_GRID = np.arange(-1.5, 1.51, 0.02)


def fit_dc_curve(starts, h_att):
    """Within-player def-con response to attacking pressure faced.

    Observed hits over expected hits, where a player's expectation is his own
    season hit rate applied to every start. That normalisation is the whole
    point: good defensive midfielders cluster at clubs with particular fixture
    profiles, so comparing raw hit rates across pressure bands would measure
    the players, not the pressure.

    The opponent's attack is keyed on `opponent_team`, the FPL id, rather than
    a club name — the enriched file carries only the id, and those ids are
    assigned afresh each season, so any id→name map would be a silent trap the
    first summer a club is promoted. An id needs no name here: the attacking
    strength of club N is the expected goals its opponents were made to
    concede, averaged over its season, which the same file already holds."""
    df = starts.copy()
    opp_att = df.groupby("opponent_team")["expected_goals_conceded"].mean()
    venue = np.where(df["was_home"], 1.0 / h_att, h_att)
    df["press"] = (df["opponent_team"].map(opp_att) / opp_att.mean()) * venue
    df = df[df["press"].notna()]

    def deviance(frame, beta):
        p = np.clip(frame["base"] * np.exp(beta * np.log(frame["press"])), 1e-6, 1 - 1e-6)
        y = frame["dc_hit"]
        return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())

    out = {}
    for pos in ("DEF", "MID", "FWD"):
        sub = df[df["position"] == pos].copy()
        rate = sub.groupby("element")["dc_hit"].agg(["mean", "count"])
        keep = rate[rate["count"] >= DC_MIN_STARTS]
        sub = sub[sub["element"].isin(keep.index)]
        if len(sub) < 300:
            out[pos] = 0.0
            continue
        sub["base"] = sub["element"].map(keep["mean"]).clip(1e-4, 1 - 1e-4)

        # Keep a slope only if it beats "no fixture effect" on data it was not
        # fitted to. Odd gameweeks train, even score, then swap — so a spurious
        # slope has to survive being wrong about half the season.
        halves = [(sub[sub["round"] % 2 == 1], sub[sub["round"] % 2 == 0])]
        halves.append((halves[0][1], halves[0][0]))
        gain, betas = 0.0, []
        for tr, te in halves:
            if len(tr) < 150 or len(te) < 150:
                continue
            b = float(min(DC_BETA_GRID, key=lambda z: deviance(tr, z)))
            betas.append(b)
            gain += deviance(te, 0.0) - deviance(te, b)
        out[pos] = round(float(np.mean(betas)), 3) if betas and gain > 0 else 0.0
    return out

# ── penalties, separated ───────────────────────────────────────────────────
#
# expected_goals INCLUDES penalties, so xg90 has always carried whatever
# penalties a player happened to take last season, permanently, at his old
# club and his old role. That is wrong in both directions: a player who has
# just been handed the job gets no credit for it, and one who has lost it
# keeps the credit forever. Measured on this data, Palmer's xg90 of 0.408 sits
# against a non-penalty rate of 0.262 — over a third of his projected goal
# threat was a job he may or may not still have.
#
# So the rate is split here and recombined in lib/xp, where the CURRENT taker
# is known: npxg90 is what he does from open play and set pieces, and the
# penalty share is added back only for whoever actually takes them now.
#
# The count comes from player_shots.json — the same Understat shot data the
# site already publishes, keyed by element, with `situation` marking each
# penalty — rather than a second source that would have to be kept in step.
# Each is valued at the league mean penalty xG measured off that same file,
# so the split is internally consistent even though the totals come from FPL.
with open(os.path.join(SITE, season, "player_shots.json"), encoding="utf-8") as f:
    _shots = json.load(f)
_pen_xgs = [s["xg"] for v in _shots.values() for s in (v or []) if s.get("situation") == "Penalty"]
PEN_XG = round(sum(_pen_xgs) / len(_pen_xgs), 3) if _pen_xgs else 0.76
# KEYED BY CODE, NOT ELEMENT. player_shots.json is keyed by THIS season's
# element ids; player_gw_enriched.csv carries LAST season's, because that is
# the season it describes. Element ids are reassigned every summer, so joining
# the two directly subtracts one player's penalties from whoever inherited his
# number — which is what the first version of this did, silently, leaving
# Haaland's four spot kicks in his rate and taking them off a stranger. Code is
# the only id stable across seasons.
with open(os.path.join(SITE, season, "ratings.json"), encoding="utf-8") as f:
    _cur = json.load(f)
_code_of = {int(r["element"]): int(r["code"]) for r in _cur
            if r.get("element") is not None and r.get("code") is not None}
pen_taken: dict[int, int] = {}
for k, v in _shots.items():
    if not str(k).lstrip("-").isdigit():
        continue
    c = _code_of.get(int(k))
    if c is None:
        continue
    n = sum(1 for s in (v or []) if s.get("situation") == "Penalty")
    if n:
        pen_taken[c] = pen_taken.get(c, 0) + n
# How often a team gets one, from the TEAM shot file rather than the player
# one: player_shots.json only carries players who cleared the rating floor, so
# counting penalties there misses the ones taken by everyone else and would
# understate the rate a current taker is credited with.
with open(os.path.join(SITE, season, "shots_for.json"), encoding="utf-8") as f:
    _tshots = json.load(f)
_team_games = len({(t, s.get("kickoff_date")) for t, v in _tshots.items() for s in (v or [])})
_team_pens = sum(1 for v in _tshots.values() for s in (v or []) if s.get("situation") == "Penalty")
PEN_PER_GAME = round(_team_pens / max(_team_games, 1), 4)
print(f"  penalties: {sum(pen_taken.values())} split out across {len(pen_taken)} players,"
      f" mean {PEN_XG} xG each; {_team_pens} league-wide = {PEN_PER_GAME}/team-game")

# ── players: per-90 rates shrunk to position means (M = 600 minutes) ────────
agg = played.groupby("element").agg(
    code=("code", "first"), pos=("position", "first"),
    mins=("minutes", "sum"), games=("round", "nunique"),
    xg=("expected_goals", "sum"), xa=("expected_assists", "sum"),
    saves=("saves", "sum"), bonus=("bonus", "sum"), yellows=("yellow_cards", "sum"))
st = starters.copy()
st["dc_hit"] = dc_hit(st).astype(int)
dc_beta = fit_dc_curve(st, h_att)
print("  def-con fixture slope refit (0 = no effect that survives a holdout): "
      + ", ".join(f"{k} {v:+.3f}" for k, v in dc_beta.items()))
dc_by_el = st.groupby("element")["dc_hit"].agg(["mean", "count"])
agg = agg.join(dc_by_el["mean"].rename("dc_raw")).join(dc_by_el["count"].rename("dc_n"))
agg["dc_raw"] = agg["dc_raw"].fillna(0.0)
agg["dc_n"] = agg["dc_n"].fillna(0.0)

# Shrink the def-con rate the way every other rate here is shrunk. It was the
# one raw number in the model, which mattered because it is worth about 0.45
# points an appearance to a defender — enough that a player with four starts
# and a lucky 100% hit rate carried it forward at full weight, and a quiet
# three-game spell read as a permanent zero.
#
# K comes from the data rather than taste: splitting last season in half, a
# defender's hit rate in the first half correlates 0.67 with the second over
# a median fifteen starts, which by the usual n/(n+K) reliability form implies
# K of roughly seven starts. So a full season barely moves, and a handful of
# games is pulled most of the way back to his position's mean.
DC_SHRINK = 7.0
dc_pos_mean = (agg["dc_raw"] * agg["dc_n"]).groupby(agg["pos"]).sum() / agg.groupby("pos")["dc_n"].sum()
dc_prior = agg["pos"].map(dc_pos_mean).fillna(0.0)
agg["dc"] = (agg["dc_raw"] * agg["dc_n"] + dc_prior * DC_SHRINK) / (agg["dc_n"] + DC_SHRINK)
n_gws = gw["round"].nunique()
agg["p60"] = starters.groupby("element")["round"].nunique().reindex(agg.index).fillna(0) / n_gws
agg["ppl"] = played.groupby("element")["round"].nunique().reindex(agg.index).fillna(0) / n_gws

# Penalty xG out of the season total BEFORE shrinking, so the non-penalty rate
# is shrunk against a non-penalty position mean rather than one inflated by
# other people's spot kicks. Clipped at zero: FPL and Understat value a penalty
# a shade differently, and a player whose only xG was a penalty could otherwise
# come out slightly negative.
agg["pen_n"] = agg["code"].map(lambda c: pen_taken.get(int(c), 0) if pd.notna(c) else 0).astype(float)
agg["npxg"] = (agg["xg"] - agg["pen_n"] * PEN_XG).clip(lower=0.0)

M = 600.0
for col, name in [("xg", "xg90"), ("npxg", "npxg90"), ("xa", "xa90"), ("saves", "sv90")]:
    pos_rate = agg.groupby("pos")[col].sum() / agg.groupby("pos")["mins"].sum() * 90
    prior = agg["pos"].map(pos_rate)
    agg[name] = (agg[col] / agg["mins"].clip(lower=1) * 90 * agg["mins"] + prior * M) / (agg["mins"] + M)

players = []
for _, r in agg.iterrows():
    if pd.isna(r["code"]) or r["mins"] < 270:   # too little record to project
        continue
    players.append({
        "code": int(r["code"]),
        "xg90": round(float(r["xg90"]), 4),
        # What he does WITHOUT the armband of penalty duty. lib/xp adds the
        # penalty share back for the current taker; a file without this field
        # falls back to xg90 and behaves exactly as before.
        "npxg90": round(float(r["npxg90"]), 4),
        "xa90": round(float(r["xa90"]), 4),
        "sv90": round(float(r["sv90"]), 3), "dc": round(float(r["dc"]), 3),
        "bon": round(float(r["bonus"] / max(r["games"], 1)), 3),
        "yel": round(float(r["yellows"] / max(r["games"], 1)), 3),
        "p60": round(float(r["p60"]), 3), "ppl": round(float(r["ppl"]), 3),
    })

payload = {
    # What one penalty is worth, and how often a team gets one — measured off
    # the same shot file, so lib/xp does not carry a hardcoded guess.
    "pen": {"xg": PEN_XG, "perGame": PEN_PER_GAME},
    "league": league,
    "teams": teams,
    "dcCurve": {p: {"beta": b} for p, b in dc_beta.items()},
    "players": players,
}
out = os.path.join(SITE, season, "xp_model.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
priors = [t for t, v in teams.items() if v.get("prior")]
print(f"{out}: {len(players)} players, {len(teams)} teams, home-attack x{h_att:.3f}"
      f" | no PL record, on prior att {weak_att:.2f}/def {weak_def:.2f}: {priors or 'none'}")
