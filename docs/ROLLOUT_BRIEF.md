# Rollout brief — the prompt to hand to a marketing/commercial project

Copy everything below the line into a fresh project and let it work from there.
It is written to be self-contained: someone reading only that text should be
able to plan the launch without seeing the codebase.

Keep it current. The feature list is the part that rots fastest — if a section
of the site changes, change it here, or the brief starts confidently describing
a product that no longer exists.

---

# BRIEF: take FPL Analyser to market

You are my marketing and commercial strategist. I have built an FPL analytics
site, it is live, and I need a rollout plan. Below is everything about the
product, the constraints, and where things stand. Ask me questions where the
answer would change your recommendation; otherwise make the call and tell me why.

## The hard deadline

Today is **30 July 2026**. The Gameweek 1 deadline is **21 August 2026,
18:30 BST** — 22 days.

This matters more than anything else in this brief. Pre-season is the highest-
intent window in the FPL calendar: every manager picks an initial squad in the
fortnight before GW1, and search traffic, Reddit activity and YouTube views for
FPL content peak there and do not return to that level until the following July.
A launch that lands in September is a launch into a closed window — the squads
are picked, the habits are formed, and the audience is no longer looking for a
new tool.

Plan on the assumption that **the pre-GW1 fortnight is the whole opportunity**
and everything after it is retention.

## What the product is

**FPL Analyser** — `fplanalyser.co.uk`. A free Fantasy Premier League analytics
site. No accounts, no login, no ads, no analytics, no cookies, no tracking. Runs
in any browser, installs as a PWA, and there is a Capacitor wrapper ready for
iOS/Android store builds.

The core idea, and the thing that differentiates it: **it shows its working.**
Every number decomposes into the inputs that produced it. Nothing is asserted.

## What the site can do — complete inventory

### GW Preview (`/preview`) — the flagship page
Designed from the start to be screenshotted. One screen, the whole gameweek.
- Deadline countdown strip and a visible "data last refreshed" timestamp
- **The round at a glance** — biggest attack, safest clean sheet, goal-fest,
  best differential; each with the key player or club named
- **Captain podium** — The pick / The challenger / The outsider, with reasoning
- **Team news** — live injuries and suspensions with expected return dates,
  where "return" means the fixture he is back for, not a vague date
- **Who steps up** — when a starter is out, the model names the replacement,
  including penalty and set-piece promotion (if the first-choice taker is
  injured, it names the next man up and says why)
- **Every fixture** — expandable cards with projected goals, clean-sheet
  probability, both clubs' form, and correct home/away kit colours
- Every section exports its own branded share image

### Players (`/player`) — the editorial brief
- Search any Premier League player
- A written verdict, not just a number
- Tabs: **Points engine**, **Dimensions**, **Matchups**, **Shot zones**
- xGI, upcoming fixtures, shot maps
- A "rating receipt" that shows exactly how the 0–100 was built

### Rankings (`/players`) — ten leaderboards
Top Rated · xPoints · Goal Threats · Creators · Clean Sheets · Goalkeepers ·
Def Con · Value Picks · Form · Transfers. Filterable by GKP/DEF/MID/FWD, with
the underlying metric columns visible on every row.

### Compare (`/compare`)
Any two players head-to-head across Goal Threat, Creativity, Clean Sheet,
Def Con, Value and Form.

### Teams (`/teams`)
- Three views: club cards, sortable table, league map
- Attack, Defence and Set-piece xG ratings
- Windows: Season / Last 6 / Last 4 gameweeks
- Trend reads: attack rising, attack falling, defence tightening
- Per-club pages with shot maps

### Fixtures (`/fixtures`)
- **Difficulty** grid, over configurable horizons
- **Best Runs** — the best stretch of fixtures for every club, and when to jump
- **Rotation Planner**
- **Matchup Explorer**
- Three lenses: raw difficulty, projected xG, clean-sheet probability — each
  splittable by Overall / Attack / Defence

### Scouting (`/scout`)
Percentile-based discovery. Season / Last 6 / Last 4 windows, Compare and
Discover modes, filters across every stored metric.

### Squad Builder (`/squad`)
- Build a full 15 on a formation pitch with bench
- Gameweek scroller — plan week by week across the season
- Toggle every card between **Rating**, **£** and **xP**
- Per-gameweek expected points
- Drill into any rating and read the narrative behind it
- Share the squad as an image

### My Team (`/loadteam`)
- Enter an FPL team ID, get your actual squad rated
- Squad & Report — captain, transfers, risk
- Mini-league view
- Manager gameweek card
- Team of the Week

### Cross-cutting
- **0–100 player rating**, availability-adjusted, decomposed into inspectable
  dimensions with exact percentiles
- **Expected-points model** per gameweek
- **Live data layer** — injuries, suspensions, penalty and set-piece order,
  price changes, deadlines — refreshed automatically every morning
- **Odds-derived projections** — projected goals and clean-sheet odds computed
  from bookmakers' prices; derived figures only, never the prices themselves
