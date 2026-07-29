# Going live — compliance, launch checks, and the release plan

Written for a UK-based, free, independent site with no accounts and no ads.

> **Not legal advice.** This is a working checklist of what applies and where to
> look. The two things most likely to cost you money if ignored are marked
> **must**; have the rest sanity-checked by someone qualified before launch.

---

## A. Legal and compliance

### 1. Say who you are — **must**

The Electronic Commerce (EC Directive) Regulations 2002 require any site
providing an "information society service" to publish, in a form that is easily,
directly and permanently accessible:

- the name you trade under
- a geographic address (not a PO box)
- an email address that reaches you quickly

If you incorporate later, add company number, registered office and place of
registration; if you VAT register, add the VAT number.

**Status:** the `/legal` page exists but the contact address is a placeholder.
Fill it in before launch — this is the single cheapest compliance item and the
most commonly missed.

### 2. Privacy notice — **must**

You process personal data, so UK GDPR applies and a privacy notice is required.
Specifically:

- **IP addresses** reach GitHub Pages (hosting logs) and the Premier League
  image servers (crests and headshots load from them).
- **FPL team ID, manager name and league names** pass through a public CORS
  relay whenever someone uses My Team. That is personal data going to a third
  party you have no contract with.

**Status:** drafted at `/legal` → Privacy, and it names the relay honestly.
Needs a real contact address.

**Recommended fix for the relay:** replace it with your own Cloudflare Worker
(free tier, about twenty lines) that fetches the FPL API server-side and returns
it with CORS headers. That removes the third party from the data path entirely,
removes a rate-limited dependency you do not control, and shortens your privacy
notice. See §B.

### 3. Cookies and device storage

You set no cookies, but PECR regulation 6 covers *any* storage on a user's
device — localStorage included. Storage "strictly necessary" for a service the
user has requested is exempt from consent. Theme, season, squad plan and the
team ID the user typed in all sit comfortably in that exemption, so no banner is
needed today.

**This changes the moment you add analytics, ads or any third-party embed.** At
that point you need a proper consent mechanism, not a notice-only banner.

### 4. ICO registration

Most organisations processing personal data as a controller must pay the ICO
data protection fee (tier 1 is £52/year, £40 by direct debit). There are
exemptions, and a free non-commercial site with no marketing and no user
accounts may fall inside one. Do not guess — the ICO publishes a short
self-assessment; run it and keep the result.

### 5. Premier League intellectual property

"Premier League" and "Fantasy Premier League", club names and club crests are
registered trade marks. Using a crest to identify a club is normally defensible
nominative use, but the rights holders are active. Keep the risk low:

- Carry a clear "not affiliated with or endorsed by" line — **done**, it is in
  the site footer and on `/legal`.
- Never put a PL or club mark in *your* logo, favicon, app icon or social
  avatar.
- Do not copy the PL's own typography, colour system or lockup.
- Do not imply any partnership in marketing copy.

### 6. The FPL API

Undocumented, unofficial, and not covered by any public licence — tolerated
rather than permitted. Stay tolerable: keep request volume low, cache
server-side (the daily refresh already does), never resell the raw feed, and be
ready to switch off gracefully if access changes.

### 7. Odds data

Check the terms of wherever the odds come from. Many providers forbid
redistribution of prices. Publishing *derived* figures — projected goals, clean
sheet chances — is a much safer position than republishing the prices
themselves, which is what the site already does.

### 8. Gambling

The site converts bookmaker prices into projections. That is analysis, not
promotion, and is fine. It stops being fine if you add a bookmaker link, an
affiliate deal or a tipping angle: that pulls in Gambling Commission licensing
questions, the CAP Code rules on gambling advertising, and age-gating. If money
ever enters via that route, take advice first.

### 9. Accessibility

The public sector accessibility regulations do not apply to a private site, but
the Equality Act 2010 duty to make reasonable adjustments does. WCAG 2.2 AA is
the sensible target. The audit script in the repo root already checks headings,
alt text and tap-target sizes on every route.

### 10. If you ever charge

There is a `Paywall` component in the codebase. The day it goes live you take on:

- **Consumer Contracts Regulations 2013** — pre-contract information, a 14-day
  cancellation right, and a model cancellation form.
- **Consumer Rights Act 2015** — digital content must be of satisfactory
  quality, fit for purpose and as described.
- Published pricing, refund and cancellation policies.
- Payment processing obligations (your processor covers most of PCI, not all).

### 11. Email and marketing

If you add a newsletter: PECR requires consent before marketing email, plus your
identity in every message and a working unsubscribe.

---

## B. Technical pre-launch checklist

Done in this pass:

