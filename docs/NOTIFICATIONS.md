# Notifications

Two tiers, split by what the phone can know on its own.

## 1. Deadline reminders — DONE (on-device, no backend)
`src/lib/notifications.ts` schedules a local notification 2h before every
upcoming gameweek deadline, straight from the FPL fixture calendar. It runs in
the native app only, is requested during onboarding
(`src/components/AppOnboarding.tsx`), and re-schedules on each launch. No server,
no credentials, works offline. This is the universal "never miss a deadline"
alert and it's the biggest single retention lever — already live.

## 2. Price & injury alerts — needs a small backend
Price rises/falls and injury/status changes are **data deltas** the device can't
detect while backgrounded, so they need a server that diffs the FPL API and
sends **remote push** (FCM for Android, APNs for iOS — both reachable through
[Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)).

### Pieces
1. **Delta job** — `fpl_notify.py` (already here). Fetches `bootstrap-static`,
   diffs `now_cost` and `status`/`news` vs a saved snapshot, emits alert
   payloads. Run it on a schedule (GitHub Actions cron / any host): hourly
   in-season, plus a run around **01:30 UK** when prices change.
2. **Token registry** — when a user opts in, register their push token +
   watchlist/owned players (Team ID) in a tiny store (Firestore / a KV / a small
   Postgres). Client side: add `@capacitor/push-notifications`, call
   `PushNotifications.register()`, POST the token.
3. **Fan-out** — for each alert, look up the tokens whose watchlist/owned set
   includes `alert.element`, and send via `send_push()` (stub in the script —
   drop in `firebase-admin`). Only notify people who care about that player.

### Client registration sketch (native only)
```ts
import { PushNotifications } from '@capacitor/push-notifications'
if (isNative()) {
  await PushNotifications.requestPermissions()
  await PushNotifications.register()
  PushNotifications.addListener('registration', (t) =>
    fetch('https://YOUR_API/register', { method: 'POST', body: JSON.stringify({ token: t.value, teamId }) }))
}
```

### Minimal hosting
The cheapest path: **Firebase** (FCM + Firestore for tokens) + a **GitHub Action
cron** running `fpl_notify.py`. No always-on server, ~free at this scale.

## Roadmap of alert types (highest retention first)
1. ⏰ Deadline (done)
2. 💰 Price rise/fall for owned/watched players
3. 🚑 Injury / didn't-start / flagged for your XI
4. ©️ Captaincy nudge (the model's pick, deadline morning)
5. 📈 Mini-league overtaken (once My Team is live in-season)
