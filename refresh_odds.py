#!/usr/bin/env python3
"""refresh_odds.py — turn bookmaker odds into per-fixture goal expectancies.

From the two universal markets (match result 1X2, over/under 2.5 goals) each
fixture's home/away expected goals (lam_h, lam_a) are solved under a Poisson
model: the totals market pins the sum, the win probabilities split it. Clean
sheet probability, save volume and attacking upside all derive from those two
numbers, so the site ships the lambdas — never the odds themselves.

Sources, in order:
  1. The Odds API (needs ODDS_API_KEY env; free tier).  One request covers
     every priced upcoming PL fixture at 2 credits (2 markets x 1 region) —
     a daily pull is ~62 credits/month against the 500 free cap.
  2. football-data.co.uk fixtures.csv (free, keyless) as fallback — carries
     PL rows only once books price the coming matchday.

Output: site_data/<newest season>/odds.json
  { generated_at, source, matches: [{gw, h, a, lh, la, src}] }
where h/a are FPL team ids matching availability.json, src notes whether the
totals market existed ("full") or the sum was taken from a league prior ("h2h").

Runs on the GitHub Actions runner (the workflow commits the result); it only
needs the public FPL API plus one odds source.
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
LEAGUE_TOTAL_PRIOR = 2.8   # avg PL goals/game — used only when no totals line


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


# ── the Poisson solve ───────────────────────────────────────────────────────
def solve_lambdas(p_home, p_over=None):
    """(lam_h, lam_a) from de-margined P(home win) and optionally P(over 2.5)."""
    if p_over is not None:
        lo, hi = 0.3, 6.0
        for _ in range(60):
            t = (lo + hi) / 2
            if math.exp(-t) * (1 + t + t * t / 2) > 1 - p_over:
                lo = t
            else:
                hi = t
        total = (lo + hi) / 2
    else:
        total = LEAGUE_TOTAL_PRIOR

    def p_home_win(lh):
        la = total - lh
        return sum(
            math.exp(-lh) * lh ** i / math.factorial(i)
            * sum(math.exp(-la) * la ** j / math.factorial(j) for j in range(0, i))
            for i in range(1, 11)
        )

    lo, hi = 0.05, total - 0.05
    for _ in range(60):
        lh = (lo + hi) / 2
        if p_home_win(lh) < p_home:
            lo = lh
        else:
            hi = lh
    lh = (lo + hi) / 2
    return round(lh, 3), round(total - lh, 3)


def demargin(*decimal_odds):
    inv = [1.0 / o for o in decimal_odds]
    z = sum(inv)
    return [x / z for x in inv]


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


# ── odds sources ────────────────────────────────────────────────────────────
def from_odds_api(key):
    """[(home_name, away_name, kickoff_dt, p_home, p_over|None)] — one request."""
    url = (f"https://api.the-odds-api.com/v4/sports/soccer_epl/odds/"
           f"?apiKey={key}&regions=uk&markets=h2h,totals&oddsFormat=decimal")
    events, headers = get(url)
    print(f"The Odds API: {len(events)} priced fixtures | credits remaining: "
          f"{headers.get('x-requests-remaining', '?')} (this pull cost {headers.get('x-requests-last', '?')})")
    out = []
    for ev in events:
        home, away = ev["home_team"], ev["away_team"]
        h2h_h, h2h_d, h2h_a, over, under = [], [], [], [], []
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
        if not h2h_h:
            continue
        p_home, _, _ = demargin(median(h2h_h), median(h2h_d), median(h2h_a))
        p_over = demargin(median(over), median(under))[0] if over and under else None
        kick = datetime.datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
        out.append((home, away, kick, p_home, p_over))
    return out, "the-odds-api"


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
        p_home, _, _ = demargin(h, d, a)
        p_over = None
        try:
            p_over = demargin(float(row["Avg>2.5"]), float(row["Avg<2.5"]))[0]
        except (KeyError, ValueError):
            pass
        kick = datetime.datetime.strptime(row["Date"], "%d/%m/%Y").replace(tzinfo=datetime.timezone.utc)
        out.append((row["HomeTeam"], row["AwayTeam"], kick, p_home, p_over))
    print(f"football-data.co.uk: {len(out)} priced PL fixtures")
    return out, "football-data"


# ── main ────────────────────────────────────────────────────────────────────
with open(os.path.join(ROOT, "seasons.json"), encoding="utf-8") as f:
    season = json.load(f)["seasons"][0]["id"]

boot, _ = get(f"{FPL}/bootstrap-static/")
by_norm = {norm(t["name"]): t["id"] for t in boot["teams"]}
fixtures, _ = get(f"{FPL}/fixtures/")

key = os.environ.get("ODDS_API_KEY", "").strip()
events, source = (from_odds_api(key) if key else from_football_data())

matches, unmatched = [], []
for home, away, kick, p_home, p_over in events:
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
    lh, la = solve_lambdas(p_home, p_over)
    matches.append({"gw": gw, "h": h, "a": a, "lh": lh, "la": la,
                    "src": "full" if p_over is not None else "h2h"})

out_path = os.path.join(ROOT, season, "odds.json")
payload = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "source": source,
    "matches": sorted(matches, key=lambda m: (m["gw"], m["h"])),
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

gws = sorted({m["gw"] for m in matches})
print(f"{out_path}: {len(matches)} fixtures with market lambdas, gameweeks {gws[:1] and f'{gws[0]}-{gws[-1]}' or 'none'}")
if unmatched:
    print(f"unmatched ({len(unmatched)}): {unmatched[:6]}")