- [x] `og:image` and `og:url` made absolute — relative paths are silently
      dropped by every link-preview scraper, so shared links had no image.
- [x] `meta name="description"` added for search snippets.
- [x] `twitter:description` and `og:image:alt` added.
- [x] `robots.txt` and `sitemap.xml`.
- [x] Third-party CORS proxy removed from ordinary page loads — see below.
- [x] `/legal` page with data sources, photo credits, terms and privacy,
      linked from the footer of every page.

Still to do:

- [ ] **Fill in the contact email** on `/legal` (Terms §1 and Privacy).
- [ ] **Replace the CORS relay** for My Team with your own Cloudflare Worker.
- [ ] **Custom domain** — worth it before you start posting links, because every
      shared URL becomes permanent. A GitHub Pages sub-path is hard to say aloud
      in a video and impossible to fit in a bio.
- [ ] **Test on real devices** — iOS Safari and Android Chrome, not just
      emulation. Add to home screen and check the PWA launches.
- [ ] **Watch the scheduled workflows.** GitHub disables scheduled Actions after
      60 days without repository activity. If the daily refresh stops, the site
      silently serves stale prices and injuries — the worst failure mode you
      have, because it looks fine.
- [ ] Decide whether to add privacy-respecting analytics. If you do, it needs a
      consent mechanism (§A.3).

### The proxy fix, in detail

`photoCodes.ts` used to fetch the FPL `bootstrap-static` endpoint — several
megabytes — through `corsproxy.io` on **every page load**, purely to build a
lookup of player photo codes. The daily availability refresh already reads that
same endpoint server-side and writes `element → code` into our own feed, so the
identical data now arrives same-origin, cached, and roughly a thousand times
smaller. Faster for the visitor, and no third party sees anybody.

`MyTeam` still uses the relay, because a live per-manager call cannot be
precomputed. That is the one to replace with your own Worker.

---

## B2. Positioning and money

### Free, with a tip jar

The right call for season one. It removes every objection at the moment you
have no reputation, and it tells you something a business plan cannot: whether
anyone values this enough to pay before you build billing.

Set expectations on the number, though. Tip jars convert at roughly **0.1–1% of
engaged users**, at a few pounds each. A thousand regulars might produce £20–60
a month. That covers a domain and hosting; it does not fund your time. Its real
value is as a signal, not as revenue.

Practical choices:

- **Ko-fi over Buy Me a Coffee.** Ko-fi takes 0% on donations (BMC takes 5%),
  and it can host memberships later if the model shifts.
- **Link out, never embed.** Their widget scripts are third-party trackers on
  every page, which drags in PECR consent and a cookie banner — for a button.
  `src/lib/support.ts` renders a plain link for exactly this reason.
- **One quiet placement.** The footer link is enough while the site is free. If
  you want a second, put it after a moment of delivered value — the export of a
  share card — never on arrival, and never in a modal.
- **Tax.** Tips for a service you provide are generally trading income, not
  gifts. HMRC's £1,000 trading allowance covers a first season for most people;
  above that it needs declaring. Worth knowing before it arrives.

### On undercutting Fantasy Football Scout and FPL Hub

Price is the weakest ground a new entrant can pick, for three reasons:

1. **It is the easiest thing for them to match.** An incumbent with a decade of
   brand can halve its price for one season and absorb it. You cannot.
2. **Their moat is not the tools.** It is the writers, the podcast, the
   community, the years of being the default. You cannot undercut a
   personality.
3. **The audience is not price-sensitive in that way.** Someone spending hours a
   week on FPL is not blocked by £30 a season. They are blocked by not trusting
   the source, or not understanding where the number came from.

**Compete on transparency instead.** The genuine difference is already built:
this site shows its working. The Preview page states the model, the ratings
decompose into dimensions you can inspect, fixture difficulty explains its own
scale, and "who steps up" names the promotion rule rather than asserting a team
sheet. The established sites sell *opinion from named experts*. That is a good
product and you will not beat it at its own game. What they mostly do not sell
is *a model you can audit* — and the numerate half of the FPL audience has grown
a lot.

The sharpest version of that positioning: **publish the misses.** "The model
said X, it got Y, here is why" is the most trust-building post in this niche and
almost nobody does it, because it is uncomfortable for a site selling certainty.
It costs you nothing, because you are not selling certainty.

So: free, transparent, and different — then charge later for personalisation
(your team, your plan, your alerts), which is the part nobody can screenshot and
share anyway. Being cheaper is a fine tiebreaker once someone is choosing
between you and Scout. It is a poor reason for them to look in the first place.

## C. Release plan

### Before you post anything

