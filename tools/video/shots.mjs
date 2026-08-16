// Shot list for the showcase video, following docs/LAUNCH.md section D.
//
// Scroll targets are expressed as *anchors* (a heading's text) rather than pixel
// offsets, because the layout moves whenever the data refreshes and the vertical
// cuts render in the mobile layout where every offset differs. Anchors resolve at
// render time; a shot whose anchor has vanished from the page fails loudly rather
// than silently filming the wrong part of the screen.

// The player featured in the "verdict, not just a number" shot. Any name the
// search accepts works; pick someone recognisable and in form at launch.
export const FEATURED_PLAYER = 'Haaland'


// ---------------------------------------------------------------- planner setup

const settle = (page, ms) => page.waitForTimeout(ms)

/**
 * Builds the plan every planner shot is filmed against: an auto-picked fifteen,
 * Bench Boost on GW2, and a transfer in GW3 and GW4.
 *
 * Idempotent — plans persist between page loads, so after the first shot has
 * built one the rest of the cut finds it already there and skips straight on.
 * Rebuilding per shot would cost about fifteen seconds a time and, worse, could
 * auto-pick a different fifteen and make the cut discontinuous.
 */
export async function buildPlan(page) {
  const already = await page.locator('[aria-label^="Remove "], [aria-label^="Sell "]').count()
  if (!already) {
    await page.getByRole('button', { name: 'Auto pick', exact: true }).click()
    await settle(page, 3500)
    await openGrid(page)

    // WHICH men are sold is a framing decision, not an incidental one. Taking
    // whatever the market listed last put both moves on the bench rows at the
    // bottom of the grid, and the first cut of this film went out with the
    // transfers off the bottom of every frame — the part of the plan the video
    // exists to show, filmed and then cropped away.
    //
    // So the sale is chosen from the GRID's row order rather than the market's.
    // The market lists the eleven and then the bench, so its indices move with
    // the formation; the grid is sorted by position and price, and rows five
    // and ten are a defender and a midfielder whatever shape the auto-pick
    // came out. Five rows apart, the two seams both sit inside one zoomed
    // frame without colliding.
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[title="Show only this player"]')]
        .map((b) => (b.children[1]?.textContent || '').trim()))

    // GW2: Bench Boost.
    await page.getByLabel('Next gameweek').click()
    await settle(page, 1400)
    await page.getByRole('button', { name: 'Bench Boost', exact: true }).click()
    await settle(page, 1400)

    // GW3 and GW4: one transfer each. Selling opens an empty place, and the
    // market's first row is "keep him — undo the sale", so the signing is the
    // first row actually offering the empty place.
    for (const row of [4, 9]) {
      await page.getByLabel('Next gameweek').click()
      await settle(page, 1600)
      const named = rows[row] ? page.getByLabel(`Sell ${rows[row]}`, { exact: true }) : null
      // A plan with no moves in it is worse than one with the moves in the
      // wrong row, so an unrecognised name falls back rather than skipping.
      const sell = named && await named.count() ? named : page.locator('[aria-label^="Sell "]').first()
      if (await sell.count()) {
        await sell.click()
        await settle(page, 1800)
        const sign = page.locator('[title="Sign him into the empty place"]').first()
        if (await sign.count()) { await sign.click(); await settle(page, 1800) }
      }
    }

    // Back to the opening week, which is where the film starts.
    for (let i = 0; i < 3; i++) {
      await page.getByLabel('Previous gameweek').click()
      await settle(page, 700)
    }
    await settle(page, 1200)
  }

  await openGrid(page)
}

/** The grid is collapsed on every mount, so every planner shot opens it. */
async function openGrid(page) {
  const pull = page.getByText('Pull down for the whole plan', { exact: false }).first()
  if (await pull.count()) { await pull.click(); await settle(page, 2200) }
}

/** Switches the right-hand column to one of its panels. */
const openPanel = (label) => async (page) => {
  await page.getByRole('tab', { name: label, exact: true }).click()
  await settle(page, 900)
}

