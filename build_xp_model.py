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
# THE CODE MAP MUST NOT BE RATING-GATED. This read fpl_analyser_ratings.csv,
# which only holds players who cleared the 900-minute/10-start RATING floor —
# 342 of the 841 elements in the gameweek file. Everyone else merged to a null
# code and was dropped by the emitter below, so 499 players with real Premier
# League records were discarded for failing a bar that has nothing to do with
# whether they can be projected. Isak was one of them: 694 minutes and 8
# starts, absent from the model entirely.
#
# season_summary.csv carries the same map ungated. Checked before switching,
# rather than assumed: it covers all 841 elements, web_name agrees on 841 of
# 841, and the code agrees on all 342 rows where both files have one.
codes = pd.read_csv(os.path.join(ROOT, "season_summary.csv"), usecols=["id", "code"])
gw = gw.merge(codes.drop_duplicates("id").rename(columns={"id": "element"}), on="element", how="left")

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
    code=("code", "first"), pos=("position", "first"), club=("team", "last"),
    mins=("minutes", "sum"), games=("round", "nunique"),
    # His price at his FIRST appearance, so it is the pre-season valuation and
    # not one marked up by the season it is about to be used to predict.
    price=("value", "first"),
    xg=("expected_goals", "sum"), xa=("expected_assists", "sum"),
    saves=("saves", "sum"), bonus=("bonus", "sum"), yellows=("yellow_cards", "sum"))
agg["price"] = agg["price"] / 10.0
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

# REPLACEMENT LEVEL, NOT THE AVERAGE STARTER. The prior a thin record is
# pulled toward was the position mean weighted by minutes, which is dominated
# by the players who play the most — so a squad player with no record was being
# assumed as productive per 90 as an average STARTER. It barely shows while he
# has no minutes to multiply it by, and it shows badly the moment an injury
# hands him a shirt, which is exactly the case this whole change exists to get
# right. The prior is now the rate among the bottom half of the position by
# minutes: what a fringe player actually does, which is what a fringe player
# should be assumed to do.
#
# AND PLACED BY PRICE WITHIN THE POSITION. One replacement rate per position
# says a £9m new signing and a £4.5m squad player are the same footballer,
# which is the difference between a prior and a guess. It matters most for the
# players this file previously had nothing at all for — the 182 in the current
# squad with no Premier League record, whose whole rate IS the prior.
#
# The tilt is fitted, not chosen. log rate on log price, weighted by minutes,
# within position, then the slope pulled toward flat by its own t so a thin
# position cannot run away with it. What comes out is football rather than
# "expensive equals good" — the fit finds MID heavily price-driven, FWD barely,
# and keeper saves NEGATIVE, an expensive keeper being one behind a defence
# that gives him less to do:
#
#   MID  xG   slope +2.24   £5.0m -> £7.0m  x2.13
#   MID  xA   slope +1.32                   x1.56
#   DEF  xA   slope +1.01   £4.0m -> £5.5m  x1.38
#   DEF  xG   slope +0.57                   x1.20
#   FWD  xG   slope +0.39   £5.2m -> £8.1m  x1.19
#   FWD  xA   slope +0.09                   x1.04
#   GKP  sv   slope -0.48   £4.0m -> £5.3m  x0.87
#
# The tilt only redistributes: it is renormalised so the minute-weighted mean
# prior across the fringe group is exactly the fringe rate it was before, so
# this moves who gets what and never the position's total.
M = 600.0
below = agg.groupby("pos")["mins"].transform(lambda x: x <= x.median())
T2 = 4.0   # slope shrinkage: a t of 2 keeps half the fit, a t of 8 keeps 94%


