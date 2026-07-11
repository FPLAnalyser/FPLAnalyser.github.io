# FPL Analyser — Next Phase Plan

*Prepared July 2026 · Target: live for the 2026-27 season, GW1 (mid-August)*

**The vision:** a one-stop shop FPL managers open every week. The gap in existing
tools is that they show data but don't explain it. Our differentiator is
**storytelling** — turning the data we already compute into guidance specific to
the manager's own team.

**Decisions already made** (baked into this plan):

| Decision | Choice |
|---|---|
| Story text generation | Rule-based templates, deterministic, client-side |
| Timeline | Ready for 2026-27 GW1 (~5 weeks) |
| Codebase structure | Split index.html into plain JS/CSS files, no build tools |
| Mini-league rival analysis | In scope this phase |

---

## 1. Site audit

### What's strong

- **Data depth nobody casual has.** Three joined sources (FPL API, Understat,
  PL/Opta) with careful NaN semantics, per-90 discipline and join auditing. The
  scouting report with percentile bars across three time windows is genuinely
  FBref-grade and is the most differentiated page on the site.
- **The persona system.** "Poacher", "Set Piece Threat", "Chaos Merchant" with
  hover explanations is storytelling already — it just isn't personalised yet.
- **The finance-analytics brand.** Alpha, Sharpe, Sortino, consistency plus the
  written "Analysis" insight box on the player page is a real identity. Keep it;
  every new feature should speak this language.
- **Coherent rating language.** Stars mean the same thing everywhere (normalised
  1–5 within position), and the new Next-4GW fixture-adjusted rating extends
  that language forward in time.
- **Visual identity.** The dark analytics aesthetic is consistent and looks
  professional.

### What's weak

- **Home is seven top-5 lists with no guidance.** It answers "who is good?" not
  "what should I do this week?" — the exact gap this phase exists to close. No
  fixture ticker, no deadline clock, no "what changed since last GW".
- **Load Your Team is the vision's landing spot but says nothing.** It shows
  ratings and streak icons, then leaves interpretation entirely to the user.
  This page becomes the My Team engine.
- **Team pages are thin.** No upcoming fixture list, no xG/xGC trend, no
  "players to watch from this team".
- **No freshness signal.** Nothing tells the visitor when the data was last
  updated — fatal for a weekly-habit product if the pipeline misses a run.

### What's redundant

- **Rankings largely duplicates Home.** Five of the six rankings tabs are the
  Home cards with more rows. Once Home is rebuilt around "this week", Rankings
  can become the single "browse the tables" page and Home stops competing
  with it.
- **personas_6gw.csv is computed but never used by the site.** Either surface
  it (persona stability: 4GW vs 6GW agreement) or stop shipping it.

### What confuses a first-time visitor

- Jargon lands before explanation: stars, xGC, DefCon and Sharpe appear with no
  "what is this site?" framing. Tooltips exist but only on some labels and only
  on hover.
- "Players" vs "Scouting" are both player-centric nav items with unclear
  difference until you click.
- N/A-heavy columns (enrichment stats below minutes floors) read as "broken"
  rather than "insufficient data" — needs a friendlier empty-state treatment.

### Mobile, honestly

Tested against the current CSS:

- **Nav overflows below ~600px.** Six links in a flex row with no wrap and no
  hamburger — "Rankings" and "Scouting" fall off-screen on phones.
- **Every table overflows.** `.rankings-table` / `.ratings-table` have no
  `overflow-x` wrapper, so the whole page scrolls horizontally.
- **Tooltips are hover-only.** All persona/metric explanations are unreachable
  on touch devices — the entire explanatory layer disappears on mobile.
- **Scouting with 3–4 players is unusable on a phone** (grid columns collapse
  below readable width). Two players is the realistic phone maximum.
- What works: search dropdowns, pitch cards (they wrap), stat card grids
  (2-column fallback exists).

**Verdict:** the site is desktop-first with a handful of specific, fixable
mobile defects — a targeted fix list (Phase 1), not a redesign.

---

## 2. "My Team" insight engine — the flagship

A user enters their team ID (remembered in `localStorage`). We pull their squad
live and generate a narrative report: weak spots by position, players losing
minutes or form, persona shifts, fixture swings, and concrete replacement
suggestions filtered by budget, position and fixture difficulty.

### Architecture: what runs where

**Pipeline (Python, weekly on the Mac) pre-computes everything league-level:**