/** buildPlan, then whatever else the shot needs standing before it films. */
const planThen = (...steps) => async (page) => {
  await buildPlan(page)
  for (const step of steps) await step(page)
}

/** Clicks one of the planner's metric toggles. */
const toggle = (label) => async (page) => {
  await page.getByRole('button', { name: label, exact: true }).first().click()
}

/**
 * Drives a toggle to a known state rather than flipping whatever it finds.
 *
 * Names and Crests both default to pressed, so the first attempt at the names
 * shot clicked Names and turned it *off* — the shot demonstrated the feature
 * by removing it. Toggle state also persists between shots, so by the time a
 * later shot runs the row is wherever the previous one left it.
 */
const setToggle = (label, want) => async (page) => {
  const b = page.getByRole('button', { name: label, exact: true }).first()
  if (!(await b.count())) return
  const pressed = (await b.getAttribute('aria-pressed')) === 'true'
  if (pressed !== want) { await b.click(); await settle(page, 500) }
}

/** Puts the toggle row in a known state before a shot films it. */
const presetToggles = (state) => async (page) => {
  await buildPlan(page)
  for (const [label, want] of Object.entries(state)) await setToggle(label, want)(page)
  await settle(page, 800)
}

/** Output formats. CSS width drives which layout the site renders. */
export const FORMATS = {
  // 1280x720 CSS at 1.5x = 1920x1080. Desktop layout, full HD.
  wide: { css: { width: 1280, height: 720 }, scale: 1.5, label: '1920x1080' },
  // 432x768 CSS at 2.5x = 1080x1920. Mobile layout, natively rendered rather
  // than cropped out of the desktop capture, so text stays readable.
  vertical: { css: { width: 432, height: 768 }, scale: 2.5, label: '1080x1920' },
  // 1440x810 CSS at 1.3333x = 1920x1080. A roomier desktop, for screens the
  // 1280 layout squeezes: the Risk table overflows its column by 62px at 1280
  // and clips the status pills off the right edge, against 6px here.
  desk: { css: { width: 1440, height: 810 }, scale: 1.3333, label: '1920x1080' },
}

/** Per-format values fall back to the wide desktop framing. */
function forFormat(spec, format) {
  const keys = Object.keys(FORMATS)
  if (!keys.some((k) => k in spec)) return spec
  return spec[format] ?? spec.wide ?? spec[keys.find((k) => k in spec)]
}

/**
 * A shot.
 *  route     hash route to film
 *  seconds   duration; a number, or {wide, vertical} when the cuts differ
 *  from/to   scroll anchors, eased between over the shot
 *  caption   burned-in lower-third text
 *  cursor    [tNorm, xFraction, yFraction] path for the synthetic pointer
 *  action    {at: tNorm, run: async (page) => {}} performed mid-shot
 */