def fit_price_curve(col: str) -> dict:
    """Fit log(rate) on log(price) per position, minute-weighted.

    Returns {pos: (slope, reference price, renormalising scale)} — enough to
    price a player who is not in `agg` at all, which is the whole point.
    """
    curve = {}
    for pos, d in agg.groupby("pos"):
        d = d[(d["mins"] >= 270) & (d["price"] > 0)]
        if len(d) < 20:
            continue
        w = d["mins"].to_numpy(float)
        lp = np.log(d["price"].to_numpy(float))
        x = lp - np.average(lp, weights=w)
        y = np.log(d[col].to_numpy(float) / d["mins"].to_numpy(float) * 90 + 1e-3)
        ybar = np.average(y, weights=w)
        sxx = float(np.sum(w * x * x))
        if sxx <= 1e-9:
            continue
        b = float(np.sum(w * x * (y - ybar)) / sxx)
        resid = y - (ybar + b * x)
        se = np.sqrt(np.sum(w * resid ** 2) / max(np.sum(w), 1.0)
                     / max(sxx / np.sum(w), 1e-9) / max(len(x) - 2, 1))
        t = b / max(se, 1e-9)
        b *= t * t / (t * t + T2)
        ref = float(np.exp(np.average(lp, weights=w)))
        # Renormalise over the FRINGE group, which is what the prior describes,
        # so the tilt moves who gets what and never the position's total.
        f = agg.loc[(agg["pos"] == pos) & below]
        fw = f["mins"].to_numpy(float)
        tilt = np.clip((f["price"].clip(lower=0.1).to_numpy(float) / ref) ** b, 0.25, 4.0)
        scale = float(np.sum(fw)) / max(float(np.sum(fw * tilt)), 1e-9)
        curve[pos] = (b, ref, scale)
    return curve


def priced_prior(col: str, pos, price) -> np.ndarray:
    """The replacement-level rate for these positions, each tilted by price."""
    pos = np.asarray(pos, dtype=object).reshape(-1)
    pr = np.asarray(price, dtype=float).reshape(-1)
    out = np.zeros(len(pos), dtype=float)
    for i, p in enumerate(pos):
        b, ref, scale = CURVES[col].get(p, (0.0, 1.0, 1.0))
        tilt = float(np.clip((max(pr[i], 0.1) / ref) ** b, 0.25, 4.0))
        out[i] = FRINGE[col].get(p, 0.0) * tilt * scale
    return out


RATE_COLS = [("xg", "xg90"), ("npxg", "npxg90"), ("xa", "xa90"), ("saves", "sv90")]
FRINGE = {col: (agg[below].groupby("pos")[col].sum()
                / agg[below].groupby("pos")["mins"].sum() * 90).to_dict()
          for col, _ in RATE_COLS}
CURVES = {col: fit_price_curve(col) for col, _ in RATE_COLS}
print("  price tilt on the replacement prior: " + ", ".join(
    f"{pos} {col} {CURVES[col][pos][0]:+.2f}"
    for col, _ in RATE_COLS for pos in ["GKP", "DEF", "MID", "FWD"]
    if pos in CURVES[col] and abs(CURVES[col][pos][0]) >= 0.2))

for col, name in RATE_COLS:
    prior = priced_prior(col, agg["pos"].to_numpy(), agg["price"].to_numpy())
    agg[name] = (agg[col] / agg["mins"].clip(lower=1) * 90 * agg["mins"] + prior * M) / (agg["mins"] + M)

# A LOWER BAR THAN 270 MINUTES, for two reasons that are both new.
#
# The prior a thin record is shrunk toward is now replacement level placed by
# price, rather than the average starter — so three appearances no longer
# inherit a first-choice player's rate, which is what 270 was protecting
# against. And the frontend now OVERRIDES p60/ppl with the squad-wide minutes
# allocation, so a near-empty minutes history can no longer distort how much of
# a shirt he is given; it only decides how well he uses it.
#
# At 90 minutes, M = 600 means his own record carries 13% of his rate and the
# priced prior carries 87%. That is an estimate rather than a measurement, and
# it is a great deal better than the alternative, which is that he holds a
# shirt in the allocation and returns nothing at all.
MIN_MINS_ROW = 90