| Output | Contents | Why pipeline-side |
|---|---|---|
| `benchmarks.json` | Median/quartile ppg, DC hit rate, CS rate, xGI per position | Needs full-league scan; tiny output |
| `fixture_ease.json` | Per team, per upcoming GW (next 6): opponent, H/A, attack-ease and defence-ease factors (generalise the existing next-4 factor code in `fpl_analyser_rating.py`) | Reuses team_metrics xG/xGC blend already built |
| `replacement_pool.json` | Per position × £0.5m price band: top ~10 candidates with ratings, form, next-5 ease, ownership | Ranking 700 players client-side per visit is wasteful |
| `persona_shifts.json` | Diff of `personas_season` vs `personas_4gw` (both already produced) | Trivial diff, better done once |
| `price_risk.json` | Net-transfer velocity per player (from `transfers_balance`, `selected` in `player_gw_history.csv`) | Needs multi-GW trend |
| `meta.json` | `last_updated`, `current_gw`, data coverage stats | Powers the staleness banner |

**Browser (vanilla JS) does only the user-specific work:**

1. Fetch squad: `entry/{id}/event/{gw}/picks/` via the existing `fplFetch`
   CORS-proxy helper (already handles fallback). Also fetch `entry/{id}/history/`
   for bench points and chip usage.
2. Join the 15 picks against the pre-computed JSON (all keyed on `element`).
3. Run the **rules engine** (below) over the joined context.
4. Render insights grouped by severity, each with an evidence line.

This split keeps GitHub Pages purely static, keeps the heavy lifting in the
pipeline you already run, and means the browser code stays small enough to
maintain.

### The rules engine

A declarative list of rule objects in one module (`js/insights/rules.js`):

```js
{
  id: 'def_dc_decline',
  scope: 'player',            // 'player' | 'squad' | 'position-group'
  positions: ['DEF'],
  needs: ['ratings', 'personas', 'benchmarks'],   // data guards
  severity: 'warn',           // 'act' | 'warn' | 'info' | 'good'
  trigger(ctx) { ... returns false or a details object ... },
  template(d) { return `${d.name} has hit the DefCon threshold just ${d.hits4} time(s) in 4 GWs — down from ${d.seasonRate}% of games this season.`; }
}
```

- The runner loops rules × squad, collects fired insights, sorts by severity,
  caps each section (max ~3 per severity so the report stays readable).
- **Every insight carries an evidence line** — the actual numbers that fired it
  ("2 DC hits in 4 GWs vs 68% season rate"). This is the finance-analytics
  credibility: never a claim without the data.
- Templates are plain functions with slot-filling; 2–3 phrasing variants per
  rule (picked by hash of player id) stop the report reading identically every
  week.
- Insight output shape is uniform:
  `{ rule_id, severity, headline, body, evidence[], suggestions[] }`.
  This costs nothing now and means a future pipeline step could rewrite `body`
  more fluently without touching the engine (option only — not planned).

### The replacement suggester

The concrete "here are 3 defenders" half of the vision:

1. Weak spot identified by a rule (e.g. DEF group scoring below benchmark).
2. Budget = pick's `now_cost` + `bank` from the picks payload.
3. Filter `replacement_pool.json`: same position, price ≤ budget, not owned,
   next-5 fixture ease ≥ 1.0, minutes-secure (start rate ≥ 70%).
4. Rank by (rating × fixture ease), take top 3, each rendered with a one-line
   reason: "Strong DefCon record (78% hit rate), 4 green fixtures in next 5,
   £4.8m".

---

## 3. Insight rules library — starter set (18 rules)

Severities: 🔴 **act** · 🟡 **warn** · 🔵 **info** · 🟢 **good**

