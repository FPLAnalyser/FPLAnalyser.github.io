#!/usr/bin/env python3
"""
fpl_notify.py — detect price-change and injury/status deltas from the FPL API and
emit the alerts to push. Runs as a scheduled job (cron / GitHub Actions), NOT in
the app: price rises and injury news are data the phone can't know while
backgrounded, so they need a server-side diff + remote push (FCM / APNs).

What it does now (no credentials required):
  - fetch bootstrap-static
  - diff each player's `now_cost` and `status`/`news` against the last snapshot
  - print the alerts as JSON and save the new snapshot

To actually deliver them, plug `send_push()` into FCM/APNs and fan out to the
device tokens you collect (see docs/NOTIFICATIONS.md). Suggested cadence: hourly
in-season, plus a tighter run around ~01:30 UK when prices change.

Usage:
  python3 fpl_notify.py            # diff + print alerts, update snapshot
  python3 fpl_notify.py --init     # take the first snapshot, emit nothing
"""
import json
import os
import sys
import urllib.request

API = "https://fantasy.premierleague.com/api/bootstrap-static/"
SNAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".fpl_notify_snapshot.json")

# FPL `status`: a=available, d=doubtful, i=injured, s=suspended, u=unavailable, n=not in squad
STATUS_LABEL = {"a": "available", "d": "a doubt", "i": "injured", "s": "suspended", "u": "unavailable", "n": "out of the squad"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-notify"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def snapshot(elements):
    return {str(e["id"]): {"cost": e["now_cost"], "status": e.get("status"), "name": e["web_name"]} for e in elements}


def build_alerts(prev, cur):
    """Return a list of {type, element, name, title, body} alerts from the diff."""
    alerts = []
    for eid, now in cur.items():
        was = prev.get(eid)
        if not was:
            continue
        # Price change
        if was["cost"] != now["cost"]:
            up = now["cost"] > was["cost"]
            alerts.append({
                "type": "price_rise" if up else "price_fall",
                "element": int(eid),
                "name": now["name"],
                "title": f"{now['name']} {'rose' if up else 'dropped'} to £{now['cost']/10:.1f}m",
                "body": ("Buyers are in — grab them before the next rise." if up
                         else "Selling? Do it before it falls further."),
            })
        # Availability / injury change
        if was["status"] != now["status"]:
            s = now["status"]
            alerts.append({
                "type": "status",
                "element": int(eid),
                "name": now["name"],
                "title": f"{now['name']} is now {STATUS_LABEL.get(s, s)}",
                "body": "Check your team before the deadline.",
            })
    return alerts


def send_push(alert, tokens):
    """Deliver one alert to a set of device tokens. STUB — wire to FCM/APNs.
    Only fan an alert out to the tokens that actually own/watch that player
    (join `alert['element']` against your token→watchlist store)."""
    # Example FCM shape (needs a server key + the firebase-admin SDK):
    #   from firebase_admin import messaging
    #   messaging.send_multicast(messaging.MulticastMessage(
    #       tokens=tokens, notification=messaging.Notification(alert['title'], alert['body'])))
    return


def main():
    init = "--init" in sys.argv
    cur = snapshot(get(API)["elements"])

    prev = {}
    if os.path.exists(SNAP):
        with open(SNAP) as f:
            prev = json.load(f)

    alerts = [] if (init or not prev) else build_alerts(prev, cur)

    with open(SNAP, "w") as f:
        json.dump(cur, f)

    print(json.dumps({"count": len(alerts), "alerts": alerts}, indent=2))
    # for a in alerts: send_push(a, tokens_for(a["element"]))


if __name__ == "__main__":
    main()
