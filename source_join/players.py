"""Player matching: source player -> FPL element id.

Layered strategy, highest-trust first. Each layer only fires if the previous
layers failed. Every result carries (method, confidence, flagged) and the
whole mapping is persisted to player_id_map.csv so the fuzzy layers run at
most once per player per season — after that the map is a lookup table you
can eyeball and correct via player_overrides.csv.

Layers:
  1. override            manual player_overrides.csv                 conf 1.00
  2. exact_full          normalized "first second" == source name    conf 1.00
  3. exact_full_team     as (2) but disambiguated by team            conf 0.98
  4. token_subset_team   source tokens are a subset of the player's
                         full-name+web-name tokens, unique in team   conf 0.96
                         (catches "Bruno Fernandes" vs FPL "Bruno
                         Borges Fernandes"; flags bare "Gabriel" at
                         Arsenal as ambiguous instead of guessing)
  5. web_name_team       normalized web_name == source name, team    conf 0.95
  6. last_name_team      unique surname within the team              conf 0.90
  7. fuzzy_team          token-sort similarity >= 0.85 within team   conf = score
  8. fuzzy_global        similarity >= 0.93, unique across league    conf = score, always flagged

Anything below FLAG_THRESHOLD (or ambiguous, or unmatched) goes to
join_uncertain.csv for human review. Uncertain matches are still recorded
but enrich_player_gw.py excludes flagged rows unless --include-flagged.
"""
import csv
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from .names import normalize_name, token_sort, token_set, last_token, similarity

FUZZY_TEAM_MIN = 0.85
FUZZY_GLOBAL_MIN = 0.93
FLAG_THRESHOLD = 0.92


@dataclass
class MatchResult:
    source: str                 # 'understat' | 'fbref'
    source_id: str
    source_name: str
    source_team: str            # canonical
    fpl_id: Optional[int]
    fpl_name: Optional[str]
    method: str                 # layer name, or 'unmatched' / 'ambiguous'
    confidence: float
    flagged: bool


@dataclass(frozen=True)
class FplPlayer:
    fpl_id: int
    first_name: str
    second_name: str
    web_name: str
    team: str                   # canonical short code
    position: str               # GKP/DEF/MID/FWD


