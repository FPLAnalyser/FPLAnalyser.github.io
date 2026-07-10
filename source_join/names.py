"""Name normalisation for cross-source player matching.

FPL, Understat and FBref disagree on accents, hyphens, name order and
nicknames. Everything funnels through normalize_name() before comparison.
"""
import re
import unicodedata

try:
    from rapidfuzz import fuzz  # optional, faster + better scoring
    _HAVE_RAPIDFUZZ = True
except ImportError:
    import difflib
    _HAVE_RAPIDFUZZ = False


def strip_diacritics(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def normalize_name(s: str) -> str:
    """'Sávio' -> 'savio', 'Son Heung-Min' -> 'son heung min', "N'Golo" -> 'ngolo'."""
    s = strip_diacritics(s or "").lower()
    s = re.sub(r"[\u2019'`.]", "", s)          # apostrophes / dots removed
    s = re.sub(r"[-_/,]", " ", s)              # hyphens become spaces
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def token_sort(s: str) -> str:
    """Order-insensitive form: 'Heung-Min Son' == 'Son Heung-Min'."""
    return " ".join(sorted(normalize_name(s).split()))


def token_set(s: str) -> frozenset:
    return frozenset(normalize_name(s).split())


def last_token(s: str) -> str:
    toks = normalize_name(s).split()
    return toks[-1] if toks else ""


def similarity(a: str, b: str) -> float:
    """Token-sort similarity in [0, 1]."""
    a2, b2 = token_sort(a), token_sort(b)
    if not a2 or not b2:
        return 0.0
    if a2 == b2:
        return 1.0
    if _HAVE_RAPIDFUZZ:
        return fuzz.token_sort_ratio(a2, b2) / 100.0
    return difflib.SequenceMatcher(None, a2, b2).ratio()
