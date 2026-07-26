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
  { generated_at, source, matches: [{gw, h, a, lh, la, src}] }
with h/a as FPL team ids and src listing the markets that constrained the
fit (e.g. "1x2+ou+ah+tt").
"""
import csv
import datetime
import io
import json
import math
import os
import re
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

    # ── market-implied strength for clubs with no Premier League record ──────
    # A promoted club's own history tells us nothing, but every priced fixture
    # against a club we DO know is an equation with one unknown:
    #     λ_home = att_home x (def_away / league_def) x home_advantage
    # Solve it the other way round and the market hands us their attack and
    # defence directly — and sharpens both every time another fixture is
    # priced. Written alongside the lambdas so the site can use these strengths
    # for the club's UNPRICED fixtures too, instead of a blanket prior.
    strength = {}
    model_path = os.path.join(ROOT, season, "xp_model.json")
    if os.path.exists(model_path):
        with open(model_path, encoding="utf-8") as f:
            model = json.load(f)
        known = {k: v for k, v in model.get("teams", {}).items() if not v.get("prior")}
        lg = model.get("league", {})
        lg_att, lg_def, h_adv = lg.get("att"), lg.get("def"), lg.get("hAtt", 1.0)
        short_by_id = {t["id"]: t["short_name"] for t in boot["teams"]}
        acc = {}
        if lg_att and lg_def:
            for m in matches:
                hs, as_ = short_by_id.get(m["h"]), short_by_id.get(m["a"])
                for side, opp, lam_for, lam_against, at_home in (
                    (hs, as_, m["lh"], m["la"], True),
                    (as_, hs, m["la"], m["lh"], False),
                ):
                    if side is None or opp is None or side in known or opp not in known:
                        continue
                    # Venue multiplier applies to whoever is attacking:
                    #   λ_us   = att_us x (def_them / lg_def) x venue_us
                    #   λ_them = att_them x (def_us / lg_def) x venue_them
                    # with venue_them = 1 / venue_us.
                    venue_us = h_adv if at_home else 1 / h_adv
                    a = acc.setdefault(side, {"att": [], "def": []})
                    a["att"].append(lam_for * lg_def / (known[opp]["def"] * venue_us))
                    a["def"].append(lam_against * lg_def * venue_us / known[opp]["att"])
        for team, a in acc.items():
            if a["att"] and a["def"]:
                strength[team] = {
                    "att": round(sum(a["att"]) / len(a["att"]), 3),
                    "def": round(sum(a["def"]) / len(a["def"]), 3),
                    "n": len(a["att"]),
                }
        if strength:
            print("market-implied strength for clubs with no PL record: "
                  + ", ".join(f"{t} att {v['att']:.2f} def {v['def']:.2f} (from {v['n']} priced)"
                              for t, v in sorted(strength.items())))

    out_path = os.path.join(ROOT, season, "odds.json")
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
