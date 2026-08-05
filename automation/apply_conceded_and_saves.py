#!/usr/bin/env python3
"""Back-fill the goals-conceded deduction and floored save points into an
already-published ratings.json.

WHY THIS EXISTS, AND WHEN TO DELETE IT
    fpl_analyser_rating.py is the source of truth and now models both. But it
    needs the enriched gameweek data, which lives outside the repo, so a full
    pipeline run is the only way to regenerate ratings natively — and the next
    one is not scheduled until after GW1. This applies the identical
    correction to the published files so the site is not serving inflated
    keepers and defenders in the meantime.

    Once a full pipeline run has happened, this script is dead weight: the
    numbers it produces are the numbers the pipeline produces. Delete it.

WHAT IT CHANGES
    - adds  {prefix}_xpts_conceded   (negative, GKP and DEF only)
    - fixes {prefix}_xpts_save       floored per three, not a linear third
    - rebuilds per-game and adjusted xPts, the overall and attacker scores and
      their star ratings, and the save dimension score

SAFETY
    Run with --verify to apply NO correction and rewrite nothing: it just
    recomputes every derived figure from the published components and reports
    the largest disagreement with what is already in the file. If that check
    does not come back at essentially zero, the recomputation does not match
    the pipeline and the corrected numbers cannot be trusted either.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

AVAIL_EXP = 0.75
PREFIXES = ("season", "gw4")


def exp_floor_div(lam, div):
    """E[floor(K / div)] for K ~ Poisson(lam). Mirrors the pipeline helper."""
    if lam is None or lam <= 0:
        return 0.0
    base = math.exp(-lam)
    return sum(base * lam ** k / math.factorial(k) * (k // div) for k in range(div, 25))


def score_to_stars(score):
    if score is None:
        return "N/A"
    for cut, stars in ((4.75, "⭐⭐⭐⭐⭐"), (4.25, "⭐⭐⭐⭐½"), (3.75, "⭐⭐⭐⭐"),
                       (3.25, "⭐⭐⭐½"), (2.75, "⭐⭐⭐"), (2.25, "⭐⭐½"),
                       (1.75, "⭐⭐"), (1.25, "⭐½")):
        if score >= cut:
            return stars
    return "⭐"


def zscale(values):
    """(50 + 15z) clipped to 1–99, on the app's 1–5 contract. As the pipeline."""
    n = len(values)
    mean = sum(values) / n
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / n)
    if n < 2 or sd == 0:
        return None
    return lambda v: min(99.0, max(1.0, 50 + 15 * (v - mean) / sd)) / 20.0


def stdscore(values):
    """Same standard score, left on the 0–100 scale the dimensions use."""
    z = zscale(values)
    return None if z is None else (lambda v: z(v) * 20.0)


