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

/** Output formats. CSS width drives which layout the site renders. */
export const FORMATS = {
  // 1280x720 CSS at 1.5x = 1920x1080. Desktop layout, full HD.
  wide: { css: { width: 1280, height: 720 }, scale: 1.5, label: '1920x1080' },
  // 432x768 CSS at 2.5x = 1080x1920. Mobile layout, natively rendered rather
  // than cropped out of the desktop capture, so text stays readable.
  vertical: { css: { width: 432, height: 768 }, scale: 2.5, label: '1080x1920' },
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
    from: { y: 0 },
    to: { y: 700 },
    caption: 'Find the best run of fixtures for every club — and when to jump.',
    cursor: [[0, 0.6, 0.35], [1, 0.5, 0.6]],
  },

  squad_builder: {
    route: '/#/squad',
    seconds: { wide: 10, vertical: 8 },
    from: { y: 0 },
    to: { y: 600 },
    caption: 'Build an XI and plan the season week by week.',
    cursor: [[0, 0.3, 0.4], [0.5, 0.6, 0.55], [1, 0.45, 0.7]],
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

  home_close: {
    route: '/#/',
    seconds: 6,
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
    'player_brief', 'fixtures_runs', 'squad_builder', 'scouting', 'home_close',
  ],
  // "the deadline" — strongest hook, post this one first
  a: ['preview_deadline', 'preview_match', 'preview_steps_up'],
  // "the player read" — one long slow scroll
  b: ['player_brief'],
  // "the planner"
  c: ['fixtures_runs', 'squad_builder'],
}

export function secondsFor(shot, format) {
  return typeof shot.seconds === 'number' ? shot.seconds : shot.seconds[format]
}