class PlayerMatcher:
    def __init__(self, fpl_players, overrides=None):
        """fpl_players: iterable of FplPlayer.
        overrides: dict[(source, source_id)] -> fpl_id."""
        self.players = list(fpl_players)
        self.overrides = dict(overrides or {})

        self._by_full = {}       # token_sort(full name) -> [player]
        self._by_web = {}        # (team, normalize(web_name)) -> [player]
        self._by_last = {}       # (team, last token of second_name) -> [player]
        self._tokens = {}        # player -> full-name + web-name token set
        for p in self.players:
            full = token_sort(f"{p.first_name} {p.second_name}")
            self._by_full.setdefault(full, []).append(p)
            self._by_web.setdefault((p.team, normalize_name(p.web_name)), []).append(p)
            self._by_last.setdefault((p.team, last_token(p.second_name)), []).append(p)
            self._tokens[p.fpl_id] = (
                token_set(f"{p.first_name} {p.second_name}") | token_set(p.web_name)
            )

    # ------------------------------------------------------------------ #
    def match(self, source: str, source_id: str, source_name: str,
              source_team: str) -> MatchResult:
        def result(p, method, conf, flagged=None):
            if flagged is None:
                flagged = conf < FLAG_THRESHOLD
            return MatchResult(source, str(source_id), source_name, source_team,
                               p.fpl_id if p else None,
                               f"{p.first_name} {p.second_name}" if p else None,
                               method, conf, flagged)

        # 1. manual override
        ov = self.overrides.get((source, str(source_id)))
        if ov is not None:
            p = next((x for x in self.players if x.fpl_id == ov), None)
            return result(p, "override", 1.0, flagged=False)

        key = token_sort(source_name)

        # 2/3. exact full name
        cands = self._by_full.get(key, [])
        if len(cands) == 1:
            return result(cands[0], "exact_full", 1.0)
        if len(cands) > 1:
            team_cands = [p for p in cands if p.team == source_team]
            if len(team_cands) == 1:
                return result(team_cands[0], "exact_full_team", 0.98)
            return result(None, "ambiguous", 0.0, flagged=True)

        # 4. token subset within team ("Gabriel Martinelli" is a subset of
        #    "Gabriel Martinelli Silva"; bare "Gabriel" is a subset of BOTH
        #    Arsenal Gabriels -> ambiguous, never guessed)
        stoks = token_set(source_name)
        if stoks:
            cands = [p for p in self.players
                     if p.team == source_team and stoks <= self._tokens[p.fpl_id]]
            if len(cands) == 1:
                return result(cands[0], "token_subset_team", 0.96)
            if len(cands) > 1:
                return result(None, "ambiguous", 0.0, flagged=True)

        # 5. web_name within team
        cands = self._by_web.get((source_team, normalize_name(source_name)), [])
        if len(cands) == 1:
            return result(cands[0], "web_name_team", 0.95)

        # 6. unique surname within team
        cands = self._by_last.get((source_team, last_token(source_name)), [])
        if len(cands) == 1:
            return result(cands[0], "last_name_team", 0.90)
        if len(cands) > 1:
            # surname clash inside one squad (e.g. two Gabriels): fuzzy on
            # the clashing set only; must clearly separate or it's flagged.
            scored = sorted(((similarity(source_name,
                                         f"{p.first_name} {p.second_name}"), p)
                             for p in cands), reverse=True, key=lambda t: t[0])
            if scored[0][0] >= FUZZY_TEAM_MIN and \
               scored[0][0] - scored[1][0] >= 0.05:
                return result(scored[0][1], "fuzzy_team", scored[0][0])
            return result(None, "ambiguous", 0.0, flagged=True)

        # 7. fuzzy within team
        team_players = [p for p in self.players if p.team == source_team]
        scored = sorted(((similarity(source_name,
                                     f"{p.first_name} {p.second_name}"), p)
                         for p in team_players), reverse=True, key=lambda t: t[0])
        if scored and scored[0][0] >= FUZZY_TEAM_MIN:
            if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.03:
                return result(None, "ambiguous", 0.0, flagged=True)
            return result(scored[0][1], "fuzzy_team", scored[0][0])

        # 8. fuzzy global (handles mid-window transfers / stale team data)
        scored = sorted(((similarity(source_name,
                                     f"{p.first_name} {p.second_name}"), p)
                         for p in self.players), reverse=True, key=lambda t: t[0])
        if scored and scored[0][0] >= FUZZY_GLOBAL_MIN:
            if len(scored) > 1 and scored[1][0] >= FUZZY_GLOBAL_MIN:
                return result(None, "ambiguous", 0.0, flagged=True)
            return result(scored[0][1], "fuzzy_global", scored[0][0], flagged=True)

        return result(None, "unmatched", 0.0, flagged=True)

    def match_all(self, source, source_players):
        """source_players: iterable of (source_id, name, canonical_team)."""
        return [self.match(source, sid, name, team)
                for sid, name, team in source_players]


# ---------------------------- persistence ------------------------------ #
MAP_FIELDS = ["source", "source_id", "source_name", "source_team",
              "fpl_id", "fpl_name", "method", "confidence", "flagged"]


def save_map(results, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=MAP_FIELDS)
        w.writeheader()
        for r in results:
            w.writerow(asdict(r))


def load_map(path):
    """Existing map rows become overrides -> fuzzy layers never re-run for
    already-resolved players (incremental, deterministic)."""
    path = Path(path)
    if not path.exists():
        return {}
    overrides = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["fpl_id"] and row["flagged"] in ("False", "false", "0", ""):
                overrides[(row["source"], row["source_id"])] = int(row["fpl_id"])
    return overrides


def load_overrides_csv(path):
    """player_overrides.csv: source,source_id,fpl_id — human corrections,
    highest priority of all."""
    path = Path(path)
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {(r["source"], r["source_id"]): int(r["fpl_id"])
                for r in csv.DictReader(f)}
