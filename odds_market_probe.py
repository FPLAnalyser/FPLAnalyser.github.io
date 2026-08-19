#!/usr/bin/env python3
"""odds_market_probe.py — ask The Odds API what it actually offers, and what it costs.

Diagnostic only. Reads nothing, writes nothing, commits nothing.

`refresh_odds.py` requests h2h + spreads + totals, and team totals per event.
Whether anything else is quoted for a Premier League fixture — both teams to
score, alternate lines, player props — has only ever been answered from the
published market list, which documents what the API *supports*, not what a
bookmaker has open for the next Everton game. The two differ: coverage varies
by sport, by region and by how close kick-off is.

api.the-odds-api.com is unreachable from the dev sandbox (the egress proxy
answers 403 to CONNECT), and the key lives in an Actions secret, so the only
place this question can be asked is a runner. Hence a workflow rather than a
script anyone can run locally.

Two calls per region against /events/{id}/markets, which reports the market
keys each bookmaker currently has open for one event. Every response's
x-requests-last / -used / -remaining is printed, so the run also measures what
each endpoint costs instead of assuming — the same headers refresh_odds.py
reads to decide whether it can afford team-totals enrichment.

Env:
  ODDS_API_KEY    required
  PROBE_REGIONS   comma-separated, default "uk,us" (uk is what the site uses;
                  us is where soccer player props are said to live)
"""
import json
import os
import sys
import urllib.error
import urllib.request

HOST = "https://api.the-odds-api.com/v4/sports/soccer_epl"

# What refresh_odds.py already consumes, so the output says what is *new*.
IN_USE = {"h2h", "spreads", "totals", "team_totals"}

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


def get(url, label):
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-odds"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read())
        h = dict(r.headers)
    cost = h.get("x-requests-last", "?")
    used = h.get("x-requests-used", "?")
    left = h.get("x-requests-remaining", "?")
    SPEND.append((label, cost, used, left))
    print(f"  [{label}] cost {cost} | used {used} | remaining {left}", flush=True)
    return body


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


def markets_for(event_id, region):
    """Market keys each bookmaker currently has open, for one event."""
    try:
        return get(f"{HOST}/events/{event_id}/markets?apiKey={KEY}&regions={region}",
                   f"/events/{{id}}/markets regions={region}")
    except urllib.error.HTTPError as e:
        say(f"\n### regions=`{region}` — HTTP {e.code}: {redact(e.reason)}")
        return None
    except Exception as e:                      # network, JSON, anything
        say(f"\n### regions=`{region}` — failed: {redact(e)}")
        return None


def report(region, payload):
    books = payload.get("bookmakers") if isinstance(payload, dict) else None
    if not books:
        say(f"\n### regions=`{region}` — no bookmakers returned")
        say(f"\nRaw response (first 800 chars):\n\n```\n{redact(json.dumps(payload))[:800]}\n```")
        return set()

    offered = {}                                 # market key -> bookmakers offering it
    for bk in books:
        for mk in bk.get("markets", []):
            offered.setdefault(mk.get("key"), set()).add(bk.get("title") or bk.get("key"))

    say(f"\n### regions=`{region}` — {len(books)} bookmakers, {len(offered)} market keys")
    say("")
    say("| market key | bookmakers | status |")
    say("|---|---|---|")
    for k in sorted(offered, key=lambda k: (-len(offered[k]), k)):
        status = "already used" if k in IN_USE else "**not used**"
        say(f"| `{k}` | {len(offered[k])} | {status} |")
    return set(offered)


if __name__ == "__main__":
    if not KEY:
        sys.exit("ODDS_API_KEY is not set — this probe has to run where the secret is")

    regions = [r.strip() for r in os.environ.get("PROBE_REGIONS", "uk,us").split(",") if r.strip()]
    ev = pick_event()

    seen = {}
    for region in regions:
        payload = markets_for(ev["id"], region)
        if payload is not None:
            seen[region] = report(region, payload)

    new = sorted(set().union(*seen.values()) - IN_USE) if seen else []
    say("\n### Not currently consumed")
    say("")
    say(", ".join(f"`{k}`" for k in new) if new
        else "nothing beyond what refresh_odds.py already requests.")

    say("\n### What the probe itself cost")
    say("")
    say("| call | cost | used this month | remaining |")
    say("|---|---|---|---|")
    for label, cost, used, left in SPEND:
        say(f"| `{label}` | {cost} | {used} | {left} |")

    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write("## The Odds API — markets actually on offer\n\n" + "\n".join(SUMMARY) + "\n")