1. Custom domain live, contact email real.
2. Post the link into a private group chat first and confirm the preview card
   renders with the image.
3. Have three weeks of content drafted. The fastest way to lose a new following
   is to launch, get attention, and then go quiet.

### The shape

Launch on a **Wednesday or Thursday before a gameweek**, when FPL managers are
actively planning. Never mid-match.

**Week −1: seed.** Post useful things with no mention of a product. Three or
four data cards — "the five defenders with the best run of fixtures to GW10",
"who is actually overperforming their xG". Every image exported from the site,
so the brand is visible without a pitch. This builds a small base that makes
launch day look less like shouting into a void.

**Launch day.** One thread on X, one carousel on Instagram.

- **Post 1 (the hook):** a single strong finding, not an announcement. "Saliba
  is out and the model says Mosquera walks into the Arsenal back four. Here is
  what that does to Arsenal's clean sheet odds." Then: "I built a site that does
  this for all 20 clubs."
- **Post 2–5:** one screenshot each — the GW Preview page, a player brief, the
  fixture Best Runs, the squad builder. Each with one sentence on what problem
  it solves.
- **Post 6:** the link, and only here.

**Week +1 onwards: the rhythm.** This is what turns a launch into a following.

| Day | Post | Source |
|---|---|---|
| Deadline −3 days | GW Preview card — the round's shape | Preview page |
| Deadline −2 days | Captain podium | Preview page |
| Deadline −1 day | Team news / who steps up | Preview page |
| Post-gameweek | The Review — who rode their luck | Review page (to build) |
| Midweek | One player brief, in depth | Player page |

The Preview page was designed to be screenshotted. Use it.

### Tone

The differentiator is that the site says *why*, with the numbers behind it, and
admits what it does not know. Carry that into the posts: publish the model's
misses as well as its hits. "The model said X, it got Y, here is why" is the
single most trust-building post type in this niche, and almost nobody does it.

### Handles

`@FPLAnalyser` on X, `fpl_analyser` on Instagram — already wired into the
export byline, so every shared image carries them.

---

## D. The showcase video

### What is realistic

A 60–75 second screen recording with captions, cut down into three 15-second
verticals for Shorts, Reels and TikTok. No voiceover needed for the short cuts —
most are watched muted, so captions do the work.

### Shot list

Record at 1440×900 for the wide cut, then reframe to 1080×1920 for verticals.
Move slowly; fast cursor movement looks frantic when scaled down.

| # | Time | Screen | Action | Caption |
|---|---|---|---|---|
| 1 | 0:00–0:04 | Home | Hold on the tile grid, then hover one tile | "Every Premier League player, rated on what actually predicts returns." |
| 2 | 0:04–0:12 | GW Preview | Scroll from deadline strip to the captain podium | "The whole gameweek on one screen, before the deadline." |
| 3 | 0:12–0:20 | GW Preview | Click the featured match open | "Projected goals and clean sheet odds for every fixture — from the bookmakers' own prices." |
| 4 | 0:20–0:28 | GW Preview | Scroll to Who steps up | "Saliba is out. The model names the man who takes his place." |
| 5 | 0:28–0:38 | Player page | Search a name, land on the brief | "Every player gets a verdict, not just a number." |
| 6 | 0:38–0:46 | Fixtures → Best Runs | Toggle to the season map | "Find the best run of fixtures for every club — and when to jump." |
| 7 | 0:46–0:56 | Squad Builder | Drop three players in | "Build an XI and plan the season week by week." |
| 8 | 0:56–1:05 | My Team | Enter a team ID, show the report | "Or load your own team and get the same read on your XI." |
| 9 | 1:05–1:12 | Home | Return, hold | Logo, URL, handles. |

### The three vertical cuts

- **Cut A — "the deadline"**: shots 2, 3, 4. Strongest hook, use this first.
- **Cut B — "the player read"**: shot 5 only, slowed down, one long scroll.
- **Cut C — "the planner"**: shots 6 and 7.

### Practical notes

- Record in **dark mode**. The gold reads better on video and compresses
  cleaner than the light theme's large white areas.
- Turn off the intro splash before recording (visit once, it is stored per
  browser) so the first frame is content, not a tap prompt.
- Use a real gameweek with real team news. A round where nobody is injured makes
  half the product look empty.
- First frame matters more than anything else. Make it the captain podium — gold
  foil, a face, a number.
- Keep the cursor visible and the clicks deliberate. Screen recordings read as
  fake when nothing is ever hovered.

### What I can and cannot do

I can produce every still frame, the caption text, and the exact route and
click sequence — all of the above. I cannot record or encode video. The
recording itself needs a screen recorder on your machine.
