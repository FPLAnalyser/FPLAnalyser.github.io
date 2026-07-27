#!/usr/bin/env python3
"""How a defence concedes, and how an attacker scores.

Two shot maps already ship — every shot each club conceded, every shot each
player took — but only as raw event lists far too big to load in the app.
This boils both down to the axis that actually changes a captaincy call.

The obvious idea was central versus wide.  Measured, it goes nowhere: every
Premier League defence concedes between 78% and 85% of its expected goals
from the central area of the box, because that is simply where chances are
worth anything.  A 7-point spread can't move a decision.

What *does* separate defences is where those chances come from in play:

    set-piece share of xG conceded    16.2% (BRE)  ->  31.3% (BOU)

Nearly a two-fold spread, and it matters enormously to the right player.
Van Dijk takes 81% of his shot value from dead balls; Thiago takes 6%.  The
same fixture is a completely different proposition to each of them.

So each side is reduced to its shot mix, and the two are matched:

    multiplier = player_setpiece_share x (defence_sp / league_sp)
               + player_openplay_share x (defence_op / league_op)

which is exactly "reweight this player's usual shot mix by how this defence
differs from average".  A player with a league-average mix comes out at
precisely 1.0, so the adjustment can only ever come from a genuine
mismatch, never from noise in the baseline.

Also carried: chance quality (xG per shot) on both sides — a weaker signal
(1.31x spread across defences) kept as context rather than as a multiplier.

Writes site_data/<season>/shot_profiles.json — a few hundred small rows in
place of the 2.7MB of events behind them.
"""
import json
import os
from pathlib import Path

DATA = Path(os.environ.get("FPL_SITE_DIR", "site_data"))

SET_PIECE = {"SetPiece", "FromCorner", "DirectFreekick"}

# Below this many shots a share is noise, so a profile is blended back
# towards the league average in proportion to how thin the sample is.
MIN_SHOTS_TEAM = 120
MIN_SHOTS_PLAYER = 30


def season_dir() -> Path:
    seasons = json.loads((DATA / "seasons.json").read_text())
    return DATA / seasons["seasons"][0]["id"]


def raw_profile(shots: list) -> dict | None:
    """Expected goals split by how the chance arrived, plus chance quality."""
    sp = op = 0.0
    n = 0
    for s in shots:
        xg = s.get("xg")
        if xg is None:
            continue
        n += 1
        if s.get("situation") in SET_PIECE:
            sp += float(xg)
        else:
            op += float(xg)
    total = sp + op
    if not total or n < 5:
        return None
    return {"sp": sp / total, "n": n, "xg": total, "q": total / n}


def league_mean(profiles: list) -> dict:
    """xG-weighted, so a club that faced more shots counts for more."""
    sp = sum(p["sp"] * p["xg"] for p in profiles)
    xg = sum(p["xg"] for p in profiles)
    n = sum(p["n"] for p in profiles)
    return {"sp": sp / xg, "q": xg / n}


def shrink(p: dict, lg: dict, floor: int) -> dict:
    """Pull a thin sample towards the league average — a defender with nine
    shots shouldn't read as an 89% set-piece specialist."""
    w = min(1.0, p["n"] / floor)
    return {
        "sp": round(w * p["sp"] + (1 - w) * lg["sp"], 4),
        "q": round(w * p["q"] + (1 - w) * lg["q"], 4),
        "n": p["n"],
    }


def main() -> None:
    d = season_dir()
    conceded = json.loads((d / "shots_conceded.json").read_text())
    player_shots = json.loads((d / "player_shots.json").read_text())

    raw_t = {t: p for t, p in ((t, raw_profile(s)) for t, s in conceded.items()) if p}
    lg_t = league_mean(list(raw_t.values()))
    teams = {t: shrink(p, lg_t, MIN_SHOTS_TEAM) for t, p in raw_t.items()}

    raw_p = {e: p for e, p in ((e, raw_profile(s)) for e, s in player_shots.items()) if p}
    lg_p = league_mean(list(raw_p.values()))
    players = {int(e): shrink(p, lg_p, MIN_SHOTS_PLAYER) for e, p in raw_p.items()}

    out = {
        "league": {"conceded": {"sp": round(lg_t["sp"], 4), "q": round(lg_t["q"], 4)},
                   "taken": {"sp": round(lg_p["sp"], 4), "q": round(lg_p["q"], 4)}},
        "teams": teams,
        "players": players,
    }
    path = d / "shot_profiles.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path}  ({len(teams)} clubs, {len(players)} players, {path.stat().st_size // 1024}KB)")

    print(f"league: {lg_t['sp']:.1%} of xG conceded from dead balls, {lg_t['q']:.3f} xG per shot")
    order = sorted(teams.items(), key=lambda kv: -kv[1]["sp"])
    print("weakest at set pieces:", ", ".join(f"{t} {p['sp']:.0%}" for t, p in order[:4]))
    print("strongest at set pieces:", ", ".join(f"{t} {p['sp']:.0%}" for t, p in order[-4:]))

    # A worked example of the swing the multiplier can produce.
    best, worst = order[0], order[-1]
    for sp in (0.80, 0.13):
        def mult(team):
            return sp * (team["sp"] / lg_t["sp"]) + (1 - sp) * ((1 - team["sp"]) / (1 - lg_t["sp"]))
        print(f"  a player {sp:.0%} reliant on set pieces: "
              f"x{mult(best[1]):.2f} vs {best[0]}, x{mult(worst[1]):.2f} vs {worst[0]}")


if __name__ == "__main__":
    main()