def rebuild(rows, correct):
    """Recompute every derived figure. With correct=False this must reproduce
    what is already published — that equivalence is the whole safety net."""
    for pre in PREFIXES:
        for r in rows:
            comps = [r.get(f"{pre}_xpts_{k}") for k in
                     ("goal", "assist", "cs", "dc", "save", "bonus")]
            if r.get(f"{pre}_xpts_per_game") is None or any(c is None for c in comps):
                continue
            goal, assist, cs, dc, save, bonus = comps
            pos = r.get("position")
            if correct:
                xgc = r.get(f"{pre}_m_xgc")
                saves = r.get(f"{pre}_m_saves")
                conceded = -exp_floor_div(xgc, 2) if pos in ("GKP", "DEF") and xgc else 0.0
                save = exp_floor_div(saves, 3) if pos == "GKP" and saves else 0.0
                r[f"{pre}_xpts_conceded"] = round(conceded, 3)
                r[f"{pre}_xpts_save"] = round(save, 3)
            else:
                conceded = 0.0
            xpg = goal + assist + cs + dc + save + bonus + 2.0
            sr = r.get(f"{pre}_start_rate")
            avail = min(1.0, max(0.0, sr)) ** AVAIL_EXP if sr is not None else None
            r[f"{pre}_xpts_per_game"] = round(xpg + conceded, 3)
            if avail is not None:
                r[f"{pre}_xpts_adjusted"] = round((xpg + conceded) * avail, 3)

        # Overall: standard score of adjusted xPts across everyone who already
        # carries one — that published set IS the pipeline's eligible pool.
        pool = [r for r in rows if r.get(f"{pre}_overall_score") is not None
                and r.get(f"{pre}_xpts_adjusted") is not None]
        f = zscale([r[f"{pre}_xpts_adjusted"] for r in pool])
        if f:
            for r in pool:
                r[f"{pre}_overall_score"] = round(f(r[f"{pre}_xpts_adjusted"]), 3)
                r[f"{pre}_overall_rating"] = score_to_stars(r[f"{pre}_overall_score"])
        apool = [r for r in pool if r.get("position") in ("MID", "FWD")
                 and r.get(f"{pre}_att_overall_score") is not None]
        fa = zscale([r[f"{pre}_xpts_adjusted"] for r in apool])
        if fa:
            for r in apool:
                r[f"{pre}_att_overall_score"] = round(fa(r[f"{pre}_xpts_adjusted"]), 3)
                r[f"{pre}_att_overall_rating"] = score_to_stars(r[f"{pre}_att_overall_score"])

        # Only the save dimension moves: it is the one built from a component
        # this change touches. Clean sheets, goals, assists and DC are untouched.
        spool = [r for r in rows if r.get("position") == "GKP"
                 and r.get(f"{pre}_save_score") is not None
                 and r.get(f"{pre}_xpts_save") is not None
                 and r.get(f"{pre}_start_rate") is not None]
        vals = [r[f"{pre}_xpts_save"] * (min(1.0, max(0.0, r[f"{pre}_start_rate"])) ** AVAIL_EXP)
                for r in spool]
        fs = stdscore(vals)
        if fs:
            for r, v in zip(spool, vals):
                r[f"{pre}_save_score"] = round(fs(v), 1)
                r[f"{pre}_save_score_norm"] = round(fs(v) / 20.0, 3)
                r[f"{pre}_save_score_rating"] = score_to_stars(fs(v) / 20.0)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--verify", action="store_true",
                    help="recompute with no correction and report the largest drift")
    ap.add_argument("--carry-from", metavar="RATINGS",
                    help="copy corrected ratings onto a later season by player code, "
                         "exactly as bootstrap_new_season.py carries them. Use this "
                         "rather than correcting a carried season in place: its scores "
                         "are the PREVIOUS season's standard scores, so recomputing "
                         "them over the new population would change what they mean.")
    args = ap.parse_args()

    if args.carry_from:
        # Mirrors bootstrap_new_season.py: everything except the fields that are
        # always taken fresh from the new season.
        CONTEXT = {"element", "web_name", "team", "position", "price", "code",
                   "selected_by_percent"}
        prev = {r["code"]: r for r in json.load(open(args.carry_from))
                if r.get("code") is not None}
        for path in args.files:
            rows = json.load(open(path))
            n = 0
            for r in rows:
                src = prev.get(r.get("code"))
                if not src or not r.get("ratings_carried"):
                    continue
                for k, v in src.items():
                    if k not in CONTEXT:
                        r[k] = v
                n += 1
            json.dump(rows, open(path, "w"), separators=(",", ":"))
            print(f"{path} — re-carried {n} of {len(rows)} players from {args.carry_from}")
        return

    for path in args.files:
        original = json.load(open(path))
        rows = json.loads(json.dumps(original))
        rebuild(rows, correct=not args.verify)

        if args.verify:
            worst = {}
            for a, b in zip(original, rows):
                for k, v in b.items():
                    if isinstance(v, (int, float)) and isinstance(a.get(k), (int, float)):
                        d = abs(v - a[k])
                        if d > worst.get(k, (0,))[0]:
                            worst[k] = (d, a.get("web_name"))
            top = sorted(worst.items(), key=lambda kv: -kv[1][0])[:6]
            print(f"{path} — recomputed with no correction, largest drift per field:")
            for k, (d, who) in top:
                print(f"    {k:34} {d:.4f}  ({who})")
            if not top or top[0][1][0] < 0.002:
                print("    reproduces the published numbers — the rebuild matches the pipeline")
            continue

        json.dump(rows, open(path, "w"), separators=(",", ":"))
        gk = [r for r in rows if r.get("position") == "GKP" and r.get("season_overall_score")]
        de = [r for r in rows if r.get("position") == "DEF" and r.get("season_overall_score")]
        print(f"{path} — {len(rows)} players; mean overall score now "
              f"GKP {sum(r['season_overall_score'] for r in gk)/len(gk)*20:.1f}, "
              f"DEF {sum(r['season_overall_score'] for r in de)/len(de)*20:.1f}")


if __name__ == "__main__":
    main()