| # | Rule | Data needed | Trigger | Story template (abridged) |
|---|------|-------------|---------|---------------------------|
| 1 | 🟡 DefCon decline (DEF/MID) | `dc_hits_4gw`, season DC hit rate (personas inputs) | Season hit rate ≥ 50% but ≤ 1 hit in last 4 | "{name}'s defensive contributions have dried up — {hits4} threshold hits in 4 GWs vs {season_rate}% of games this season." |
| 2 | 🟡 Clean-sheet drought (team) | `team_metrics` cs_rate season vs 4gw | Your GKP/DEF's team: 4gw cs_rate ≤ 25% of season rate | "{team}'s clean sheets have collapsed ({cs4} in 4 GWs vs {rate}% season rate) — affects your {names}." |
| 3 | 🟡 Captain underperforming xGI | picks `is_captain`, `expected_goal_involvements` & returns last 4 | Captain's G+A ≤ 1 over 4 GWs while xGI ≥ 2.5 | "Your captain {name} is due: {xgi} xGI in 4 GWs but only {returns} returns. The underlying numbers say persist." (or inverse: low xGI → consider switching) |
| 4 | 🔵 Bench points wasted | `entry/{id}/history/` `points_on_bench` | Bench points ≥ 8 avg over last 4 GWs | "You've left {pts} points on your bench in 4 GWs — your bench {name} is outscoring your starting {pos}." |
| 5 | 🔴 Minutes decline | `starts_last4`, Minutes Risk flag (personas_4gw) | Started ≤ 2 of last 4 | "{name} is losing minutes — {starts} starts in 4 GWs. Rotation risk for your XI." |
| 6 | 🔵 Persona shift | `persona_shifts.json` | Season persona lost in 4GW window (or gained) | "{name} has stopped looking like a {persona} — their {stat} has fallen from {a} to {b} per 90." |
| 7 | 🟢 Fixture swing — improving | `fixture_ease.json` next-5 vs last-5 | Team's ease factor improves ≥ 0.15 | "{team}'s run turns kind: {fixtures}. Hold {names} / good entry window." |
| 8 | 🟡 Fixture swing — deteriorating | same | Ease factor drops ≥ 0.15 | "{team} hit a wall after GW{n}: {fixtures}. Plan exits for {names} before the swing." |
| 9 | 🔴 Weak spot + replacements | benchmarks + replacement_pool | Position group ≥ 1.0 pts/gw below position benchmark over 4 GWs | "Your defence is {delta} pts/GW below the league median. Consider replacing {worst}. Options at your budget: {3 candidates with reasons}." |
| 10 | 🔵 Differential opportunity | `selected_by_percent`, form, fixture ease | Ownership < 5%, 4gw rating ≥ 4★, next-5 ease ≥ 1.05, not owned | "Differential watch: {name} ({own}% owned) — {rating} form and {greens} green fixtures. Edge over your rivals." |
| 11 | 🟡 Price-change risk | `price_risk.json` (net transfer velocity) | Owned player in bottom decile of net transfers | "{name} is being sold fast ({net} net transfers this week) — price drop likely. Move early if you're selling anyway; ignore if holding." |
| 12 | 🟡 Premium not delivering | `price`, `season_value_score_rating`, `alpha_4gw` | Price ≥ £9.0m, value ≤ 2★, alpha < 0 | "{name} at £{price}m is returning below the {pos} benchmark (alpha {alpha}). That's {pct}% of your budget underperforming." |
| 13 | 🟡 Unsustainable goal threat | shot quality rating / Volume Shooter persona, box-shot share | Owned; xG-driven rating but box share < 40% or Volume Shooter | "{name}'s xG flatters: only {share}% of shots come inside the box. The goal threat may not stick." |
| 14 | 🔵 Regression warning | `season_finishing_skill_score` (Σ goals−xG), shot quality | Σ delta ≥ +3 with shot quality ≤ 2★ | "{name} has scored {delta} more than their chances merit. Enjoy it, but expect regression — don't buy the recent numbers." |
| 15 | 🔵 Keeper profile check | GKP save vs CS ratings, `replacement_pool` | Owned GKP: save ≥ 4★ but CS ≤ 2★ (or vice versa) | "{name} earns points from saves, not clean sheets — fine while {team} concede shots. For CS upside at the same price: {alt}." |
| 16 | 🟡 Team exposure risk | picks × team + fixture_ease | 3+ owned players from one team entering ease < 0.9 run | "Heavy {team} exposure ({n} players) into a tough run: {fixtures}. One bad month hits {pct}% of your squad." |
| 17 | 🟢 Captaincy advisor | `alpha_4gw`, `consistency_4gw`, next-GW ease, home/away | Every GW: rank owned players by alpha × (1/consistency) × next-fixture ease | "Armband case: {name} — alpha {alpha}, {cons} consistency, {opp} ({H/A}) is the league's {rank}-easiest defence." |
| 18 | 🔵 Streak mismatch | `season_to_date_per90` streaks vs ownership | 🔥 Hot top-10 not owned, or owned player 🧊 Cold with pts_delta ≤ −2 | "You're missing the league's form player: {name} (+{delta} pts/90 over baseline). / {name} is ice cold ({delta}) — watch closely." |

Rules 1–9 are the Phase 2 core (they cover the example insight in the vision
statement end-to-end); 10–18 land in Phase 3.

---

## 4. Data pipeline gaps