export const SHOTS = {
  home_open: {
    route: '/#/',
    seconds: 4,
    from: { y: 0 },
    to: { y: 90 },
    caption: 'Every Premier League player, rated on what actually predicts returns.',
    cursor: [[0, 0.35, 0.78], [1, 0.2, 0.62]],
  },

  preview_deadline: {
    route: '/#/preview',
    seconds: { wide: 8, vertical: 5 },
    from: { text: 'GW1 deadline', align: 'top', offset: -140 },
    to: { text: 'Captain', align: 'top', offset: -80 },
    caption: 'The whole gameweek on one screen, before the deadline.',
    cursor: [[0, 0.5, 0.55], [1, 0.28, 0.7]],
  },

  preview_match: {
    route: '/#/preview',
    seconds: { wide: 8, vertical: 5 },
    from: { text: 'Every fixture', align: 'top', offset: -120 },
    // Ends on the opened match card: expected points, dead balls, team news.
    to: { text: 'Behind the numbers', align: 'top', offset: -60 },
    // LAUNCH.md's original line was "clean-sheet odds … from the bookmakers'
    // own prices". docs/DOMAIN_CATEGORISATION.md names "clean-sheet odds" and
    // bookmaker references as the specific route to a Gambling classification,
    // which it rates a worse outcome than staying uncategorised. A burned-in
    // caption is indexed by YouTube and cannot be edited after upload, so this
    // says the same thing without the trigger words.
    caption: 'Projected goals and clean-sheet chances for every fixture.',
    cursor: [[0, 0.45, 0.5], [0.5, 0.35, 0.62], [1, 0.35, 0.62]],
  },

  preview_steps_up: {
    route: '/#/preview',
    seconds: { wide: 8, vertical: 5 },
    // "Expected points" alone would match the match-card panel higher up, and
    // the anchor resolver deliberately prefers the tightest match — so the
    // full section heading is required here.
    from: { text: 'Expected points · top 10', align: 'top', offset: -120 },
    to: { text: 'Steps up', align: 'top', offset: -260 },
    // LAUNCH.md suggests naming the injured player. That line is only true on a
    // round where someone big is out, so the default stays generic; swap it in
    // launch week when the team news actually supports it.
    caption: 'Team news lands — and the model names the man who steps up.',
    cursor: [[0, 0.5, 0.45], [1, 0.4, 0.68]],
  },

  player_brief: {
    // Deep-linked so the shot opens on the brief itself rather than the grid.
    route: `/#/player?name=${encodeURIComponent(FEATURED_PLAYER)}`,
    seconds: { wide: 10, vertical: 14 },
    from: { text: FEATURED_PLAYER, align: 'top', offset: -180 },
    to: { text: 'Points Engine', align: 'top', offset: -200 },
    caption: 'Every player gets a verdict, not just a number.',
    cursor: [[0, 0.5, 0.3], [1, 0.42, 0.55]],
  },

  fixtures_runs: {
    route: '/#/fixtures',
    seconds: { wide: 8, vertical: 7 },
    // Starts below the page's methodology note, which reads "…live bookmaker
    // odds … until the books price them". docs/DOMAIN_CATEGORISATION.md wants
    // those words kept out of anything indexable, and burning them into an
    // upload is worse than a page — a video cannot be edited after publishing.
    // Opening straight on the ticker is the stronger shot regardless.
    // Fixed offsets are safe here: everything above the ticker is static page
    // chrome, so a data refresh does not move it. They differ per format
    // because the mobile layout stacks the same controls much taller.
    from: { wide: { y: 560 }, vertical: { y: 1150 } },
    to: { wide: { y: 1260 }, vertical: { y: 1850 } },
    caption: 'Find the best run of fixtures for every club — and when to jump.',
    cursor: [[0, 0.6, 0.35], [1, 0.5, 0.6]],
  },

  // The builder opens empty — an empty pitch is the same dead shot the Scouting
  // page had. So this presses Auto pick on camera and lets the fifteen land.
  // The scroll is deliberately fixed: the squad filling in *is* the motion, and
  // panning at the same time would fight it. It also keeps the button still, so
  // the pointer can sit on it while it is pressed.
  squad_autopick: {
    route: '/#/squad',
    seconds: { wide: 7, vertical: 6 },
    from: { y: 60 },
    to: { y: 60 },
    caption: 'Build an XI — or let it pick one for you.',
    // Moves off the button as soon as it is pressed, and means it. Filling the
    // squad swaps the right-hand Add Players panel for the verdict and Squad
    // Lab, which re-centres the whole toolbar — so the position resolved before
    // the click is stale the instant it lands, and a pointer left parked there
    // sits on Share, appearing to press one control and rest on another.
    cursor: [
      [0, 0.66, 0.62],
      [0.28, { text: 'Auto pick' }],
      [0.30, { text: 'Auto pick' }],
      [0.50, 0.30, 0.70],
      [1, 0.26, 0.82],
    ],
    action: {
      at: 0.3,
      run: async (page) => {
        await page.getByRole('button', { name: 'Auto pick', exact: true }).click()
        await page.waitForTimeout(400)
      },
    },
  },

  squad_insights: {
    route: '/#/squad',
    seconds: { wide: 8, vertical: 8 },
    // The redesign on main replaced Squad Lab with a tabbed panel, so this
    // shot now opens the Analysis tab rather than scrolling to a section that
    // no longer exists. --dry caught it: the old anchor failed outright rather
    // than quietly filming the wrong part of the page.
    setup: async (page) => {
      await page.getByRole('button', { name: 'Auto pick', exact: true }).click()
      await page.waitForTimeout(3000)
      const tab = page.getByRole('tab', { name: 'Analysis', exact: true })
      if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500) }
    },
    from: { text: 'Analysis', align: 'top', offset: -90 },
    to: { text: 'Analysis', align: 'top', offset: -90 },
    caption: 'Then it tells you what is wrong with it.',
    cursor: [[0, 0.5, 0.35], [1, 0.74, 0.55]],
  },

  // Stands in for LAUNCH.md's shot 8 (My Team). That page is gated behind
  // "Available after Gameweek 1" — it reads a live FPL squad — so it cannot be
  // filmed pre-season at all. Add it back as a shot once GW1 has been played.
  scouting: {
    route: '/#/scout',
    seconds: { wide: 9, vertical: 7 },
    // Scouting opens on an empty state ("Search for a player to build their
    // report"), so the head-to-head has to be populated before filming.
    setup: async (page) => {
      const box = page.getByPlaceholder(/Search \d+ players/)
      for (const name of ['Haaland', 'Saka']) {
        await box.click()
        await box.fill(name)
        await page.waitForTimeout(1200)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1500)
      }
    },
    from: { y: 150 },
    to: { text: 'Playing time & rating', align: 'top', offset: -60 },
    caption: 'Put any two side by side and let the percentiles settle it.',
    cursor: [[0, 0.5, 0.4], [1, 0.45, 0.65]],
  },

  // ---------------------------------------------------------------- effects
  // Short worked examples, one per effect, collected in the `fx` cut. They are
  // a sampler to look at, not part of the film:
  //   node tools/video/render.mjs --cut fx --format wide

  fx_dip: {
    route: '/#/preview',
    seconds: 3.5,
    from: { text: 'Captain', align: 'top', offset: -120 },
    to: { text: 'Captain', align: 'top', offset: -120 },
    dip: { in: true, out: true, seconds: 0.5 },
    caption: 'Dip to black — in and out',
    cursor: null,
  },

  fx_spotlight: {
    route: '/#/preview',
    seconds: 3.5,
    from: { text: 'Captain', align: 'top', offset: -120 },
    to: { text: 'Captain', align: 'top', offset: -120 },
    // up: 2 because the tightest match for "The pick" is its little label; the
    // card worth lighting up is two levels out.
    overlays: [{ type: 'spotlight', at: { text: 'The pick', up: 2 }, dim: 0.78, pad: 10 }],
    caption: 'Spotlight — dim everything else',
    cursor: null,
  },

  fx_callout: {
    route: '/#/preview',
    seconds: 3.5,
    from: { text: 'Captain', align: 'top', offset: -120 },
    to: { text: 'Captain', align: 'top', offset: -120 },
    overlays: [{ type: 'box', at: { text: 'The challenger', up: 2 }, label: 'Second best xP', pad: 6 }],
    caption: 'Callout box with a label',
    cursor: null,
  },

  fx_blur: {
    route: '/#/preview',
    seconds: 3.5,
    from: { text: 'The round at a glance', align: 'top', offset: -120 },
    to: { text: 'The round at a glance', align: 'top', offset: -120 },
    overlays: [{ type: 'blur', at: { text: 'Best differential', up: 2 }, px: 12, pad: 4 }],
    caption: 'Blur a region — hide a spoiler',
    cursor: null,
  },

  fx_hold: {
    route: '/#/preview',
    seconds: 5,
    from: { text: 'GW1 deadline', align: 'top', offset: -140 },
    to: { text: 'Every fixture', align: 'top', offset: -120 },
    // Scroll stops dead halfway for 1.4s, then carries on.
    hold: { at: 0.5, seconds: 1.4 },
    caption: 'Hold — stop dead, then carry on',
    cursor: null,
  },

  fx_progress: {
    route: '/#/preview',
    seconds: 3.5,
    from: { text: 'GW1 deadline', align: 'top', offset: -140 },
    to: { text: 'Every fixture', align: 'top', offset: -120 },
    overlays: [{ type: 'progress' }],
    caption: 'Progress bar',
    cursor: null,
  },

  // Horizontal pan. Only meaningful in the vertical cut: at 1280px the fixture
  // tables fit, so nothing overflows sideways to pan across. In the mobile
  // layout the gameweek strip runs 629px wide inside a 412px frame.
  fx_pan: {
    route: '/#/fixtures',
    seconds: 4,
    from: { y: 300 },
    to: { y: 300 },
    panX: { from: 0, to: 217 },
    caption: 'Horizontal pan',
    cursor: null,
  },

  // Not in any cut — a worked example of a slow push onto the captain podium.
  //   node tools/video/render.mjs --shots preview_captain_zoom --format wide
  preview_captain_zoom: {
    route: '/#/preview',
    seconds: 6,
    from: { text: 'Captain', align: 'top', offset: -120 },
    to: { text: 'Captain', align: 'top', offset: -120 },
    zoom: { from: 1, to: 1.5, at: { text: 'The pick' } },
    caption: 'The captain pick, by expected points.',
    cursor: null,
  },

  // ---------------------------------------------------------------- planner
  // The season planner, for a standalone post. Every shot shares one plan:
  // an auto-picked fifteen, a Bench Boost on GW2 and a transfer in each of
  // GW3 and GW4, so the grid has something to show before the toggles start.
  //
  // The cut is built around ZOOMS, and they are the reason it works at all.
  // The first version of this film sat at page scale throughout and named the
  // features in one sweeping caption each: the chip badge is fifteen pixels
  // tall, the diverging bar is five, the armband is nine. Everything the
  // planner does was in frame and none of it was legible, which is the same as
  // not filming it. Each of these shots now magnifies ONE mark and says what
  // that mark means.
  //
  // A zoom is a fixed point, not a crop: the origin stays where it is on
  // screen and the page grows around it. So the scroll anchor and the zoom
  // target are the same element, offset by roughly half a viewport, and the
  // subject sits still in frame while the push-in happens around it. Move one
  // without the other and the shot drifts off its own subject.

  plan_open: {
    route: '/#/squad',
    seconds: 4.5,
    setup: buildPlan,
    // Opens on the squad header and settles onto the planner.
    from: { y: 0 },
    to: { text: 'Your season', align: 'top', offset: -60 },
    caption: 'The season planner: your whole squad, twelve weeks ahead.',
    cursor: [[0, 0.5, 0.3], [1, 0.4, 0.52]],
  },

  plan_bars: {
    route: '/#/squad',
    seconds: 8,
    setup: buildPlan,
    // Anchored on GW2's own label so the push-in holds the opening weeks
    // still. -421 puts that label a little below the middle of the frame,
    // which leaves the column above it — chip, number, bar, fixture strip —
    // room to grow into.
    from: { text: 'GW2', align: 'top', offset: -421 },
    to: { text: 'GW2', align: 'top', offset: -421 },
    zoom: { from: 1, to: 1.95, at: { text: 'GW2' } },
    caption: 'One bar per gameweek — the points your fifteen is projected to score that week.',
    cursor: null,
  },

  plan_chip: {
    route: '/#/squad',
    seconds: 6,
    setup: buildPlan,
    // The chip badge is the top thing in its column, so this frames high: the
    // badge a fifth down and the bar it belongs to hanging below it. Framed
    // any lower and a 2.35x push fills the top third of the shot with the plan
    // switcher above the card, which is not what the caption is talking about.
    from: { text: 'BB', align: 'top', offset: -158 },
    to: { text: 'BB', align: 'top', offset: -158 },
    // Carries on from where plan_bars finished rather than restarting at page
    // scale, so the cut reads as one continuous push rather than a bounce.
    zoom: { from: 1.9, to: 2.35, at: { text: 'BB' } },
    caption: 'Chips show on the week you play them — GW2 here is the Bench Boost.',
    cursor: null,
  },

  plan_risk: {
    route: '/#/squad',
    seconds: 6,
    setup: buildPlan,
    // Scrolled to the very top (the offset clamps), which puts the label row
    // in the lower half and leaves the whole column above it in frame. At 3x
    // the strip was unmistakable and the bar it belongs under was cropped
    // away, which makes "under every bar" a caption about something off
    // screen; 2.3x holds the number, the bar and the strip together.
    from: { text: 'GW3', align: 'top', offset: -460 },
    to: { text: 'GW3', align: 'top', offset: -460 },
    zoom: { from: 1.5, to: 2.3, at: { text: 'GW3' } },
    caption: 'Under every bar: green for the easy fixtures that week, red for the hard ones and the blanks.',
    cursor: null,
  },

  plan_captain: {
    route: '/#/squad',
    seconds: 6,
    setup: buildPlan,
    // Frames the grid, not the bars: this is about the badge on the MAN.
    //
    // It said "and, on the week, a squad holding the best captain in the
    // game" as well, for the second gold C the spine draws beside a gameweek
    // label. That one is conditional on the squad actually holding the best
    // armband in the game, and the plan this cut builds does not, so the
    // frame showed one badge while the caption named two. A caption may not
    // describe a mark the viewer cannot see.
    from: { text: 'GW4', align: 'top', offset: -110 },
    to: { text: 'GW4', align: 'top', offset: -110 },
    // ox at the left margin so the name column stays in shot — an armband on
    // an anonymous row is a gold dot rather than a decision.
    zoom: { from: 1.6, to: 2.55, at: { text: 'GW4', ox: 44 } },
    caption: 'A gold C on the cell is the man wearing your armband that week.',
    cursor: null,
  },

  // The five readings. One shot each, because the single caption this used to
  // carry — "fixtures, points, clean sheets, threat, defensive returns" — was
  // guesswork dressed as an explanation, and three of the five were wrong.
  // Every caption below is now the page's own MODE_NOTE for that mode, so the
  // film cannot drift from what the grid actually shows. Each shot presets the
  // PREVIOUS mode and clicks its own, so the sequence reads as one pass along
  // the row however the shot order is cut.
  //
  // None of these zoom. The pointer is resolved against the unzoomed page, so
  // a click under a moving zoom lands the cursor next to the control it
  // appears to press — and here the click is the shot.

  plan_fix: {
    route: '/#/squad',
    seconds: 4,
    setup: presetToggles({ Fix: true, Names: true, Crests: true }),
    from: { text: 'Your season', align: 'top', offset: -70 },
    to: { text: 'Your season', align: 'top', offset: -70 },
    caption: 'Fix — the opponent, upper case at home, and difficulty is the colour of the text.',
    cursor: [[0, 0.5, 0.5], [1, 0.72, 0.14]],
  },

  plan_xp: {
    route: '/#/squad',
    seconds: 4,
    setup: presetToggles({ Fix: true, Names: true, Crests: true }),
    from: { text: 'Your season', align: 'top', offset: -70 },
    to: { text: 'Your season', align: 'top', offset: -70 },
    caption: 'xP — the points that man is projected to score that week.',
    cursor: [[0, 0.62, 0.36], [0.2, { text: 'xP' }], [0.5, { text: 'xP' }], [1, 0.6, 0.5]],
    actions: [{ at: 0.3, run: toggle('xP') }],
  },

  plan_cs: {
    route: '/#/squad',
    seconds: 4,
    setup: presetToggles({ xP: true, Names: true, Crests: true }),
    from: { text: 'Your season', align: 'top', offset: -70 },
    to: { text: 'Your season', align: 'top', offset: -70 },
    caption: 'CS% — the chance his team keeps a clean sheet.',
    cursor: [[0, 0.62, 0.36], [0.2, { text: 'CS%' }], [0.5, { text: 'CS%' }], [1, 0.6, 0.5]],
    actions: [{ at: 0.3, run: toggle('CS%') }],
  },

  plan_xgi: {
    route: '/#/squad',
    seconds: 4,
    setup: presetToggles({ 'CS%': true, Names: true, Crests: true }),
    from: { text: 'Your season', align: 'top', offset: -70 },
    to: { text: 'Your season', align: 'top', offset: -70 },
    caption: 'xGI — his expected goals plus assists.',
    cursor: [[0, 0.62, 0.36], [0.2, { text: 'xGI' }], [0.5, { text: 'xGI' }], [1, 0.6, 0.5]],
    actions: [{ at: 0.3, run: toggle('xGI') }],
  },

  plan_dc: {
    route: '/#/squad',
    seconds: 4,
    setup: presetToggles({ xGI: true, Names: true, Crests: true }),
    from: { text: 'Your season', align: 'top', offset: -70 },
    to: { text: 'Your season', align: 'top', offset: -70 },
    caption: 'DC% — the chance he hits the defensive-contribution threshold.',
    cursor: [[0, 0.62, 0.36], [0.2, { text: 'DC%' }], [0.5, { text: 'DC%' }], [1, 0.6, 0.5]],
    actions: [{ at: 0.3, run: toggle('DC%') }],
  },

  plan_names: {
    route: '/#/squad',
    seconds: 5,
    // Back on Fix with names off, so the click adds names to the fixtures and
    // the transfer bands appear against opponent codes rather than a metric.
    setup: presetToggles({ Fix: true, Names: false, Crests: true }),
    // The same framing as the five mode shots, and for the same reason: the
    // site's own nav is sticky and about seventy pixels deep, so anything that
    // puts the toggle row higher than this slides it underneath — and the
    // pointer then appears to press the nav rather than the control it clicks.
    from: { text: 'Your season', align: 'top', offset: -70 },
    to: { text: 'Your season', align: 'top', offset: -70 },
    // One line, deliberately: a two-line caption reaches far enough up the
    // frame to cover the second transfer band this shot is revealing.
    caption: 'Names on, and the plan shows its moves.',
    cursor: [[0, 0.6, 0.4], [0.18, { text: 'Names' }], [0.42, { text: 'Names' }], [1, 0.3, 0.6]],
    actions: [{ at: 0.28, run: setToggle('Names', true) }],
  },

  plan_transfers: {
    route: '/#/squad',
    seconds: 8,
    setup: presetToggles({ Fix: true, Names: true, Crests: true }),
    // Anchored on the seam mark itself. buildPlan puts the two moves on grid
    // rows five and ten, which is what makes a single frame able to hold both.
    from: { contains: '◂', align: 'top', offset: -223 },
    to: { contains: '◂', align: 'top', offset: -223 },
    // ox pins the origin at the left margin. Without it a 2.35x push around
    // the seam drags the sticky name column off the frame, and a transfer with
    // no player names beside it shows a colour rather than a decision.
    zoom: { from: 1.5, to: 2.35, at: { contains: '◂', ox: 44 } },
    // The bands sit low in the frame at the end of the push, so the caption
    // goes up top rather than over them.
    captionTop: true,
    caption: 'Red out, green in — the man leaving over his last week, the man arriving over his first.',
    cursor: null,
  },

  plan_tab_read: {
    route: '/#/squad',
    seconds: 4.5,
    setup: buildPlan,
    // Anchored to the tab row itself, not to the planner above it — the panel
    // below the tabs is the point, so the tabs sit near the top of frame.
    from: { text: 'Analysis', align: 'top', offset: -90 },
    to: { text: 'Analysis', align: 'top', offset: -90 },
    caption: 'Beside the board, the read: what you have actually built.',
    // role 'tab', not 'button'. As buttons these matched nothing at all and
    // every click silently timed out; and "Fixtures" as a plain name also
    // matches the top-nav link, which would have navigated off the page.
    cursor: [[0, 0.5, 0.45], [0.16, { text: 'Analysis', role: 'tab' }], [0.5, { text: 'Analysis', role: 'tab' }], [1, 0.45, 0.6]],
    actions: [{ at: 0.24, run: openPanel('Analysis') }],
  },

  plan_tab_fixtures: {
    route: '/#/squad',
    seconds: 4.5,
    setup: planThen(openPanel('Analysis')),
    from: { text: 'Analysis', align: 'top', offset: -90 },
    to: { text: 'Analysis', align: 'top', offset: -90 },
    caption: 'Fixtures — every man’s run, week by week.',
    cursor: [[0, 0.5, 0.45], [0.16, { text: 'Fixtures', role: 'tab' }], [0.5, { text: 'Fixtures', role: 'tab' }], [1, 0.45, 0.6]],
    actions: [{ at: 0.24, run: openPanel('Fixtures') }],
  },

  plan_tab_risk: {
    route: '/#/squad',
    seconds: 4.5,
    setup: planThen(openPanel('Fixtures')),
    from: { text: 'Analysis', align: 'top', offset: -90 },
    to: { text: 'Analysis', align: 'top', offset: -90 },
    caption: 'And Risk: what could go wrong with it, before it does.',
    cursor: [[0, 0.5, 0.45], [0.16, { text: 'Risk', role: 'tab' }], [0.5, { text: 'Risk', role: 'tab' }], [1, 0.45, 0.6]],
    actions: [{ at: 0.24, run: openPanel('Risk') }],
  },

  home_close: {
    route: '/#/',
    seconds: 5,
    from: { y: 0 },
    to: { y: 0 },
    caption: 'fplanalyser.co.uk',
    captionStyle: 'endcard',
    cursor: null,
  },
}

