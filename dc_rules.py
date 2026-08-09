"""Defensive-contribution scoring rules, in one place.

FPL awards 2 points for reaching a threshold of defensive actions in a match.
The threshold differs by position, and the `defensive_contribution` column the
FPL API ships already applies the position-correct DEFINITION of an action —
clearances, blocks, interceptions and tackles for a defender; those plus ball
recoveries for everyone else. So the only thing to get right here is the
number, not what counts toward it.

This module exists because that number was written down twice — once in
build_xp_model.py and once in fpl_analyser_rating.py — which is one edit and
one silent wrong answer away from a bug nobody would notice. Both import it now.
"""

# Actions needed for the 2 points, by FPL position code.
DC_THR = {"GKP": 99, "DEF": 10, "MID": 12, "FWD": 12}

DC_POINTS = 2


def dc_hit(frame, position_col="position", value_col="defensive_contribution"):
    """Boolean Series: did this appearance reach its position's threshold?

    Unknown positions map to 99, which no player reaches — a missing position
    reads as "no def-con points" rather than silently qualifying everyone."""
    thr = frame[position_col].map(DC_THR).fillna(99)
    return frame[value_col].fillna(0) >= thr
