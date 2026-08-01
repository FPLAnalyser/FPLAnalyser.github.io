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

### Mobile audit — what the sweep found after Fixtures
Measured on an iPhone 13 across all eleven routes. Three clean results worth
recording so nobody re-checks them: **zero page-level horizontal overflow
anywhere**, **nothing hidden behind the bottom bar** at the end of any page,
and **no console errors** on any route.

What is left, in the order it costs readers:

**The Players leaderboard hides 408px.** The table is 776px inside a 368px
column, so 4GW Rating, Pts, PPG and xPts are entirely off-screen behind a
hidden scrollbar, and the Season rating badge sits clipped at the right edge.
This is the same fault the fixtures grid had, on the most-used page on the
site — and the same answer applies: below `lg` the row should carry the two or
three numbers that matter with the rest behind a tap, rather than a table
nobody can see the right half of.

**The market scatter on a player page hides 238px** (540px in 302px). A chart
that has to be dragged sideways on a phone is a chart most people never see the
right-hand side of; it wants a mobile aspect rather than a scroll.

**Info tips are 14×14px.** Eleven of them on Players alone, three on GW Preview.
Below the 24px anyone would call a minimum and well under the 44px that is
comfortable. They carry the explanations the whole site is built on, so they
are worth hitting.

**Body text bottoms out at 9.5–10px** on GW Preview, player pages, Teams,
Squad Builder and Legal — captions like "Biggest attack", "Projected points",
"Leaves your browser". Legible on a desk, marginal on a phone in daylight.

**The pre-season banner's dismiss is 24×24px**, on every page until it is
dismissed.

Minor: the Legal tab strip scrolls 133px, which is a tab bar doing what tab
bars do. One run saw a 542px scroller on GW Preview that four later probes
could not reproduce — worth a second look rather than a fix.

### Load a squad into the Squad Builder without typing it
Fifteen players entered by hand is a lot of taps before the builder gives
anything back, and it is the main reason someone bounces off it.

**Team ID first.** My Team already reads a live squad through the Worker
(`fetchPicksCached`), which is exact rather than inferred and is already built
and tested. Feeding that into the builder's state is a small piece of work and
gets a perfect fifteen every time. Do this one.

**Then, maybe, the screenshot.** Upload a screenshot from the FPL app and have
it read the squad — nice magic, and worth having if people ask. Tesseract.js in
the browser is roughly 2MB of WASM, which is real weight for a route that also
has to work on a phone. The hard part is not reading the text: FPL screenshots
vary by device, theme, scroll position and language, surnames truncate on the
pitch, and a misread substitutes the wrong player *silently*, which is worse
than failing. It needs a confirm-and-correct step, and that step eats a good
deal of the convenience it was bought for. Not before launch.

### The rest of the stadium photos
`StadiumBanner` on a club page loads `public/stadiums/<TEAM>.jpg` over a
club-tinted floodlit bowl, and falls back to the bowl alone when the file is
missing. Six of the twenty are present (ARS, CHE, FUL, LIV, MUN, TOT), so the rest open on the generated
gradient — fine, but the ones with a real photo are visibly better and the
inconsistency is more noticeable than either state would be on its own.

Same rules as `public/home/README.md`: landscape, crop before dropping the file
in rather than leaving it to `object-fit`, around 1600px wide, compressed to
roughly 300KB, and licensed. The banner prints the club name over the image, so
avoid anything with its own lettering. Credit the source in the README.

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
