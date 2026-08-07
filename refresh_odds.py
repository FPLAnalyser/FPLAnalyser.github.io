#!/usr/bin/env python3
"""refresh_odds.py — turn bookmaker odds into per-fixture goal expectancies.

Each fixture's home/away expected goals (lam_h, lam_a) are fitted under a
Poisson model to every market we hold for it, by weighted least squares:

  · match result (1X2)      — splits the goals between the teams
  · over/under 2.5          — pins the total
  · Asian handicap          — sharpens the split (same bulk request, +1 credit)
  · team totals             — direct quote per team (per-event calls, ~1
                              credit per fixture, so only fetched near a
                              deadline or when forced)

Clean sheets, save volume and attacking upside all derive from the lambdas,
so the site ships those two numbers per fixture — never the odds themselves.

Sources:
  1. The Odds API (ODDS_API_KEY env).  Bulk pull = 3 credits (h2h, spreads,
     totals x 1 UK region).  Team-totals enrichment adds ~1 credit per
     fixture and runs only when the next deadline is within ENRICH_DAYS
     (default 3) or ENRICH=1 is set — and never when the remaining credit
     balance is under 150.
  2. football-data.co.uk fixtures.csv (free, keyless) as fallback.

Output: site_data/<newest season>/odds.json
  { generated_at, source,
    matches:  [{gw, h, a, lh, la, src}],
    strength: {SHORT: {att, def, n}} }
with h/a as FPL team ids and src listing the markets that constrained the
fit (e.g. "1x2+ou+ah+tt").

`matches` ACCUMULATES. Bookmakers price roughly a round at a time, so any one
pull sees a single gameweek; keeping what is already banked is what turns 38
snapshots into a season of market lambdas. Re-pricing a fixture overwrites it,
so running this hourly costs nothing but the credits.

`strength` is what that accumulation buys: a ridge-regularised joint fit of all
forty attack/defence parameters to every banked fixture, pulled toward last
season's values. The site uses it for the fixtures the market has NOT priced —
which is most of them, most of the time. With one round banked it barely moves
off last season, which is correct: one fixture per club carries almost no
information. See fit_strength() for why, and --refit to re-derive offline.
"""
import csv
import datetime
import io
import json
import math
import os
import re
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site_data")
FPL = "https://fantasy.premierleague.com/api"
ODDS_HOST = "https://api.the-odds-api.com/v4/sports/soccer_epl"
LEAGUE_TOTAL_PRIOR = 2.8   # avg PL goals/game — seed when no totals line
MAX_G = 12                 # Poisson truncation
ENRICH_MIN_CREDITS = 150


def get(url, as_json=True):
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-odds"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
        return (json.loads(body), dict(r.headers)) if as_json else (body.decode("utf-8", "replace"), dict(r.headers))


# ── team-name matching ──────────────────────────────────────────────────────
ALIASES = {
    "manchester city": "man city", "manchester united": "man utd", "manchester utd": "man utd",
    "tottenham hotspur": "spurs", "tottenham": "spurs",
    "wolverhampton wanderers": "wolves", "wolverhampton": "wolves",
    "nottingham forest": "nott'm forest", "nottm forest": "nott'm forest",
    "newcastle united": "newcastle", "west ham united": "west ham",
    "brighton and hove albion": "brighton", "brighton hove albion": "brighton",
    "leeds united": "leeds", "hull": "hull city", "coventry": "coventry city",
    "ipswich": "ipswich town", "sheffield united": "sheffield utd", "luton": "luton town",
}

