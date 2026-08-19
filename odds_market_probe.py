#!/usr/bin/env python3
"""odds_market_probe.py — ask The Odds API what it offers, where, and what it costs.

Diagnostic only. Reads nothing, writes nothing, commits nothing.

`refresh_odds.py` requests h2h + spreads + totals in bulk, and team totals per
event. Whether anything else is quoted for a Premier League fixture — both
teams to score, alternate lines, player props — was only ever answered from the
published market list, which documents what the API *supports*, not what a
bookmaker has open for Saturday's game, and not which endpoint serves it.

That last part is the expensive unknown. The bulk endpoint prices every fixture
at once for [markets x regions] credits; the per-event endpoint charges the same
again *for each fixture*. A market that turns out to be per-event only costs
roughly ten times what it looks like it costs over a gameweek. So the probe does
not just list market keys — it tries the calls and reads the meter.

api.the-odds-api.com is unreachable from the dev sandbox (the egress proxy
answers 403 to CONNECT), and the key lives in an Actions secret, so a runner is
the only place any of this can be asked.

Three phases, each printing x-requests-last / -used / -remaining per call:

  1. /events/{id}/markets  — which market keys each bookmaker has open
  2. /odds                 — does the BULK endpoint accept the candidate market
                             set, or does it reject the additional markets?
  3. /events/{id}/odds     — what per-event pulls actually return, and cost:
                             the candidate markets, the team-totals fix, and
                             player props in both regions

Env:
  ODDS_API_KEY        required
  PROBE_REGIONS       phase 1 regions, default "uk,us"
  PROBE_BULK_MARKETS  phase 2 candidate set, default "h2h,totals,alternate_totals,btts"
  PROBE_PHASES        subset of "1,2,3", default all
"""
import json
import os
import sys
import urllib.error
import urllib.request

HOST = "https://api.the-odds-api.com/v4/sports/soccer_epl"

# What refresh_odds.py already consumes, so the output says what is *new*.
IN_USE = {"h2h", "spreads", "totals", "team_totals"}

# Phase 3: (region, markets) pulls worth pricing. Player props are split by
# region because UK and US books quote different ones, and the FPL-relevant
# ones (saves, cards) only showed up under us in phase 1.
PER_EVENT_PULLS = [
    ("uk", "btts,alternate_totals"),
    ("us", "team_totals,alternate_team_totals"),
    ("uk", "player_goal_scorer_anytime,player_shots_on_target,player_assists"),
    ("us", "player_goal_scorer_anytime,player_shots_on_target,player_goals_alternate,"
           "player_goalie_saves_alternate"),
]

KEY = os.environ.get("ODDS_API_KEY", "").strip()
SUMMARY = []          # markdown lines for the job summary
SPEND = []            # (label, cost, used, remaining)


def redact(s):
    """Never let the key reach a log line. urllib puts the failing URL into
       some of its error strings, and job logs are readable by anyone with
       read access to the repo."""
    s = str(s)
    return s.replace(KEY, "***") if KEY else s


def say(line, summary=True):
    print(line, flush=True)
    if summary:
        SUMMARY.append(line)


def meter(label, headers):
    cost = headers.get("x-requests-last", "?")
    used = headers.get("x-requests-used", "?")
    left = headers.get("x-requests-remaining", "?")
    SPEND.append((label, cost, used, left))
    print(f"  [{label}] cost {cost} | used {used} | remaining {left}", flush=True)


def get(url, label):
    """Returns the parsed body, or None on an HTTP error — whose body carries
       the API's own explanation (INVALID_MARKET and friends), which is the
       whole point of phase 2. A rejected request still reports the meter, so
       the run also shows whether a failed call is charged for."""
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-odds"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body, headers = json.loads(r.read()), dict(r.headers)
        meter(label, headers)
        return body
    except urllib.error.HTTPError as e:
        detail = redact(e.read().decode("utf-8", "replace"))[:300]
        meter(f"{label} [HTTP {e.code}]", dict(e.headers))
        say(f"- `{label}` — **HTTP {e.code}**: {detail}")
        return None
    except Exception as e:
        say(f"- `{label}` — failed: {redact(e)}")
        return None


# ── phase 1: which market keys are open ─────────────────────────────────────
def pick_event():
    """Nearest fixture the API knows about. /events carries no prices, so it
       is the cheapest way to get an id — the printed cost says how cheap."""
    events = get(f"{HOST}/events?apiKey={KEY}", "/events")
    if not events:
        sys.exit("no upcoming EPL events — nothing to probe")
    ev = sorted(events, key=lambda e: e.get("commence_time", ""))[0]
    say(f"Probing **{ev['home_team']} v {ev['away_team']}** "
        f"({ev.get('commence_time')}), of {len(events)} upcoming fixtures.")
    return ev


