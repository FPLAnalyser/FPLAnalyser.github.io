#!/usr/bin/env python3
"""refresh_odds.py — turn bookmaker odds into per-fixture goal expectancies.

Each fixture's home/away expected goals (lam_h, lam_a) are fitted under a
Poisson model to every market we hold for it, by weighted least squares:

  · match result (1X2)      — splits the goals between the teams
  · over/under 2.5          — pins the total
  · alternate totals        — the rest of the totals ladder, so the total is
                              pinned by nine bookmakers' worth of lines
                              instead of one line from five
  · both teams to score     — the only market here that says anything about
                              the two teams jointly rather than through their
                              sum; a Poisson fit with independent teams
                              implies a BTTS price, so the quoted one is
                              information the other markets cannot supply
  · team totals             — direct quote per team

Clean sheets, save volume and attacking upside all derive from the lambdas,
so the site ships those two numbers per fixture — never the odds themselves.

Which endpoint serves a market decides what it costs, and the two are not the
same bill. The bulk /odds endpoint prices every fixture at once for
[markets x regions] credits. Everything beyond h2h/spreads/totals is refused
there — "Markets not supported by this endpoint", measured, not assumed — and
has to be fetched from /events/{id}/odds, which charges [markets x regions]
*per fixture*. So btts and alternate totals cost 2 credits a day if you believe
the market list, and 20 credits a round in reality.

That is why enrichment runs once per gameweek rather than on every daily pull:
the fixture-level markets are worth having, but not four times over for the
same round. `enriched_gw` in the output records which gameweek has been done.

Sources:
  1. The Odds API (ODDS_API_KEY env).
     · daily bulk    = 2 credits (h2h + totals x 1 UK region)
     · enrichment    = 4 credits per fixture — btts + alternate_totals from
       the UK books, team totals from the US ones (no UK bookmaker quotes a
       team total; asking uk for it, as this did until it was measured,
       returns nothing). Runs when the next deadline is within ENRICH_DAYS
       (default 3) and that gameweek has not been enriched yet, or when
       ENRICH=1 forces it — never below ENRICH_MIN_CREDITS remaining.
  2. football-data.co.uk fixtures.csv (free, keyless) as fallback.

Output: site_data/<newest season>/odds.json
  { generated_at, source,
    matches:  [{gw, h, a, lh, la, src}],
    strength: {SHORT: {att, def, n}} }
with h/a as FPL team ids and src listing the markets that constrained the
fit (e.g. "1x2+ou+btts+tt").

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

# The bulk endpoint accepts only these. Asian handicap used to be in here; one
# UK bookmaker of twenty-one quoted it, so the "median consensus" handicap was
# a single price, and it cost a credit a day to fetch.
BULK_MARKETS = "h2h,totals"

# Per-event, per region, 1 credit per market per fixture. Split by region
# because the books differ: UK quotes btts (11 of 21) and alternate totals
# (9), US quotes the team totals no UK book offers.
EVENT_MARKETS = (("uk", "btts,alternate_totals"),
                 ("us", "team_totals,alternate_team_totals"))


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
    if kind == "btts":          # both teams score at least once
        return (1 - ph[0]) * (1 - pa[0])
    if kind == "tt_home":       # arg: half-integer team line, P(H > line)
        return 1 - sum(ph[: int(math.floor(arg)) + 1])
    if kind == "tt_away":
        return 1 - sum(pa[: int(math.floor(arg)) + 1])
    raise ValueError(kind)


# What a Premier League fixture can plausibly be worth, as market goal
# expectancies. Wide on purpose — see the rejection note where these are used.
LAM_TOTAL_MIN = 1.4
LAM_TOTAL_MAX = 5.5
LAM_SIDE_MAX = 4.0


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
    """One request: every priced PL fixture with h2h + totals.
       ODDS_REGIONS widens the bookmaker pool (cost = markets x regions)."""
    regions = os.environ.get("ODDS_REGIONS", "uk").strip() or "uk"
    url = (f"{ODDS_HOST}/odds/?apiKey={key}&regions={regions}"
           f"&markets={BULK_MARKETS}&oddsFormat=decimal")
    events, headers = get(url)
    remaining = headers.get("x-requests-remaining", "?")
    print(f"The Odds API bulk ({regions}): {len(events)} priced fixtures | cost "
          f"{headers.get('x-requests-last', '?')} | credits remaining: {remaining}")
    return events, remaining


def event_markets(key, event_id, region, markets):
    """One per-event pull. Costs one credit per market, so the caller decides
       how often this is worth doing — see the enrichment gate in __main__."""
    url = (f"{ODDS_HOST}/events/{event_id}/odds?apiKey={key}&regions={region}"
           f"&markets={markets}&oddsFormat=decimal")
    try:
        ev, headers = get(url)
        return ev, headers.get("x-requests-remaining", "?")
    except Exception as e:   # market not offered / event gone — degrade, don't die
        print(f"  {markets} unavailable for {event_id} ({region}): {e}")
        return None, None


def constraints_from_event(ev, home, away):
    """Median consensus across bookmakers → de-margined constraint list.

       Weights are budgeted per market family rather than per line. The
       alternate-totals ladder arrives as a dozen lines from nine books; giving
       each one the weight the single 2.5 line used to carry would let the
       total outvote the result market ten to one and drag every fit toward
       the league average. So the ladder shares a budget: the line nearest 2.5
       keeps full weight, the rest split one unit between them, and the shape
       of the ladder informs the fit without dominating it."""
    h2h_h, h2h_d, h2h_a = [], [], []
    tot = {}      # total line -> ([over odds], [under odds])
    btts_y, btts_n = [], []
    tt = {}       # (side, line) -> ([over], [under])
    for bk in ev.get("bookmakers", []):
        for mk in bk.get("markets", []):
            key = mk.get("key")
            if key == "h2h":
                prices = {o["name"]: o["price"] for o in mk["outcomes"]}
                if home in prices and away in prices and "Draw" in prices:
                    h2h_h.append(prices[home]); h2h_d.append(prices["Draw"]); h2h_a.append(prices[away])
            elif key in ("totals", "alternate_totals"):
                for o in mk["outcomes"]:
                    point = o.get("point")
                    if not is_half(point):
                        continue
                    tot.setdefault(point, ([], []))
                    (tot[point][0] if o["name"] == "Over" else tot[point][1]).append(o["price"])
            elif key == "btts":
                for o in mk["outcomes"]:
                    (btts_y if str(o["name"]).lower() == "yes" else btts_n).append(o["price"])
            elif key in ("team_totals", "alternate_team_totals"):
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

    lines = {ln: v for ln, v in tot.items() if v[0] and v[1]}
    if lines:
        anchor = min(lines, key=lambda ln: (abs(ln - 2.5), ln))
        others = [ln for ln in lines if ln != anchor]
        w_other = 1.0 / len(others) if others else 0.0
        for ln, (ov, un) in sorted(lines.items()):
            p_over = demargin(median(ov), median(un))[0]
            cons.append(("over", ln, p_over, 1.0 if ln == anchor else w_other))
        used.append("ou" if not others else "ou+aou")

    if btts_y and btts_n:
        cons.append(("btts", None, demargin(median(btts_y), median(btts_n))[0], 0.8))
        used.append("btts")

    for side in ("home", "away"):
        rows = {ln: v for (s, ln), v in tt.items() if s == side and v[0] and v[1]}
        if not rows:
            continue
        w = 0.5 / len(rows)
        for ln, (ov, un) in sorted(rows.items()):
            cons.append((f"tt_{side}", ln, demargin(median(ov), median(un))[0], w))
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

    # ENRICH_LIMIT caps how many fixtures get the per-event treatment. Each one
    # costs a credit per market per region — four, as configured — so this is
    # the difference between a 40-credit round and a 12-credit trial run.
    limit = int(os.environ.get("ENRICH_LIMIT", "0") or 0)
    paid = enriched = 0          # fixtures called for, and fixtures that answered
    for ev in events:
        home, away = ev["home_team"], ev["away_team"]
        if can_enrich and (not limit or paid < limit):
            # The cap counts calls, not successes. Counting successes would let
            # a fixture nobody prices go unbilled in the tally and still cost
            # its credits, so a limit of 3 could quietly buy 10.
            paid += 1
            extra = []
            for region, markets in EVENT_MARKETS:
                full, left = event_markets(key, ev["id"], region, markets)
                if full is not None:
                    extra += full.get("bookmakers", [])
                    remaining = left or remaining
            if extra:
                ev = {**ev, "bookmakers": ev.get("bookmakers", []) + extra}
                enriched += 1
        cons, used = constraints_from_event(ev, home, away)
        if not cons:
            continue
        kick = datetime.datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
        out.append((home, away, kick, cons, "+".join(used)))
    if can_enrich:
        print(f"per-event pulls for {paid} fixtures, {enriched} came back with markets "
              f"| credits remaining: {remaining}")
    return out, "the-odds-api", enriched


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
    return out, "football-data", 0


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

    out_path = os.path.join(ROOT, season, "odds.json")
    banked = read_existing(out_path)

    # ── when to spend on per-event markets ──────────────────────────────────
    # Four credits a fixture, forty a round. The daily schedule would happily
    # pay that three days running for the same gameweek and get three copies of
    # one answer, so the gate is: inside the window, and this gameweek has not
    # been done. ENRICH=1 overrides both, which is what the workflow's manual
    # switch sets.
    forced = os.environ.get("ENRICH", "").strip() in ("1", "true", "yes")
    enrich, target_gw = forced, None
    now = datetime.datetime.now(datetime.timezone.utc)
    days = float(os.environ.get("ENRICH_DAYS", "3"))
    for e in sorted(boot["events"], key=lambda e: e["deadline_time"]):
        dl = datetime.datetime.fromisoformat(e["deadline_time"].replace("Z", "+00:00"))
        if not e["finished"] and dl >= now:
            target_gw = e["id"]
            if now <= dl <= now + datetime.timedelta(days=days):
                if banked.get("enriched_gw") == target_gw and not forced:
                    print(f"GW{target_gw} already enriched — skipping the per-event pulls")
                else:
                    enrich = True
                    print(f"deadline for GW{target_gw} within {days:g} days — "
                          f"enriching with per-event markets")
            break

    key = os.environ.get("ODDS_API_KEY", "").strip()
    events, source, enriched = (from_odds_api(key, enrich) if key else from_football_data())

    matches, unmatched, rejected = [], [], []
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
        # ── DOES THE FIT DESCRIBE A FOOTBALL MATCH? ───────────────────────
        #
        # Nothing checked, and a bad solve is not a small error: the pull that
        # first priced GW2 returned Bournemouth v Everton at 4.61 and 3.86,
        # eight and a half goals in one game, alongside Leeds v Brentford at
        # 8.01 and Spurs v Newcastle at 6.97. Every GW1 fixture in the same
        # file sat between 2.14 and 3.00, which is what a Premier League match
        # actually looks like. The numbers went straight to the GW Preview,
        # the fixture grid, the clean-sheet odds and every xP built on them.
        #
        # The solver searches lh and la up to 4.5 and its refinement passes can
        # step past that, so a fit that runs out of constraints — a thin market,
        # a book quoting a handful of lines — drifts to the top of the range
        # instead of failing. It has to be able to fail.
        #
        # The band is deliberately wide: a real fixture between the best attack
        # and a promoted defence prices near 4.5 total, and nothing in the
        # Premier League era has been quoted at 6. A fixture rejected here is
        # not lost, it is simply not priced — the projection falls back to the
        # model's own strengths, which is the same path every unpriced gameweek
        # already takes.
        total = lh + la
        if not (LAM_TOTAL_MIN <= total <= LAM_TOTAL_MAX) or max(lh, la) > LAM_SIDE_MAX:
            rejected.append(f"{h}v{a} gw{gw} lh={lh} la={la} total={total:.2f}")
            continue
        matches.append({"gw": gw, "h": h, "a": a, "lh": lh, "la": la, "src": used})

    # ── accumulate, rather than replace ──────────────────────────────────────
    # Bookmakers price about a round at a time, so any single pull sees one
    # gameweek. Keeping the ones already banked turns 38 one-round snapshots
    # into a season of market lambdas, which is what makes the strength fit
    # below able to generalise at all — see the note there. Keyed by the
    # fixture, so a re-priced game overwrites rather than double-counts, and
    # so a postponement that moves a game between gameweeks is picked up.
    if rejected:
        print(f"  REJECTED {len(rejected)} fixture(s) whose fit was not a football match:")
        for r in rejected:
            print(f"    {r}")
        print("    (left unpriced — the projection falls back to the model's own strengths)")

    matches = merge_matches(banked.get("matches", []), matches)

    strength = fit_strength(matches, season,
                            {t["id"]: t["short_name"] for t in boot["teams"]})

    payload = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "matches": sorted(matches, key=lambda m: (m["gw"], m["h"])),
        "strength": strength,
    }
    # Carry the marker forward, and only move it when fixtures were actually
    # enriched — a pull that asked and got nothing back must not count as done.
    enriched_gw = target_gw if enriched else banked.get("enriched_gw")
    if enriched_gw is not None:
        payload["enriched_gw"] = enriched_gw

    if "--dry-run" in sys.argv:
        print("dry run — not writing " + out_path)
        for m in sorted(payload["matches"], key=lambda m: (m["gw"], m["h"]))[:12]:
            print(f"  GW{m['gw']} {m['h']:>2} v {m['a']:<2}  "
                  f"lh {m['lh']:.2f}  la {m['la']:.2f}  [{m['src']}]")
        sys.exit(0)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    gws = sorted({m["gw"] for m in matches})
    per_gw = {g: sum(1 for m in matches if m["gw"] == g) for g in gws}
    print(f"{out_path}: {len(matches)} fixtures with market lambdas | per gameweek: "
          f"{per_gw if per_gw else 'none'}")
    if unmatched:
        print(f"unmatched ({len(unmatched)}): {unmatched[:6]}")
