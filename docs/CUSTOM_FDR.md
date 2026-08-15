# Customisable fixture difficulty — design note

A reader asked for it. It is a good idea and it is not a small one, because
fixture difficulty is not a display value on this site: it is an input to the
projection. What follows is the thinking, not a commitment.

## The question underneath the request

"Customise the FDR" means three different things, and they cost very different
amounts:

1. **Re-rate a club.** *"Newcastle's defence is better than you have it."* One
   opinion, thirty-eight fixtures affected — every game against them, home and
   away, all season.
2. **Re-rate a fixture.** *"Arsenal away in GW7 is worse than a 4, they have a
   European tie three days before."* A long tail of one-offs.
3. **Re-weight the model.** *"Count home advantage for more."* A modelling
   exercise, not a preference.

(1) is where nearly all the value is, and it is the cheapest to build: twenty
numbers. (2) is worth having as an exception list. (3) is not a user feature.

## The decision that matters: fixtures only, or everywhere?

This site's fixture difficulty is not just a colour. It feeds:

- the Fixtures page and its run ratings
- the season spine and the squad's fixture views
- **`xpForGw` — the projection itself**, through the same team strengths that
  set the goal lambdas and the clean-sheet probability

So a custom FDR that only recolours the Fixtures page would be a toy, and worse
than a toy: the reader would set Newcastle to *easy*, watch the cells turn
green, and find the projection underneath unmoved. The site would be showing
two contradictory opinions about the same fixture on the same screen. Nobody
would trust either.

If it feeds the projection, it feeds everything — clean sheets, captaincy, the
squad rating, plan comparison. That is the honest version, and it has
consequences worth accepting deliberately rather than discovering later:

- **Anything shared stops being the site's claim.** A share image or a plan
  comparison built on private assumptions has to say so, or be built on house
  numbers.
- **Anything editorial must stay on house numbers.** If the GW Preview says
  Haaland is the captain, that is the site's opinion and has to remain the
  site's opinion. Same for Scouting, Team of the Week, and any copy that reads
  as a claim rather than as a calculation.
- **"Your xP is wrong" becomes unanswerable** without knowing what the reader
  changed. The UI has to make the override visible, always.

### The split

| Layer | Used by | Editable |
|---|---|---|
| **House ratings** | GW Preview, Scouting, Team of the Week, everything published or shared | no |
| **Your ratings** | Fixtures, Squad Builder, Compare Plans, Captaincy | yes |

Off by default. Unmistakable when on. One click to reset.

## Edit the input, not the output

The obvious build is a 1–5 box per fixture that the reader can type over. It is
the wrong one, for the reason above: xP does not consume an FDR scalar, it
consumes team strengths and market odds. Overriding the number on the screen
would leave the number underneath alone.

So the override belongs on **team strength**, not on fixture difficulty:

- Two dials per club — **attack** and **defence** — as a bounded delta, not an
  absolute. Say ±2 on the site's own 0–100 scale, or ±25% on a lambda.
- **FDR is derived from those strengths**, so one edit recolours every fixture
  against that club, home and away, for the rest of the season, without the
  reader touching thirty-eight cells.
- The same strengths already feed the goal lambdas, so clean-sheet odds, goals
  conceded and xP all move with it — consistently, because there is one source.

That is the whole trick. Editing the output is colouring-in. Editing the input
is a model, and the model stays coherent for free.

Per-fixture overrides (case 2) then sit on top as a small exception list — a
trap game, a rotation risk before a European tie — affecting that fixture's
difficulty and that week's projection only.

## Details that decide whether it feels honest

- **Store deltas, not absolutes**, keyed by club. The house model refreshes
  several times a day; a stored absolute would freeze a stale opinion, while a
  delta keeps applying as *the reader's disagreement with today's number*.
- **Show the house value beside theirs.** Always answerable: what did I change,
  and by how much.
- **Bound it.** ±2 is a strong opinion. Unbounded input produces a projection
  nobody should act on and the site should not print.
- **Mark every affected number.** A small "your ratings" chip wherever a
  projection is running on overrides, and either strip them from share exports
  or stamp the picture.
- **Reset must be one control**, not twenty.

## A cheaper first version

If the full thing is too much for one pass: ship the delta layer for **defence
only**, on **Fixtures and Squad Builder only**, with a global on/off and a
reset. Defence is the bigger lever — it drives clean sheets and it drives the
difficulty of every fixture against that club — and one dial is a much smaller
surface to get right than two across four pages. Learn from it, then decide
whether attack is worth adding.