def phase1(event_id, regions):
    for region in regions:
        payload = get(f"{HOST}/events/{event_id}/markets?apiKey={KEY}&regions={region}",
                      f"/events/{{id}}/markets regions={region}")
        books = payload.get("bookmakers") if isinstance(payload, dict) else None
        if not books:
            say(f"\n### regions=`{region}` — no bookmakers returned")
            continue
        offered = {}
        for bk in books:
            for mk in bk.get("markets", []):
                offered.setdefault(mk.get("key"), set()).add(bk.get("title") or bk.get("key"))
        say(f"\n### regions=`{region}` — {len(books)} bookmakers, {len(offered)} market keys")
        say("")
        say("| market key | bookmakers | status |")
        say("|---|---|---|")
        for k in sorted(offered, key=lambda k: (-len(offered[k]), k)):
            say(f"| `{k}` | {len(offered[k])} | "
                f"{'already used' if k in IN_USE else '**not used**'} |")


# ── phase 2: does the bulk endpoint serve the candidate markets? ─────────────
def phase2(markets, region="uk"):
    """The question that decides the whole design. If the bulk /odds endpoint
       accepts btts and alternate_totals, they cost 1 credit each per day. If
       it rejects them as additional markets, the same data costs 1 credit each
       *per fixture* — ten times more over a gameweek."""
    say(f"\n## Bulk endpoint with `{markets}` (regions={region})")
    payload = get(f"{HOST}/odds/?apiKey={KEY}&regions={region}&markets={markets}"
                  f"&oddsFormat=decimal", f"/odds markets={markets}")
    if payload is None:
        say("\nBulk endpoint **rejected** the set — these are per-event markets.")
        return
    got = {}
    for ev in payload:
        for bk in ev.get("bookmakers", []):
            for mk in bk.get("markets", []):
                got.setdefault(mk.get("key"), set()).add(bk.get("key"))
    say(f"\nBulk endpoint **accepted** the set: {len(payload)} fixtures priced.")
    say("")
    say("| market key | bookmakers quoting it |")
    say("|---|---|")
    for k in sorted(got, key=lambda k: -len(got[k])):
        say(f"| `{k}` | {len(got[k])} |")
    missing = [m for m in markets.split(",") if m not in got]
    if missing:
        say(f"\nAccepted but returned nothing for: {', '.join(f'`{m}`' for m in missing)}")


# ── phase 3: what a per-event pull actually returns ──────────────────────────
def phase3(event_id):
    for region, markets in PER_EVENT_PULLS:
        say(f"\n## Per-event `{markets}` (regions={region})")
        payload = get(f"{HOST}/events/{event_id}/odds?apiKey={KEY}&regions={region}"
                      f"&markets={markets}&oddsFormat=decimal",
                      f"/events/{{id}}/odds markets={markets} regions={region}")
        if not isinstance(payload, dict):
            continue
        per_market = {}
        for bk in payload.get("bookmakers", []):
            for mk in bk.get("markets", []):
                d = per_market.setdefault(mk.get("key"), {"books": set(), "outcomes": [], "n": 0})
                d["books"].add(bk.get("title") or bk.get("key"))
                d["n"] += len(mk.get("outcomes", []))
                d["outcomes"].extend(mk.get("outcomes", [])[:2])
        if not per_market:
            say("\nNothing returned — no bookmaker in this region quotes these for this fixture.")
            continue
        say("")
        say("| market key | books | outcomes | sample |")
        say("|---|---|---|---|")
        for k, d in sorted(per_market.items()):
            sample = "; ".join(
                f"{o.get('description') or ''} {o.get('name')}"
                f"{' ' + str(o['point']) if o.get('point') is not None else ''} @ {o.get('price')}".strip()
                for o in d["outcomes"][:2])
            say(f"| `{k}` | {len(d['books'])} | {d['n']} | {sample} |")


if __name__ == "__main__":
    if not KEY:
        sys.exit("ODDS_API_KEY is not set — this probe has to run where the secret is")

    phases = {p.strip() for p in os.environ.get("PROBE_PHASES", "1,2,3").split(",")}
    ev = pick_event()

    if "1" in phases:
        phase1(ev["id"], [r.strip() for r in
                          os.environ.get("PROBE_REGIONS", "uk,us").split(",") if r.strip()])
    if "2" in phases:
        phase2(os.environ.get("PROBE_BULK_MARKETS", "h2h,totals,alternate_totals,btts"))
    if "3" in phases:
        phase3(ev["id"])

    say("\n## What the probe itself cost")
    say("")
    say("| call | cost | used this month | remaining |")
    say("|---|---|---|---|")
    for label, cost, used, left in SPEND:
        say(f"| `{label}` | {cost} | {used} | {left} |")

    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write("## The Odds API — markets, endpoints and what they cost\n\n"
                    + "\n".join(SUMMARY) + "\n")
