"""Fixture matching across sources.

Identity of a fixture = (canonical home, canonical away) team pair, with
kickoff date used only as a tie-breaker. This is deliberate:

- Team pair is stable across sources; dates are not (UTC vs local kickoff
  can shift the calendar date by one day; rescheduled games move entirely).
- A team pair repeats at most a handful of times per season, so a +/-1 day
  window on the pair is unambiguous except in pathological cases, which we
  flag instead of guessing.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from .teams import resolve_team

DATE_TOLERANCE = timedelta(days=1)


@dataclass(frozen=True)
class FixtureMatch:
    fixture_id: object          # FPL fixture id
    gameweek: Optional[int]
    date_diff_days: int
    ambiguous: bool             # True -> write to join_uncertain, do not auto-join


def _as_date(d) -> date:
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return datetime.fromisoformat(str(d).replace("Z", "+00:00")).date()


class FixtureMatcher:
    """Index FPL fixtures once, then match any source fixture into them.

    fpl_fixtures: iterable of dicts with keys
        fixture_id, gameweek, kickoff_date, home (canonical), away (canonical)
    """

    def __init__(self, fpl_fixtures):
        self._by_pair = {}
        for f in fpl_fixtures:
            key = (f["home"], f["away"])
            self._by_pair.setdefault(key, []).append(
                (f["fixture_id"], f.get("gameweek"), _as_date(f["kickoff_date"]))
            )

    def match(self, source_home: str, source_away: str, source_date) -> Optional[FixtureMatch]:
        """Returns FixtureMatch, or None if no FPL fixture within tolerance."""
        home, away = resolve_team(source_home), resolve_team(source_away)
        sdate = _as_date(source_date)

        candidates = []
        for fid, gw, fdate in self._by_pair.get((home, away), []):
            diff = abs((fdate - sdate).days)
            if diff <= DATE_TOLERANCE.days:
                candidates.append((diff, fid, gw))

        if not candidates:
            return None
        candidates.sort(key=lambda c: c[0])
        best = candidates[0]
        # Ambiguous only if two candidates sit at the same date distance
        # (e.g. corrupted duplicate rows) — nearest-date otherwise wins,
        # which safely separates the two legs of a same-pair double.
        ambiguous = len(candidates) > 1 and candidates[1][0] == best[0]
        return FixtureMatch(
            fixture_id=best[1], gameweek=best[2],
            date_diff_days=best[0], ambiguous=ambiguous,
        )
