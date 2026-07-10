"""Canonical team resolution.

Canonical form = FPL short_name (ARS, MCI, ...). Understat and FBref team
names resolve into these codes. Unknown names raise loudly — never guess a
team, because team is a hard constraint in player and fixture matching.

2025-26 Premier League (20 teams, incl. promoted BUR / LEE / SUN).
"""
from .names import normalize_name


class UnknownTeamError(KeyError):
    pass


# canonical -> aliases seen across FPL full names, Understat, FBref
_ALIASES = {
    "ARS": ["Arsenal"],
    "AVL": ["Aston Villa"],
    "BOU": ["Bournemouth", "AFC Bournemouth"],
    "BRE": ["Brentford"],
    "BHA": ["Brighton", "Brighton and Hove Albion", "Brighton & Hove Albion"],
    "BUR": ["Burnley"],
    "CHE": ["Chelsea"],
    "CRY": ["Crystal Palace"],
    "EVE": ["Everton"],
    "FUL": ["Fulham"],
    "LEE": ["Leeds", "Leeds United"],
    "LIV": ["Liverpool"],
    "MCI": ["Manchester City", "Man City"],
    "MUN": ["Manchester United", "Manchester Utd", "Man United", "Man Utd"],
    "NEW": ["Newcastle United", "Newcastle Utd", "Newcastle"],
    "NFO": ["Nottingham Forest", "Nott'ham Forest", "Nottm Forest", "Nottingham"],
    "SUN": ["Sunderland"],
    "TOT": ["Tottenham", "Tottenham Hotspur", "Spurs"],
    "WHU": ["West Ham", "West Ham United"],
    "WOL": ["Wolverhampton Wanderers", "Wolves", "Wolverhampton"],
}

_LOOKUP = {}
for code, aliases in _ALIASES.items():
    _LOOKUP[normalize_name(code)] = code
    for a in aliases:
        _LOOKUP[normalize_name(a)] = code

CANONICAL_TEAMS = frozenset(_ALIASES)


def resolve_team(name: str) -> str:
    """Any-source team name -> canonical FPL short code. Raises on unknown."""
    key = normalize_name(name)
    if key in _LOOKUP:
        return _LOOKUP[key]
    raise UnknownTeamError(
        f"Unknown team name {name!r} — add an alias to source_join/teams.py"
    )


def register_alias(canonical: str, alias: str) -> None:
    """Runtime escape hatch (e.g. a source renames a club mid-season)."""
    if canonical not in CANONICAL_TEAMS:
        raise UnknownTeamError(f"{canonical!r} is not a canonical code")
    _LOOKUP[normalize_name(alias)] = canonical
