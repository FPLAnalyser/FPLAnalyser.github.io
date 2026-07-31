# Backlog

Things worth doing that are deliberately **not** blocking launch. Ordered by
what would move the site most, not by effort.

`NEXT_PHASE_PLAN.md` predates the React rebuild — it still discusses splitting
`index.html` and staying on vanilla JS. Treat it as history, not as a plan.

---

## Product

### Expected starting XI on club pages
Each club page should project its likely eleven. Most of the machinery exists:
the GW Preview already works out who is in the first-choice line and who gets
promoted when one of them is out (`STARTERS` in `Preview.tsx`, `penaltyDuty` in
`availability.ts`), driven by minutes, availability flags and position counts.

Say what it is and is not, the way the rest of the site does: it is a
projection from minutes and availability, not a team sheet. Nobody else in this
space is honest about that distinction and it is cheap to be.

### The GW Review page — content
The route, the nav link, the home tile and the pre-GW1 holding state now exist
(`pages/Review.tsx`, `/review`). What does not exist is the thing itself: the
page lists its six intended sections and says it switches on after gameweek 1,
which is honest but is not content.

It cannot be built against real data until a gameweek has been played, so the
work between now and then is layout — the same job as My Team. The six sections
the page already promises are the spec: team of the week, the captain call,
points against expected goals, **where the model missed**, ownership swings,
and the handoff into the next GW Preview.

Publishing the misses is the most trust-building thing this site could do, and
the thing established rivals cannot copy without undermining themselves.

`public/sitemap.xml` deliberately does not list `#/review` yet — there is no
reason to send a crawler to a holding page. Add it when the content lands.
There is no `public/home/review.jpg` either; the tile and banner run on the
branded `.hw-review` gradient (`noPhoto` / `photo={false}`).

### Price and injury push notifications
`fpl_notify.py` exists and the deadline reminders already work on-device. Price
rises and status changes are data deltas a backgrounded phone cannot see, so
they need a server that diffs the FPL API and sends remote push. See
`docs/NOTIFICATIONS.md`. This is the single biggest retention lever left.

---

## Housekeeping

### Frost and Verdant accents are withdrawn, not deleted
Both still exist in `ALL_ACCENTS` and keep their token blocks in `index.css`.
Widening the `ACCENTS` filter in `lib/theme.tsx` brings them and the picker
back with no other edit.

### 115MB of dead PNG blobs in git history
From the first mirror attempt, before the images were converted to 300px WebP.
Harmless to the site, wasteful on clone. Needs a history rewrite and a
force-push; the working tree is already correct.

### The squad share card is cramped on a phone
It renders at 358px inside a modal designed for 560, which is why names
truncate and rows sit unevenly. The export is faithful — measured at zero
percent reflow — so this is a card design question, not a capture one. Pinning
the card to 560 and letting the modal scroll would fix it at the cost of a
horizontally scrolling preview.

### `probe-photo-buckets.yml`
A one-off diagnostic whose own comment says to delete it once the answer is
settled. It is settled. Manual-dispatch only, so it costs nothing to leave.

---

## Commercial — deliberately parked

Premium is scaffolded and off (`PREMIUM_ENABLED = false` in `lib/premium.ts`);
the gates are placed and pass through until flipped. `docs/MONETISATION.md` has
the reasoning: grow the weekly habit for a season first. Revisit after a real
audience exists, not before.