players = []
for _, r in agg.iterrows():
    if pd.isna(r["code"]) or r["mins"] < MIN_MINS_ROW:
        continue
    players.append({
        "code": int(r["code"]),
        # WHERE THE START RATE WAS EARNED. p60 says how often he started for
        # whoever he played for; the frontend needs to know whether that was
        # this club, because a pecking order at Burnley says nothing about the
        # one at Spurs. Without it Dubravka's 0.895 outranked the keeper who
        # actually has the shirt.
        "club": str(r["club"]),
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

# ── the squad players with no Premier League record at all ────────────────
#
# 182 of the 587 players in this season's squads have never played a Premier
# League minute: promoted-club players, and signings from abroad. Nothing above
# can produce a row for them, and until now nothing did — so they took a share
# of their club's shirts in the frontend's minutes allocation and returned
# exactly zero points against it. Every team-mate above them in the pecking
# order lost the difference. That is the coverage hole: not that these players
# were rated badly, but that the shirts they hold vanished from the projection.
#
# They get the same replacement-level prior as anyone else with nothing to go
# on, placed within the position by price — which for this group IS the whole
# estimate, and the reason the tilt was fitted rather than assumed. It is a
# genuine understatement for a marquee signing, and it is stated as such on the
# row: `prior: true`, so the frontend can mark the number as an assumption
# rather than a measurement.
#
# What it CANNOT do is invent a minutes history. p60 and ppl are left at the
# fringe group's own rates, and the allocation in lib/minutes overrides them
# from price, ownership and fitness anyway — which is exactly the signal that
# does exist for a player with no record.
with open(os.path.join(SITE, season, "availability.json"), encoding="utf-8") as f:
    _squad = json.load(f).get("players", [])
_have = {p["code"] for p in players}
_fringe_rows = agg[below]
_p60_prior = _fringe_rows.groupby("pos")["p60"].mean().to_dict()
_ppl_prior = _fringe_rows.groupby("pos")["ppl"].mean().to_dict()
_dc_prior = ((_fringe_rows["dc_raw"] * _fringe_rows["dc_n"]).groupby(_fringe_rows["pos"]).sum()
             / _fringe_rows.groupby("pos")["dc_n"].sum().clip(lower=1)).to_dict()
_bon_prior = (_fringe_rows.groupby("pos")["bonus"].sum()
              / _fringe_rows.groupby("pos")["games"].sum().clip(lower=1)).to_dict()
_yel_prior = (_fringe_rows.groupby("pos")["yellows"].sum()
              / _fringe_rows.groupby("pos")["games"].sum().clip(lower=1)).to_dict()
_added = {}
for sp in _squad:
    code, pos = sp.get("code"), sp.get("pos")
    if code is None or code in _have or pos not in FRINGE["xg"]:
        continue
    price = float(sp.get("price") or 4.5)
    tid = sp.get("team")
    players.append({
        "code": int(code),
        "club": str(current[tid - 1]) if isinstance(tid, int) and 0 < tid <= len(current) else "",
        "xg90": round(float(priced_prior("xg", pos, price)[0]), 4),
        "npxg90": round(float(priced_prior("npxg", pos, price)[0]), 4),
        "xa90": round(float(priced_prior("xa", pos, price)[0]), 4),
        "sv90": round(float(priced_prior("saves", pos, price)[0]), 3),
        "dc": round(float(_dc_prior.get(pos, 0.0)), 3),
        "bon": round(float(_bon_prior.get(pos, 0.0)), 3),
        "yel": round(float(_yel_prior.get(pos, 0.0)), 3),
        "p60": round(float(_p60_prior.get(pos, 0.0)), 3),
        "ppl": round(float(_ppl_prior.get(pos, 0.0)), 3),
        "prior": True,
    })
    _have.add(int(code))
    _added[pos] = _added.get(pos, 0) + 1
print("  squad players with no PL record, given a priced replacement prior: "
      + ", ".join(f"{k} {v}" for k, v in sorted(_added.items())) + f" ({sum(_added.values())} total)")

# ── how many shirts a club actually fields, per position ──────────────────
#
# Minutes are a zero-sum allocation: a club plays one keeper, not the 1.90 that
# summing three keepers' individual start rates implies. lib/availability
# normalises against these, so they are measured here rather than assumed — and
# assuming is how the first draft of this got FWD wrong, guessing two when the
# real figure is one: FPL's forward class is narrow and most attackers are MID.
_starts = starters.groupby(["position", "team", "round"]).size()
_used = played.groupby(["position", "team", "round"]).size()
_tg = max(gw.groupby(["team", "round"]).ngroups, 1)
shirts = {pos: {"start": round(float(_starts.get(pos, pd.Series(dtype=float)).sum()) / _tg, 3),
                "used": round(float(_used.get(pos, pd.Series(dtype=float)).sum()) / _tg, 3)}
          for pos in ["GKP", "DEF", "MID", "FWD"]}
print("  shirts per team-game: " + ", ".join(f"{k} {v['start']}" for k, v in shirts.items()))

# ── how concentrated a pecking order really is ────────────────────────────
#
# The allocation blends history with price and ownership, and a blend of two
# disagreeing sources comes out flatter than either. Measured against last
# season, that is harmless for the crowded positions and wrong for the sparse
# one: a club's first-choice keeper takes 85% of its keeper starts and the
# allocation was giving him 65%, so Alisson came out at half a shirt.
#
#   position   real top man's share   allocation gave him
#   GKP               0.85                   0.65
#   DEF               0.23                   0.22
#   MID               0.20                   0.19
#   FWD               0.68                   0.63
#
# Emitted as a target rather than a fix: lib/minutes solves one sharpening
# exponent per position so the LEAGUE-WIDE mean matches this. League-wide, not
# per club — forcing every club's top keeper to 0.85 would flatten out the real
# three-way at Spurs, which is a genuine uncertainty and not an artefact.
# Where the allocation is already right the solve returns 1 and changes
# nothing, which is why DEF and MID need no special case.
_ss = starters.groupby(["position", "team", "element"]).size().rename("n").reset_index()
conc = {}
for pos in ["GKP", "DEF", "MID", "FWD"]:
    tops = []
    for _, d in _ss[_ss["position"] == pos].groupby("team"):
        tot = float(d["n"].sum())
        if tot < 10:
            continue
        tops.append(float(d["n"].max()) / tot)
    if tops:
        conc[pos] = round(float(np.mean(tops)), 3)
print("  top man's real share of a club-position's starts: "
      + ", ".join(f"{k} {v}" for k, v in conc.items()))

# ── what an appearance is actually worth, in minutes ──────────────────────
#
# The engine multiplies a PER-90 rate by a count of APPEARANCES, which credits
# every 60-plus outing as a full ninety. It is not: a midfielder who reaches 60
# averages 83 minutes and a forward 81, so their goals and assists were being
# paid 8-10% over. A cameo is worse — the engine values it at half a game and
# the real figure is a quarter, 22 minutes.
#
#   position   mean minutes when 60+ reached   mean cameo
#   GKP                 89.9                      22.2
#   DEF                 87.5
#   MID                 83.2
#   FWD                 81.1
#
# Emitted per position so lib/xp can convert appearances into minutes. Only the
# rate-per-90 sources need it — appearance points and clean sheets are
# threshold questions and stay counted in appearances.
_st = played[played["minutes"] >= 60]
_cam = played[(played["minutes"] > 0) & (played["minutes"] < 60)]
mins_per = {pos: {"start": round(float(_st[_st["position"] == pos]["minutes"].mean() or 90), 1),
                  "cameo": round(float(_cam[_cam["position"] == pos]["minutes"].mean() or 20), 1)}
            for pos in ["GKP", "DEF", "MID", "FWD"]}
print("  minutes per appearance: " + ", ".join(f"{k} {v['start']}/{v['cameo']}" for k, v in mins_per.items()))

payload = {
    "mins": mins_per,
    "shirts": shirts,
    "conc": conc,
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
