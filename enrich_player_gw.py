"""enrich_player_gw.py  (v2 — wired to the real pipeline layout)

Joins Understat + FBref per-match data onto the existing FPL per-GW records
and writes player_gw_enriched.csv. player_gw_history.csv is NEVER modified —
it stays the FPL-only source of truth so every existing script keeps working
untouched. Enhanced persona/rating scripts read the enriched file instead.

File layout (matches the existing pipeline):
  ./player_gw_history.csv        existing FPL per-GW records   (input)
  ./season_summary.csv           player reference               (input)
  ./fixtures_enriched.csv        fixture reference              (input)
  ./data/understat_player_match.csv                             (input)
  ./data/fbref_player_match.csv                                 (input)
  ./player_gw_enriched.csv       enriched output — site-ready   (OUTPUT)
  ./data/join_uncertain.csv      flagged joins to review        (output)
  ./data/join_coverage_report.csv per-GW coverage %             (output)
  ./data/player_id_map_*.csv     persisted name matches         (output)
  ./data/player_overrides.csv    optional manual corrections    (input, you create)

Join keys:
  player:  source_join.PlayerMatcher  -> FPL element id
  fixture: source_join.FixtureMatcher -> FPL fixture id
           (canonical team pair + kickoff date +/- 1 day)

Per-90 uses FPL minutes as the single source of truth. Rolling windows must
be rebuilt in rolling_calculations.py as sum(stat)/sum(minutes)*90 over the
window — never by averaging the per-90 columns.

Usage:  python3 enrich_player_gw.py
        python3 enrich_player_gw.py --include-flagged
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from source_join import (FixtureMatcher, FplPlayer, PlayerMatcher,
                         load_map, load_overrides_csv, save_map)
from source_join.teams import resolve_team

ROOT = Path(".")
DATA = Path("data")

US_STATS = ["us_npxg", "us_xg_chain", "us_xg_buildup", "us_shots", "us_sot",
            "us_shots_six_yard", "us_shots_penalty_area", "us_shots_out_of_box",
            "us_shots_foot", "us_shots_head"]
PL_STATS = ["pl_touches_opp_box", "pl_crosses", "pl_corners_taken",
            "pl_fk_crosses", "pl_fk_shots", "pl_chances_created",
            "pl_big_chances_created"]   # official PL (Opta) per-fixture API
PER90 = ["us_npxg", "us_xg_chain", "us_xg_buildup", "us_shots", "us_sot",
         "pl_touches_opp_box", "pl_crosses", "pl_chances_created"]


def load_fpl_players() -> pd.DataFrame:
    """season_summary.csv -> the columns the matcher needs."""
    ss = pd.read_csv(ROOT / "season_summary.csv")
    df = pd.DataFrame({
        "fpl_id": ss["id"].astype(int),
        "first_name": ss["first_name"].fillna(""),
        "second_name": ss["second_name"].fillna(""),
        "web_name": ss["web_name"].fillna(""),
        "team": ss["team_short"].map(resolve_team),
        "position": ss["position"].fillna(""),
    })
    return df


def load_fpl_fixtures() -> pd.DataFrame:
    """fixtures_enriched.csv -> the columns the fixture matcher needs."""
    fx = pd.read_csv(ROOT / "fixtures_enriched.csv")
    return pd.DataFrame({
        "fixture_id": fx["fixture_id"].astype(int),
        "gameweek": fx["gw"],
        "kickoff_date": fx["kickoff_time"],
        "home": fx["home_team"].map(resolve_team),
        "away": fx["away_team"].map(resolve_team),
    })


def build_player_matcher(fpl_players_df, source):
    players = [FplPlayer(int(r.fpl_id), str(r.first_name), str(r.second_name),
                         str(r.web_name), r.team, str(r.position))
               for r in fpl_players_df.itertuples()]
    overrides = load_map(DATA / f"player_id_map_{source}.csv")   # prior runs
    overrides.update(load_overrides_csv(DATA / "player_overrides.csv"))  # human wins
    return PlayerMatcher(players, overrides)


def resolve_source(df, source, matcher, fixture_matcher):
    """Adds fpl_id / fpl_fixture_id / join metadata to a source dataframe."""
    uniq = df[["source_id", "source_name", "team"]].drop_duplicates()
    results = matcher.match_all(
        source, list(uniq.itertuples(index=False, name=None)))
    save_map(results, DATA / f"player_id_map_{source}.csv")
    pmap = {r.source_id: r for r in results}

    tag = {"understat": "un", "pl": "pl"}[source]
    df = df.copy()
    df["fpl_id"] = df["source_id"].map(
        lambda s: pmap[str(s)].fpl_id if pmap[str(s)].fpl_id else np.nan)
    df[f"join_method_{tag}"] = df["source_id"].map(lambda s: pmap[str(s)].method)
    df[f"join_conf_{tag}"] = df["source_id"].map(lambda s: pmap[str(s)].confidence)
    df[f"join_flag_{tag}"] = df["source_id"].map(lambda s: pmap[str(s)].flagged)

    fx = df.apply(lambda r: fixture_matcher.match(r["home"], r["away"],
                                                  r["kickoff_date"]), axis=1)
    df["fpl_fixture_id"] = [m.fixture_id if m and not m.ambiguous else np.nan
                            for m in fx]
    return df, results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-flagged", action="store_true",
                    help="join flagged/uncertain player matches too")
    args = ap.parse_args()

    for f in ("player_gw_history.csv", "season_summary.csv",
              "fixtures_enriched.csv"):
        if not (ROOT / f).exists():
            sys.exit(f"{f} not found in current folder — run this from the "
                     f"fpl-analyser project root")

    gw = pd.read_csv(ROOT / "player_gw_history.csv")
    fpl_players = load_fpl_players()
    fixtures = load_fpl_fixtures()

    fixture_matcher = FixtureMatcher(
        dict(fixture_id=r.fixture_id, gameweek=r.gameweek,
             kickoff_date=r.kickoff_date, home=r.home, away=r.away)
        for r in fixtures.itertuples())

    all_uncertain = []
    enriched = gw.copy()

    for source, path, stats, id_col, name_col in [
        ("understat", DATA / "understat_player_match.csv", US_STATS,
         "understat_id", "understat_name"),
        ("pl", DATA / "pl_player_match.csv", PL_STATS,
         "pl_player_id", "pl_name"),
    ]:
        if not path.exists():
            print(f"!! {path} missing — run pull_{source}_data.py first")
            continue
        src = pd.read_csv(path).rename(
            columns={id_col: "source_id", name_col: "source_name"})
        src["source_id"] = src["source_id"].astype(str)

        matcher = build_player_matcher(fpl_players, source)
        src, results = resolve_source(src, source, matcher, fixture_matcher)
        all_uncertain += [r for r in results if r.flagged]

        tag = {"understat": "un", "pl": "pl"}[source]
        usable = src if args.include_flagged else src[~src[f"join_flag_{tag}"].astype(bool)]
        usable = usable.dropna(subset=["fpl_id", "fpl_fixture_id"])
        n_lost = len(src) - len(usable)
        print(f"{source}: {len(usable)} rows joinable "
              f"({n_lost} dropped: flagged players or unmatched fixtures)")

        keep = ["fpl_id", "fpl_fixture_id", "source_id",
                f"join_method_{tag}", f"join_conf_{tag}"] + stats
        enriched = enriched.merge(
            usable[keep].rename(columns={"source_id": f"{source}_id"}),
            how="left",
            left_on=["element", "fixture"],
            right_on=["fpl_id", "fpl_fixture_id"],
        ).drop(columns=["fpl_id", "fpl_fixture_id"])

    # per-90 on FPL minutes (single source of truth for minutes)
    mins = enriched["minutes"].replace(0, np.nan)
    for c in PER90:
        if c in enriched.columns:
            enriched[f"{c}_per90"] = (enriched[c] / mins * 90).round(3)

    # over/under-performance deltas (per fixture; linear, so rolling and
    # season windows can simply sum them)
    enriched["xg_delta"] = (enriched["goals_scored"]
                            - enriched["expected_goals"]).round(3)
    enriched["xa_delta"] = (enriched["assists"]
                            - enriched["expected_assists"]).round(3)
    enriched["xgi_delta"] = (enriched["goals_scored"] + enriched["assists"]
                             - enriched["expected_goal_involvements"]).round(3)

    enriched.to_csv(ROOT / "player_gw_enriched.csv", index=False)

# Mirror to the Drive folder so pipeline scripts' defaults just work
    drive_dir = Path(
        "~/Library/CloudStorage/GoogleDrive-stefcourt2004@gmail.com/My Drive/FPL/FPL_2025-26_historical"
    ).expanduser()
    enriched.to_csv(drive_dir / "player_gw_enriched.csv", index=False)
    print(f"Mirrored enriched CSV to {drive_dir}")

    DATA.mkdir(exist_ok=True)
    pd.DataFrame([vars(r) for r in all_uncertain]).to_csv(
        DATA / "join_uncertain.csv", index=False)

    # coverage gate: per GW, % of FPL minutes carrying source data
    cov = []
    for src_name, probe in [("understat", "us_npxg"),
                            ("pl", "pl_touches_opp_box")]:
        if probe not in enriched.columns:
            continue
        for rnd, d in enriched.groupby("round"):
            total = d["minutes"].sum()
            covered = d.loc[d[probe].notna(), "minutes"].sum()
            cov.append({"source": src_name, "gameweek": rnd,
                        "minutes_coverage": round(covered / max(total, 1), 3)})
    cov_df = pd.DataFrame(cov)
    cov_df.to_csv(DATA / "join_coverage_report.csv", index=False)

    print(f"\nWrote player_gw_enriched.csv ({len(enriched)} rows, "
          f"{len(enriched.columns)} columns)")
    print(f"{len(all_uncertain)} uncertain player joins -> data/join_uncertain.csv")

    bad = cov_df[cov_df["minutes_coverage"] < 0.95]
    if len(bad):
        print(f"!! {len(bad)} gameweek/source combos below 95% minutes coverage "
              f"— see data/join_coverage_report.csv:")
        print(bad.to_string(index=False))
        sys.exit(1)
    print("Coverage OK: every gameweek >= 95% for both sources")


if __name__ == "__main__":
    main()