- **Share images from every section** — each carries the wordmark, the web
  address, and the X and Instagram handles
- Three colour themes, light and dark
- Season archive (2025/26 and 2026/27)
- Installable PWA, works offline
- Native app scaffolded (Capacitor); local deadline notifications already built

## Commercial position today

- **Free. Everything.** No paywall is active.
- A tip jar is wired but **not yet switched on** — it needs a Ko-fi URL.
  Deliberately a plain outbound link, never an embedded widget, so the site
  keeps its no-tracker position.
- Premium is **scaffolded but off** (`PREMIUM_ENABLED = false`). The gates are
  already placed in the code and pass through until flipped. Planned tier, not
  committed: ~£14.99/season for price and injury alerts, unlimited watchlist,
  full team report, advanced rotation and chip planning, ad-free.
- The stated plan is: grow a weekly habit for a full season, then charge.
  Challenge this if you disagree.

## Competitive landscape

Fantasy Football Scout (~£25/season, the incumbent, a decade of brand),
FPL Review, FPL Hub, Fantasy Football Fix, plus a large free layer — r/FPL,
YouTube creators, and Twitter/X analysts.

My current thinking, which you should pressure-test: competing on price is the
weakest ground available, because an incumbent can match it for one season and
absorb the loss, and because their real moat is writers, podcast and community
rather than tooling. The differentiation I believe in is **transparency** — a
model you can audit rather than opinion from named experts — and the sharpest
expression of it is **publishing the model's misses**, which nobody selling
certainty can do.

Tell me if that is right, wrong, or right but insufficient.

## Hard constraints — do not plan around these

1. **My identity stays off the site entirely.** No real name, no personal
   email, no personal social accounts, no "founder story", no face on camera in
   any content that names me. The brand is `FPL Analyser` and nothing else.
   Contact is a role address. Any plan that depends on a personal brand is a
   plan I cannot execute.
2. **No Premier League or club trade marks in the logo, favicon, app icon or
   social avatar.** Crests may identify a club inside the product (nominative
   use); they may not become brand assets. No copying the PL's typography or
   colour system, no implying partnership.
3. **No bookmaker links, affiliate deals or tipping.** The site converts odds
   into projections, which is analysis. A single bookmaker link pulls in
   Gambling Commission licensing, CAP Code advertising rules and age-gating.
   This is a hard no, however good the revenue looks.
4. **Adding analytics or any third-party embed triggers a cookie-consent
   requirement** under PECR, and the site currently needs no banner because it
   stores nothing beyond strictly-necessary preferences. If you recommend
   analytics, price in the consent mechanism and say whether it is worth it.
5. **The FPL API is undocumented and tolerated, not licensed.** Keep request
   volume low, never resell the raw feed. Do not build a plan whose survival
   depends on that access continuing.
6. **UK-based sole individual.** ICO data-protection fee may apply (~£40–52/yr).
   Tips are generally trading income; HMRC's £1,000 trading allowance covers a
   first season for most people. If you propose revenue, flag the threshold.
7. **Odds redistribution.** Publishing derived projections is safe; republishing
   the prices themselves may breach the provider's terms. Keep it derived.

## Existing assets

- `@FPLAnalyser` on X and `fpl_analyser` on Instagram — already burned into
  every share image the site produces, so any screenshot carries them.
- Every section of the site exports a clean, branded image in one tap. Content
  production is close to free: the product *is* the content pipeline.
- Working data pipeline that refreshes daily without intervention.

## What I want from you

1. **A day-by-day plan for the 22 days to the GW1 deadline**, specific enough to
   execute. Which channel, which day, which post, sourced from which page of the
   site. Assume I can produce any screenshot from the product in seconds and
   cannot produce studio video or appear on camera.
2. **The launch-day sequence** — exact posts, exact order, what goes first, and
   where the link appears.
3. **The seeding strategy before launch day.** Specifically: what is the right
   way to appear in r/FantasyPL, FPL Discords and YouTuber comment sections
   without getting banned for self-promotion, given that community's strong
   allergy to it. Be concrete about rules, ratios and what to do if a post gets
   removed.
4. **A weekly content rhythm for the season** keyed to the gameweek cycle —
   deadline minus 3, minus 2, minus 1, post-gameweek, midweek — that I can
   sustain alone, indefinitely, without burning out.
5. **A positioning statement and a one-line pitch** I can put in a bio, a Reddit
   comment and a video description. Give me three options with trade-offs.
6. **A commercial model with numbers.** Realistic conversion rates, realistic
   revenue at realistic traffic. Tell me honestly whether the "free for a season,
   then charge" plan is right, or whether it wastes the only launch window I get.
   If you recommend charging sooner, say exactly what goes behind the wall and
   what must stay free.
7. **The metrics that actually matter** given I have no analytics and no
   accounts — what can I even measure, what is worth measuring, and is the
   privacy position worth the blindness?
8. **The failure modes.** What most plausibly kills this in the first month, and
   what is the cheapest insurance against each.

Be direct. If part of my plan is wrong, say so and say why. I would rather be
told now than in September.