Everything below is derivable from data the pipeline already collects — no new
scraping is required for this phase.

**New pre-computed outputs** (one new script, `build_site_data.py`, or a final
step appended to the existing chain):

1. **`fixture_ease.json`** — per team × upcoming GW (next 6): opponent, venue,
   attack-ease, defence-ease. *Generalise the `build_next4()` code just added to
   `fpl_analyser_rating.py` — same xGC/xG blend, output per-GW rows instead of a
   single factor.* Powers the Home ticker, rules 7/8/16/17 and the replacement
   filter.
2. **`replacement_pool.json`** — per position × price band: candidates with
   ratings, 4gw form, next-5 ease, ownership, start rate.
3. **`benchmarks.json`** — per position: median/quartile ppg, DC hit rate,
   CS rate, xGI per 90.
4. **`persona_shifts.json`** — diff `personas_season.csv` vs `personas_4gw.csv`
   (both already produced; nothing consumes them together yet).
5. **`price_risk.json`** — net transfer velocity: `transfers_balance` summed
   over last 1–2 GWs ÷ `selected`, percentile-ranked. Columns already exist in
   `player_gw_history.csv`.
6. **`meta.json`** — `last_updated` timestamp, `current_gw`, row counts and join
   coverage. The site shows a staleness banner when older than ~8 days.
7. **JSON versions of the six CSVs the site already loads** (ratings, personas,
   metrics, team metrics, season-to-date, scouting). CSVs remain for human
   inspection; the site switches to JSON (see §5).

**Operational gaps (critical path for the deadline):**

8. **New-season reset checklist** — the current data is the *completed* 2025-26
   season. For 2026-27: new data dir, fresh `season_summary`/fixtures pulls,
   Understat + PL cache backfills as matches happen, join-map rebuild for new
   players (`player_id_map_*.csv`, `player_overrides.csv`). Also: early-season
   minutes floors — most enrichment stats need 450+ valid minutes, so the
   scouting/enrichment layers will be sparse until ~GW5. The site should degrade
   gracefully (friendly "needs N more gameweeks" messaging), and the next-4
   rating already handles this by falling back to season scores.
9. **launchd automation** (already planned) — schedule the full chain post-GW:
   pulls → enrich → rolling → ratings → personas → advanced → scouting →
   build_site_data → git commit/push. One wrapper script with a log file and a
   non-zero exit on any gate failure, so a broken run never silently publishes.

---

## 5. Architecture review

### Split index.html now — here's the shape

The file is ~2,800 lines and the My Team engine adds 1,000+ more. Split **before**
Phase 2, using plain ES modules — no build tools, no npm, works as-is on GitHub
Pages, still vanilla JS:

```
index.html          shell: nav, page containers, <script type="module" src="js/app.js">
css/styles.css      all current <style> content
js/app.js           init, navigation, page registry
js/data.js          JSON loading, data store, meta/staleness
js/util.js          teamBadgeImg, norm, escQ, stars, tooltips, FDR colours
js/api.js           fplFetch (CORS proxies), picks/history/league fetchers
js/pages/home.js    … one file per page …
js/pages/players.js, teams.js, rankings.js, scout.js, myteam.js
js/insights/rules.js     the 18 rule objects
js/insights/engine.js    runner, severity sort, render
```

Maintenance rule of thumb: **one page = one file**; shared things live in
`util.js`/`data.js`. Each file stays under ~400 lines, which is the practical
ceiling for finding things quickly.

### JSON instead of CSV for the client — yes

- The homegrown CSV regex parser is the most fragile code in the site (quoted
  commas, blank trailing cells, `Number()` coercion surprises).
- JSON is parsed natively (`fetch(...).then(r => r.json())`), preserves types
  and nulls, and is *smaller* once keys are minified per-table.
- Keep publishing CSVs too — they're your inspection/debug format and your
  Numbers-app workflow already uses them.
- Serve from the same repo (GH Pages gzips automatically). One file per table,
  plus `meta.json`, keeps loads parallel and cache-friendly.

### Stay vanilla JS

No framework. The state is simple (one data store, page-level rendering), GH
Pages is static, and every framework adds a build chain you'd have to maintain.
The module split above delivers the main benefit (isolation) without the cost.
Revisit only if the site ever needs live shared state across many components —
nothing in this plan does.

### One fragility worth naming

All FPL API access rides public CORS proxies (`corsproxy.io`,
`allorigins.win`). The dual fallback is decent mitigation; if either dies at a
bad time, a free Cloudflare Worker (~20 lines, free tier) is the hardening
path. Not needed now — noted for the future.