def norm(name):
    s = re.sub(r"[^a-z0-9' ]", " ", name.lower().replace("&", "and"))
    s = re.sub(r"\bfc\b|\bafc\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return ALIASES.get(s, s)


# ── probability model ───────────────────────────────────────────────────────
def _pmf(lam):
    return [math.exp(-lam) * lam ** k / math.factorial(k) for k in range(MAX_G)]

def implied(kind, arg, lh, la, ph, pa):
    """Model probability of one market outcome given (lam_h, lam_a).
       ph/pa are precomputed pmfs for speed."""
    if kind == "home_win":
        return sum(ph[i] * sum(pa[:i]) for i in range(1, MAX_G))
    if kind == "over":          # arg: half-integer total line
        cut = int(math.floor(arg))
        t = lh + la
        return 1 - sum(math.exp(-t) * t ** k / math.factorial(k) for k in range(cut + 1))
    if kind == "ah":            # arg: home half-integer handicap L; covers iff H-A > -L
        need = -arg             # H - A strictly greater than this
        return sum(ph[i] * sum(pa[j] for j in range(MAX_G) if i - j > need) for i in range(MAX_G))
    if kind == "tt_home":       # arg: half-integer team line, P(H > line)
        return 1 - sum(ph[: int(math.floor(arg)) + 1])
    if kind == "tt_away":
        return 1 - sum(pa[: int(math.floor(arg)) + 1])
    raise ValueError(kind)


def solve(constraints):
    """Weighted least-squares fit of (lam_h, lam_a) to market constraints:
       [(kind, arg, prob, weight), ...].  Coarse grid then two refinements."""
    def sse(lh, la):
        ph, pa = _pmf(lh), _pmf(la)
        return sum(w * (implied(k, a, lh, la, ph, pa) - p) ** 2 for k, a, p, w in constraints)

    best, best_v = (LEAGUE_TOTAL_PRIOR / 2, LEAGUE_TOTAL_PRIOR / 2), float("inf")
    lo_h = lo_a = 0.15
    hi_h = hi_a = 4.5
    step = 0.15
    for _ in range(3):
        lh = lo_h
        while lh <= hi_h:
            la = lo_a
            while la <= hi_a:
                v = sse(lh, la)
                if v < best_v:
                    best_v, best = v, (lh, la)
                la += step
            lh += step
        lo_h, hi_h = max(0.05, best[0] - step), best[0] + step
        lo_a, hi_a = max(0.05, best[1] - step), best[1] + step
        step /= 6
    return round(best[0], 3), round(best[1], 3)


def demargin(*decimal_odds):
    inv = [1.0 / o for o in decimal_odds]
    z = sum(inv)
    return [x / z for x in inv]


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def is_half(x):
    return x is not None and abs(x * 2 - round(x * 2)) < 1e-9 and abs(x - round(x)) > 1e-9


# ── The Odds API ────────────────────────────────────────────────────────────
def bulk_markets(key):
    """One request: every priced PL fixture with h2h + spreads + totals.
       ODDS_REGIONS widens the bookmaker pool (cost = markets x regions)."""
    regions = os.environ.get("ODDS_REGIONS", "uk").strip() or "uk"
    url = (f"{ODDS_HOST}/odds/?apiKey={key}&regions={regions}"
           f"&markets=h2h,spreads,totals&oddsFormat=decimal")
    events, headers = get(url)
    remaining = headers.get("x-requests-remaining", "?")
    print(f"The Odds API bulk ({regions}): {len(events)} priced fixtures | cost "
          f"{headers.get('x-requests-last', '?')} | credits remaining: {remaining}")
    return events, remaining


def team_totals_for(key, event_id):
    url = (f"{ODDS_HOST}/events/{event_id}/odds?apiKey={key}&regions=uk"
           f"&markets=team_totals&oddsFormat=decimal")
    try:
        ev, headers = get(url)
        return ev, headers.get("x-requests-remaining", "?")
    except Exception as e:   # market not offered / event gone — degrade, don't die
        print(f"  team_totals unavailable for {event_id}: {e}")
        return None, None


def constraints_from_event(ev, home, away):
    """Median consensus across bookmakers → de-margined constraint list."""
    h2h_h, h2h_d, h2h_a = [], [], []
    over, under = [], []
    ah = {}       # home line -> ([home odds], [away odds])
    tt = {}       # (side, line) -> ([over], [under])
    for bk in ev.get("bookmakers", []):
        for mk in bk.get("markets", []):
            if mk["key"] == "h2h":
                prices = {o["name"]: o["price"] for o in mk["outcomes"]}
                if home in prices and away in prices and "Draw" in prices:
                    h2h_h.append(prices[home]); h2h_d.append(prices["Draw"]); h2h_a.append(prices[away])
            elif mk["key"] == "totals":
                for o in mk["outcomes"]:
                    if o.get("point") == 2.5:
                        (over if o["name"] == "Over" else under).append(o["price"])
            elif mk["key"] == "spreads":
                sides = {}
                for o in mk["outcomes"]:
                    if o.get("point") is not None:
                        sides[o["name"]] = (o["point"], o["price"])
                if home in sides and away in sides and is_half(sides[home][0]):
                    line = sides[home][0]
                    ah.setdefault(line, ([], []))
                    ah[line][0].append(sides[home][1]); ah[line][1].append(sides[away][1])
            elif mk["key"] == "team_totals":
                for o in mk["outcomes"]:
                    team = o.get("description") or ""
                    point = o.get("point")
                    if not is_half(point):
                        continue
                    side = "home" if norm(team) == norm(home) else "away" if norm(team) == norm(away) else None
                    if side is None:
                        continue
                    kk = (side, point)
                    tt.setdefault(kk, ([], []))
                    (tt[kk][0] if o["name"] == "Over" else tt[kk][1]).append(o["price"])

    cons, used = [], []
    if h2h_h:
        p_home, _, _ = demargin(median(h2h_h), median(h2h_d), median(h2h_a))
        cons.append(("home_win", None, p_home, 1.0)); used.append("1x2")
    if over and under:
        cons.append(("over", 2.5, demargin(median(over), median(under))[0], 1.0)); used.append("ou")
    if ah:
        line = max(ah, key=lambda ln: len(ah[ln][0]))     # most-quoted half line
        hs, as_ = ah[line]
        cons.append(("ah", line, demargin(median(hs), median(as_))[0], 0.7)); used.append("ah")
    for (side, point), (ov, un) in sorted(tt.items()):
        if ov and un:
            cons.append((f"tt_{side}", point, demargin(median(ov), median(un))[0], 0.5))
            if "tt" not in used:
                used.append("tt")
    return cons, used


def from_odds_api(key, enrich):
    events, remaining = bulk_markets(key)
    out = []
    can_enrich = enrich
    try:
        if int(remaining) < ENRICH_MIN_CREDITS:
            can_enrich = False
            print(f"enrichment skipped: only {remaining} credits left (< {ENRICH_MIN_CREDITS})")
    except (TypeError, ValueError):
        pass
    for ev in events:
        home, away = ev["home_team"], ev["away_team"]
        if can_enrich:
            full, remaining = team_totals_for(key, ev["id"])
            if full is not None:
                ev = {**ev, "bookmakers": ev.get("bookmakers", []) + full.get("bookmakers", [])}
        cons, used = constraints_from_event(ev, home, away)
        if not cons:
            continue
        kick = datetime.datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
        out.append((home, away, kick, cons, "+".join(used)))
    if can_enrich:
        print(f"after team-totals enrichment | credits remaining: {remaining}")
    return out, "the-odds-api"


# ── the banked market record ────────────────────────────────────────────────
def read_existing(path):
    """Whatever is already in odds.json. A missing or unreadable file is not an
       error — it just means nothing is banked yet."""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def merge_matches(old, new):
    """Union of banked and freshly priced fixtures, newest winning.

       Keyed on the pairing rather than the gameweek: a fixture is played once
       per season at a given venue, so (h, a) identifies it even if it gets
       postponed into a different gameweek — which is exactly when keying on
       the gameweek would silently bank the same game twice."""
    by_pair = {}
    for m in list(old) + list(new):
        try:
            by_pair[(int(m["h"]), int(m["a"]))] = m
        except (KeyError, TypeError, ValueError):
            continue
    return list(by_pair.values())


# ── market-implied team strength ────────────────────────────────────────────
# Every priced fixture is two equations in four unknowns:
#     λ_home = att_home x (def_away / lg_def) x home_advantage
#     λ_away = att_away x (def_home / lg_def) / home_advantage
# so no single fixture identifies anything. Fit all forty parameters at once
# against every fixture banked so far, pulled toward last season's values by a
# ridge term, and the market's opinion emerges as the fixtures accumulate.
#
# The ridge weight is what makes this safe to run from day one. With one round
# priced each club has n=1, PRIOR_W=4 leaves the answer 80% last season, and
# the fit barely moves — correct, because one fixture against an opponent whose
# own strength is equally stale carries almost no information. By the time a
# club has appeared in six priced games the market is running the estimate.
# Promoted clubs get a far weaker pull because the thing they are being pulled
# toward is a blanket placeholder, not a record.
PRIOR_W = 4.0        # fixtures' worth of belief in a club's carried strength
PRIOR_W_NEW = 0.25   # ...and in the flat placeholder a promoted club carries
FIT_ITERS = 60


def fit_strength(matches, season, short_by_id):
    """Ridge-regularised joint fit of every club's attack and defence to the
       banked market lambdas. Returns {short_name: {att, def, n}}, empty when
       there is no model to anchor on."""
    model_path = os.path.join(ROOT, season, "xp_model.json")
    if not os.path.exists(model_path):
        return {}
    with open(model_path, encoding="utf-8") as f:
        model = json.load(f)
    teams = model.get("teams", {})
    lg = model.get("league", {})
    lg_def, h_adv = lg.get("def"), lg.get("hAtt", 1.0)
    if not teams or not lg_def:
        return {}

    la = {t: math.log(v["att"]) for t, v in teams.items() if v.get("att")}
    ld = {t: math.log(v["def"]) for t, v in teams.items() if v.get("def")}
    la0, ld0 = dict(la), dict(ld)
    weight = {t: (PRIOR_W_NEW if v.get("prior") else PRIOR_W) for t, v in teams.items()}

    # (attacker, defender, log λ, log venue multiplier applied to the attacker)
    obs = []
    for m in matches:
        hs, as_ = short_by_id.get(m.get("h")), short_by_id.get(m.get("a"))
        if hs not in la or as_ not in la:
            continue
        for att, dfc, lam, venue in ((hs, as_, m.get("lh"), h_adv),
                                     (as_, hs, m.get("la"), 1 / h_adv)):
            if lam and lam > 0:
                obs.append((att, dfc, math.log(lam), math.log(venue)))
    if not obs:
        return {}

    # Coordinate descent: each parameter's update is a closed form, so this is
    # a handful of passes over a few hundred numbers and stays dependency-free.
    log_lg_def = math.log(lg_def)
    for _ in range(FIT_ITERS):
        num = {t: weight[t] * la0[t] for t in la}
        den = {t: weight[t] for t in la}
        for att, dfc, ll, lv in obs:
            num[att] += ll - ld[dfc] + log_lg_def - lv
            den[att] += 1.0
        la = {t: num[t] / den[t] for t in la}
        num = {t: weight[t] * ld0[t] for t in ld}
        den = {t: weight[t] for t in ld}
        for att, dfc, ll, lv in obs:
            num[dfc] += ll - la[att] + log_lg_def - lv
            den[dfc] += 1.0
        ld = {t: num[t] / den[t] for t in ld}

    played = {}
    for m in matches:
        for t in (short_by_id.get(m.get("h")), short_by_id.get(m.get("a"))):
            if t in la:
                played[t] = played.get(t, 0) + 1

    strength = {t: {"att": round(math.exp(la[t]), 3),
                    "def": round(math.exp(ld[t]), 3),
                    "n": played.get(t, 0)}
                for t in sorted(la) if played.get(t)}
    if strength:
        moved = sorted(strength.items(),
                       key=lambda kv: -abs(kv[1]["att"] - teams[kv[0]]["att"]))[:5]
        print(f"market-implied strength fitted for {len(strength)} clubs from "
              f"{len(matches)} banked fixtures | biggest attack revisions: "
              + ", ".join(f"{t} {teams[t]['att']:.2f}->{v['att']:.2f} (n={v['n']})"
                          for t, v in moved))
    return strength


# ── football-data fallback (keyless) ────────────────────────────────────────
def from_football_data():
    text, _ = get("https://www.football-data.co.uk/fixtures.csv", as_json=False)
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        if row.get("Div") != "E0":
            continue
        try:
            h, d, a = float(row["AvgH"]), float(row["AvgD"]), float(row["AvgA"])
        except (KeyError, ValueError):
            continue
        cons = [("home_win", None, demargin(h, d, a)[0], 1.0)]
        used = ["1x2"]
        try:
            cons.append(("over", 2.5, demargin(float(row["Avg>2.5"]), float(row["Avg<2.5"]))[0], 1.0))
            used.append("ou")
        except (KeyError, ValueError):
            pass
        kick = datetime.datetime.strptime(row["Date"], "%d/%m/%Y").replace(tzinfo=datetime.timezone.utc)
        out.append((row["HomeTeam"], row["AwayTeam"], kick, cons, "+".join(used)))
    print(f"football-data.co.uk: {len(out)} priced PL fixtures")
    return out, "football-data"


# ── main ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    with open(os.path.join(ROOT, "seasons.json"), encoding="utf-8") as f:
        season = json.load(f)["seasons"][0]["id"]

    # --refit: re-run the strength fit over the fixtures already banked and
    # write nothing else. No bookmaker call and no FPL call, so no credits and
    # no network — which is the point: PRIOR_W is a judgement call, and
    # re-deriving after changing it should not cost anything or wait for
    # tomorrow's schedule. Team ids come from teams.json, which is ordered
    # alphabetically exactly as the FPL ids are (see src/lib/xp.ts).
    if "--refit" in sys.argv:
        path = os.path.join(ROOT, season, "odds.json")
        payload = read_existing(path)
        if not payload.get("matches"):
            sys.exit(f"{path}: nothing banked to re-fit")
        with open(os.path.join(ROOT, season, "teams.json"), encoding="utf-8") as f:
            shorts = {i + 1: t["short_name"] for i, t in enumerate(json.load(f))}
        payload["strength"] = fit_strength(payload["matches"], season, shorts)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{path}: strength re-fitted over {len(payload['matches'])} banked fixtures")
        sys.exit(0)

    boot, _ = get(f"{FPL}/bootstrap-static/")
    by_norm = {norm(t["name"]): t["id"] for t in boot["teams"]}
    fixtures, _ = get(f"{FPL}/fixtures/")

    # Enrich (team totals) near a deadline, or when forced via ENRICH=1.
    enrich = os.environ.get("ENRICH", "").strip() in ("1", "true", "yes")
    if not enrich:
        now = datetime.datetime.now(datetime.timezone.utc)
        days = float(os.environ.get("ENRICH_DAYS", "3"))
        for e in boot["events"]:
            dl = datetime.datetime.fromisoformat(e["deadline_time"].replace("Z", "+00:00"))
            if not e["finished"] and now <= dl <= now + datetime.timedelta(days=days):
                enrich = True
                print(f"deadline for GW{e['id']} within {days:g} days — enriching with team totals")
                break

    key = os.environ.get("ODDS_API_KEY", "").strip()
    events, source = (from_odds_api(key, enrich) if key else from_football_data())

    matches, unmatched = [], []
    for home, away, kick, cons, used in events:
        h, a = by_norm.get(norm(home)), by_norm.get(norm(away))
        if h is None or a is None:
            unmatched.append(f"{home} v {away}")
            continue
        gw = None
        for fx in fixtures:
            if fx.get("team_h") == h and fx.get("team_a") == a and fx.get("event") and fx.get("kickoff_time"):
                fk = datetime.datetime.fromisoformat(fx["kickoff_time"].replace("Z", "+00:00"))
                if abs((fk - kick).total_seconds()) < 3 * 86400:
                    gw = fx["event"]
                    break
        if gw is None:
            unmatched.append(f"{home} v {away} (no fixture within 3 days)")
            continue
        lh, la = solve(cons)
        matches.append({"gw": gw, "h": h, "a": a, "lh": lh, "la": la, "src": used})

    out_path = os.path.join(ROOT, season, "odds.json")

    # ── accumulate, rather than replace ──────────────────────────────────────
    # Bookmakers price about a round at a time, so any single pull sees one
    # gameweek. Keeping the ones already banked turns 38 one-round snapshots
    # into a season of market lambdas, which is what makes the strength fit
    # below able to generalise at all — see the note there. Keyed by the
    # fixture, so a re-priced game overwrites rather than double-counts, and
    # so a postponement that moves a game between gameweeks is picked up.
    matches = merge_matches(read_existing(out_path).get("matches", []), matches)

    strength = fit_strength(matches, season,
                            {t["id"]: t["short_name"] for t in boot["teams"]})

    payload = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "matches": sorted(matches, key=lambda m: (m["gw"], m["h"])),
        "strength": strength,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    gws = sorted({m["gw"] for m in matches})
    per_gw = {g: sum(1 for m in matches if m["gw"] == g) for g in gws}
    print(f"{out_path}: {len(matches)} fixtures with market lambdas | per gameweek: "
          f"{per_gw if per_gw else 'none'}")
    if unmatched:
        print(f"unmatched ({len(unmatched)}): {unmatched[:6]}")