/** Named cuts. Cut A/B/C follow docs/LAUNCH.md's three verticals. */
export const CUTS = {
  full: [
    'home_open', 'preview_deadline', 'preview_match', 'preview_steps_up',
    'player_brief', 'fixtures_runs', 'squad_autopick', 'squad_insights',
    'scouting', 'home_close',
  ],
  // "the deadline" — strongest hook, post this one first
  a: ['preview_deadline', 'preview_match', 'preview_steps_up'],
  // "the player read" — one long slow scroll
  b: ['player_brief'],
  // "the planner" — fixtures, then the fifteen built on camera
  c: ['fixtures_runs', 'squad_autopick'],
  // A sampler of the effects, not part of the film. See the fx_* shots.
  fx: ['fx_dip', 'fx_spotlight', 'fx_callout', 'fx_blur', 'fx_hold', 'fx_progress'],
  // The season planner, for a standalone post on X. Render it --format desk.
  planner: [
    'plan_open', 'plan_bars', 'plan_chip', 'plan_risk', 'plan_captain',
    'plan_fix', 'plan_xp', 'plan_cs', 'plan_xgi', 'plan_dc',
    'plan_names', 'plan_transfers',
    'plan_tab_read', 'plan_tab_fixtures', 'plan_tab_risk',
  ],
}

export function secondsFor(shot, format) {
  return typeof shot.seconds === 'number' ? shot.seconds : forFormat(shot.seconds, format)
}

export { forFormat }
