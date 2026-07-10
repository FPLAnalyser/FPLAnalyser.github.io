"""Tests for the cross-source join module.

Run: pytest tests/ -v   (from the fpl_enrichment directory)
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from source_join import (
    normalize_name, token_sort, similarity, resolve_team, UnknownTeamError,
    FixtureMatcher, PlayerMatcher, FplPlayer,
    save_map, load_map, load_overrides_csv,
)


# ------------------------------ names ---------------------------------- #
def test_accents_stripped():
    assert normalize_name("Sávio") == "savio"
    assert normalize_name("İlkay Gündoğan") == "ilkay gundogan"

def test_apostrophes_and_hyphens():
    assert normalize_name("N'Golo Kanté") == "ngolo kante"
    assert normalize_name("Emile Smith-Rowe") == "emile smith rowe"

def test_token_sort_handles_name_order():
    # Understat lists Son as "Son Heung-Min", FPL as "Heung-min Son"
    assert token_sort("Son Heung-Min") == token_sort("Heung-min Son")

def test_similarity_bounds():
    assert similarity("Mohamed Salah", "Mohamed Salah") == 1.0
    assert similarity("Mohamed Salah", "Darwin Nunez") < 0.5


# ------------------------------ teams ---------------------------------- #
def test_team_aliases_resolve_to_canonical():
    assert resolve_team("Wolverhampton Wanderers") == "WOL"   # Understat
    assert resolve_team("Wolves") == "WOL"                    # FBref
    assert resolve_team("Nott'ham Forest") == "NFO"           # FBref
    assert resolve_team("Manchester Utd") == "MUN"
    assert resolve_team("Brighton & Hove Albion") == "BHA"

def test_unknown_team_raises_not_guesses():
    with pytest.raises(UnknownTeamError):
        resolve_team("Sheffield United")   # not in 2025-26 PL


# ----------------------------- fixtures -------------------------------- #
FIXTURES = [
    dict(fixture_id=101, gameweek=10, kickoff_date=date(2025, 11, 1),
         home="ARS", away="LIV"),
    dict(fixture_id=102, gameweek=10, kickoff_date=date(2025, 11, 2),
         home="MCI", away="TOT"),
    # DGW pair: same teams meet twice within the season
    dict(fixture_id=201, gameweek=24, kickoff_date=date(2026, 1, 14),
         home="EVE", away="FUL"),
    dict(fixture_id=202, gameweek=29, kickoff_date=date(2026, 3, 4),
         home="EVE", away="FUL"),
]

def test_fixture_exact_date():
    m = FixtureMatcher(FIXTURES).match("Arsenal", "Liverpool", date(2025, 11, 1))
    assert m.fixture_id == 101 and not m.ambiguous

def test_fixture_one_day_offset_utc_shift():
    # source stores kickoff in UTC that rolls past midnight
    m = FixtureMatcher(FIXTURES).match("Manchester City", "Tottenham",
                                       date(2025, 11, 3))
    assert m.fixture_id == 102 and m.date_diff_days == 1 and not m.ambiguous

def test_fixture_same_pair_twice_resolved_by_nearest_date():
    fm = FixtureMatcher(FIXTURES)
    assert fm.match("Everton", "Fulham", date(2026, 1, 14)).fixture_id == 201
    assert fm.match("Everton", "Fulham", date(2026, 3, 5)).fixture_id == 202

def test_fixture_home_away_orientation_matters():
    # LIV (h) v ARS is NOT the same fixture as ARS (h) v LIV
    assert FixtureMatcher(FIXTURES).match("Liverpool", "Arsenal",
                                          date(2025, 11, 1)) is None

def test_fixture_outside_tolerance_returns_none():
    assert FixtureMatcher(FIXTURES).match("Arsenal", "Liverpool",
                                          date(2025, 11, 5)) is None


# ----------------------------- players --------------------------------- #
PLAYERS = [
    FplPlayer(1, "Mohamed", "Salah", "M.Salah", "LIV", "MID"),
    FplPlayer(2, "Heung-min", "Son", "Son", "TOT", "MID"),
    FplPlayer(3, "Gabriel", "dos Santos Magalhães", "Gabriel", "ARS", "DEF"),
    FplPlayer(4, "Gabriel", "Martinelli Silva", "Martinelli", "ARS", "MID"),
    FplPlayer(5, "Sávio", "Moreira de Oliveira", "Savinho", "MCI", "MID"),
    FplPlayer(6, "James", "Maddison", "Maddison", "TOT", "MID"),
    FplPlayer(7, "Harry", "Maguire", "Maguire", "MUN", "DEF"),
]

def make_matcher(overrides=None):
    return PlayerMatcher(PLAYERS, overrides)

def test_exact_full_name_with_accents():
    r = make_matcher().match("understat", "u1", "Mohamed Salah", "LIV")
    assert (r.fpl_id, r.method, r.flagged) == (1, "exact_full", False)

def test_name_order_reversed_source():
    r = make_matcher().match("understat", "u2", "Son Heung-Min", "TOT")
    assert r.fpl_id == 2 and not r.flagged

def test_two_gabriels_same_club_ambiguous_is_flagged():
    # bare "Gabriel" at Arsenal must NOT silently pick one of the two
    r = make_matcher().match("fbref", "f3", "Gabriel", "ARS")
    assert r.fpl_id is None and r.method == "ambiguous" and r.flagged

def test_gabriel_disambiguated_with_fuller_name():
    r = make_matcher().match("fbref", "f4", "Gabriel Martinelli", "ARS")
    assert r.fpl_id == 4 and not r.flagged

def test_nickname_resolves_via_web_name_tokens():
    # FPL full name is "Sávio Moreira de Oliveira"; sources say "Savinho",
    # which only exists in the FPL web_name
    r = make_matcher().match("understat", "u5", "Savinho", "MCI")
    assert r.fpl_id == 5 and r.confidence >= 0.95 and not r.flagged

def test_unique_surname_within_team():
    r = make_matcher().match("fbref", "f6", "J. Maddison", "TOT")
    assert r.fpl_id == 6 and r.confidence >= 0.85

def test_unmatched_is_flagged_not_guessed():
    r = make_matcher().match("understat", "u9", "Zlatan Ibrahimovic", "MUN")
    assert r.fpl_id is None and r.method == "unmatched" and r.flagged

def test_override_beats_everything():
    m = make_matcher(overrides={("fbref", "f3"): 3})
    r = m.match("fbref", "f3", "Gabriel", "ARS")
    assert (r.fpl_id, r.method, r.flagged) == (3, "override", False)


# --------------------------- persistence ------------------------------- #
def test_map_roundtrip_becomes_overrides(tmp_path):
    m = make_matcher()
    results = m.match_all("understat",
                          [("u1", "Mohamed Salah", "LIV"),
                           ("u9", "Zlatan Ibrahimovic", "MUN")])
    p = tmp_path / "player_id_map.csv"
    save_map(results, p)
    ov = load_map(p)
    assert ov == {("understat", "u1"): 1}     # flagged row NOT auto-reused

def test_overrides_csv_loading(tmp_path):
    p = tmp_path / "player_overrides.csv"
    p.write_text("source,source_id,fpl_id\nfbref,f3,3\n")
    assert load_overrides_csv(p) == {("fbref", "f3"): 3}