---

## 6. Mobile & future app path

**Recommended path: responsive fixes → PWA → (maybe, much later) native.**

1. **Responsive fixes (Phase 1, do regardless of any app ambition):**
   hamburger/scrollable nav; wrap every table in an `overflow-x: auto`
   container; tooltips toggle on tap (click handler, not just `:hover`);
   scouting page caps at 2 comparison players below 640px; larger touch
   targets on chips/tabs.
2. **PWA (Phase 4):** a `manifest.json` (name, icons, theme) makes the site
   installable to the home screen; a small service worker caches the app shell
   and last-loaded JSON so the site opens instantly and shows the last report
   offline (with the staleness banner). Cost: two files, static-hosting
   friendly, zero app-store involvement. This gets 90% of "app feel" for 5% of
   the effort.
3. **Native app: only if push notifications become core.** The one thing a PWA
   does materially worse (especially on iOS, where web push exists since 16.4
   but is limited) is proactive alerts — "price drop tonight", "deadline in 2h".
   If that becomes the product, revisit; a wrapper (Capacitor) over the
   existing site would be the route, not a rewrite.

**Decisions in this plan that keep the app door open:** JSON data layer (an app
would consume the same files), insight logic in modules separate from DOM
rendering, no framework lock-in.

---

## 7. Phased roadmap

Sized for iterative, step-at-a-time working. Each phase is shippable and
verifiable on its own; effort assumes a few evenings/week.

### Phase 0 — Foundations *(~3–5 days · blocks everything)*
1. Split index.html into the module layout in §5 (pure moves, no behaviour
   change).
2. Add `build_site_data.py`: JSON export of existing tables + `meta.json` +
   `fixture_ease.json`; switch the site's loaders to JSON.
3. New-season reset checklist written down and dry-run; launchd wrapper script.

*Verify:* site behaves identically on GH Pages; JSON loads visible in dev
tools; pipeline chain runs end-to-end via the wrapper on your Mac.

### Phase 1 — Quick wins *(~1 week · needs Phase 0)*
1. Mobile fixes (nav, table wrappers, tap tooltips, scout cap).
2. Home rebuilt: next-GW fixture ticker (from `fixture_ease.json`), "this
   week" panel (deadline, top captaincy picks, biggest risers/fallers), one
   featured insight teaser; move the top-5 lists into Rankings.
3. Staleness banner from `meta.json`.

*Verify:* phone walkthrough of every page; Home answers "what should I look at
this week?" in one screen.

### Phase 2 — My Team engine v1 *(~2 weeks · needs 0–1 · the GW1 headline)*
1. `benchmarks.json`, `replacement_pool.json`, `persona_shifts.json`,
   `price_risk.json` in the pipeline.
2. `js/insights/engine.js` + rules 1–9; replacement suggester.
3. My Team page: squad pull (localStorage team ID), narrative report grouped
   by severity with evidence lines, replacement cards.

*Verify:* run against your real team ID and 2–3 friends' IDs; every insight's
evidence numbers hand-checked against the CSVs; nonsense-rate reviewed (a rule
that fires wrongly is worse than no rule).

### Phase 3 — Rules expansion + mini-league *(~1–2 weeks · needs 2)*
1. Rules 10–18 including the captaincy advisor.
2. Mini-league rivals: `leagues-classic/{id}/standings/` → top ~20 rivals'
   picks → effective ownership table, "your differentials vs the league",
   "template players you're missing", rank-threat view.

*Verify:* your own mini-league loads within proxy rate limits (throttle rival
pick fetches, cache in sessionStorage); differential calls match manual checks.

### Phase 4 — Polish + PWA *(~1 week · needs 1 · fine post-kickoff)*
1. PWA manifest + service worker (app-shell + last-data cache).
2. First-visit onboarding (three-line explainer + link to a "how ratings work"
   page), friendlier N/A states.
3. Performance pass (lazy-load scouting JSON, image `loading="lazy"`).

*Verify:* Lighthouse PWA check passes; installs to a phone home screen; opens
offline showing last data + staleness banner.

### Timeline vs GW1 (~5 weeks away)
Phases 0–2 fit in ~4 weeks with buffer — **My Team v1 live for GW1** is
realistic. Phase 3 lands during GWs 2–4 (mini-league data is more interesting
once rivals' squads diverge anyway); Phase 4 whenever. The only hard external
dependency is the new-season data pulls (Phase 0.3), which can't be fully
tested until fixtures and rosters are published in July.
