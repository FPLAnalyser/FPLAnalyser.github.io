// What is worth saying today, found in the data the site already computes.
//
// This is the part a generic FPL bot cannot do. The scheduled refreshes commit
// fresh ratings, price pressure, fixture difficulty and persona shifts to
// `main` every morning; by 06:45 there is a fact in there that nobody else has
// worked out yet. A story is that fact plus the shape of a sentence — never a
// take, never a prediction the model made up.
//
// Every finder returns the SAME shape, so composing and ranking do not care
// which one produced what:
//
//   { id, kind, score, headline, lines[], route, facts{} }
//
// `score` is a 0-1 estimate of how interesting the story is TODAY, so a slow
// news day surfaces a fixture run and a dramatic one surfaces the price moves.
// `facts` carries the numbers separately from the prose, which is what lets
// the rewrite step be checked arithmetically rather than trusted.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SITE = 'https://fplanalyser.co.uk'

/** Minutes below which last season's per-game numbers are noise, not signal. */
const REAL_SAMPLE_MINS = 1200

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const one = (v) => Math.round(v * 10) / 10
const two = (v) => Math.round(v * 100) / 100

async function load(season, file) {
  const raw = await readFile(path.join(ROOT, 'site_data', season, file), 'utf8')
  return JSON.parse(raw)
}

/** Everything a finder might need, read once. A missing file is not fatal. */
export async function loadSeason(season) {
  const want = [
    'meta', 'ratings', 'price_risk', 'fixture_ease', 'persona_shifts', 'teams',
  ]
  const out = {}
  for (const name of want) {
    try { out[name] = await load(season, `${name}.json`) } catch { out[name] = null }
  }
  if (!out.meta) throw new Error(`no meta.json for season ${season}`)
  return out
}

/** The season the site is currently serving. */
export async function currentSeason() {
  const raw = await readFile(path.join(ROOT, 'site_data', 'seasons.json'), 'utf8')
  return JSON.parse(raw).current
}

// ---------------------------------------------------------------- finders

/**
 * Who the transfer market is about to reprice.
 *
 * The strongest daily story there is, because it is time-limited: a rise
 * tonight is worth acting on this morning and worthless tomorrow. `velocity`
 * is the site's own progress-toward-a-change measure, so the threshold is a
 * property of the data rather than a number invented here.
 */
function priceMoves({ price_risk }) {
  if (!price_risk?.length) return []
  const out = []

  for (const dir of ['rise', 'drop']) {
    const moving = price_risk
      .filter((p) => p.risk === dir && num(p.velocity))
      .sort((a, b) => Math.abs(b.velocity) - Math.abs(a.velocity))
    if (!moving.length) continue

    const lead = moving[0]
    const verb = dir === 'rise' ? 'rising' : 'falling'
    out.push({
      id: `price-${dir}`,
      kind: 'price',
      // Velocity is roughly 0-1 against the threshold, so a player most of the
      // way there is a better story than a squad of players barely moving.
      score: Math.min(1, Math.abs(lead.velocity) * 2.2),
      headline: `${moving.length} ${verb} in price`,
      lines: [
        `${moving.length} players are ${verb} in price.`,
        `${lead.web_name} (${lead.team}) is closest: ${fmtTransfers(lead.net_transfers_2gw)} net transfers over two gameweeks.`,
      ],
      route: '/#/players',
      facts: {
        count: moving.length,
        name: lead.web_name,
        team: lead.team,
        net: Math.abs(lead.net_transfers_2gw),
      },
    })
  }
  return out
}

function fmtTransfers(n) {
  const abs = Math.abs(n)
  const sign = n > 0 ? '+' : '−'
  if (abs >= 1000) return `${sign}${one(abs / 1000)}k`
  return `${sign}${abs}`
}

/**
 * The club whose next six weeks are kindest, and the one facing the wall.
 *
 * Deliberately reports the average difficulty alongside the claim. The spread
 * between best and worst run is often under a point, and a post that says
 * "easiest run in the league" without the number is technically true and
 * practically overclaiming — which is the sort of thing that loses an account
 * its credibility faster than being boring does.
 */
function fixtureRuns({ meta, fixture_ease }, { weeks = 6 } = {}) {
  if (!fixture_ease?.length) return []
  const start = meta.next_gw
  if (!num(start)) return []

  const byTeam = new Map()
  for (const row of fixture_ease) {
    if (row.gw < start || row.gw >= start + weeks) continue
    if (!byTeam.has(row.team)) byTeam.set(row.team, [])
    byTeam.get(row.team).push(row)
  }

  const runs = [...byTeam.entries()]
    .filter(([, rows]) => rows.length >= weeks)
    .map(([team, rows]) => ({
      team,
      avg: rows.reduce((s, r) => s + r.fdr, 0) / rows.length,
      // Upper case at home, matching the grammar the site's own fixture grid
      // uses — a reader who has seen the planner already knows how to read it.
      run: rows.sort((a, b) => a.gw - b.gw)
        .map((r) => (r.venue === 'H' ? r.opponent.toUpperCase() : r.opponent.toLowerCase()))
        .join(' '),
    }))
    .sort((a, b) => a.avg - b.avg)

  if (runs.length < 2) return []
  const best = runs[0]
  const worst = runs[runs.length - 1]
  const spread = worst.avg - best.avg

  return [{
    id: 'fixture-run',
    kind: 'fixtures',
    // A league where everyone's next six are the same is not a story. The
    // spread is what makes it one, so it is what the score is built on.
    score: Math.min(1, spread / 1.5),
    headline: `${best.team} have the kindest run to GW${start + weeks - 1}`,
    lines: [
      `Kindest run from GW${start}: ${best.team}, averaging ${two(best.avg)} on difficulty.`,
      // The opponent codes are unreadable without the casing rule, and the
      // rule is three words. Both go on one line so a tightened post that
      // keeps only the first line does not keep a run nobody can parse.
      `${best.run} — capitals are home.`,
      `Hardest: ${worst.team} at ${two(worst.avg)}.`,
    ],
    route: '/#/fixtures',
    facts: {
      team: best.team, avg: two(best.avg), from: start, to: start + weeks - 1,
      worst: worst.team, worstAvg: two(worst.avg),
    },
  }]
}

/**
 * The best expected points per million anyone is getting.
 *
 * Filtered to players with a real sample. Without the minutes floor the top of
 * this list is whoever had a hot fortnight off the bench at £4.5m, which is an
 * artefact rather than a pick, and posting one costs more credibility than the
 * engagement is worth.
 */
function valuePick({ meta, ratings }) {
  if (!ratings?.length) return []
  const pool = ratings.filter((p) =>
    num(p.season_xpts_per_game) && num(p.price) && p.price > 0 &&
    num(p.total_mins) && p.total_mins >= REAL_SAMPLE_MINS)
  if (!pool.length) return []

  const [lead] = [...pool].sort((a, b) =>
    b.season_xpts_per_game / b.price - a.season_xpts_per_game / a.price)

  return [{
    id: 'value',
    kind: 'value',
    score: 0.55,
    headline: `${lead.web_name} is the best value in the game`,
    lines: [
      `Best expected points per million: ${lead.web_name} (${lead.team}, ${lead.position}) at £${one(lead.price)}m.`,
      `${two(lead.season_xpts_per_game)} xP a game${seasonNote(meta)}, ${one(lead.selected_by_percent)}% owned.`,
    ],
    route: `/#/player?name=${encodeURIComponent(lead.web_name)}`,
    facts: {
      name: lead.web_name, team: lead.team, price: one(lead.price),
      xp: two(lead.season_xpts_per_game), owned: one(lead.selected_by_percent),
    },
  }]
}

/**
 * A player the model rates and the crowd has not found.
 *
 * Ownership is the whole point, so the ceiling is deliberately low: at 8% a
 * pick is a template piece with a differential's reputation, and calling it
 * one is the kind of small dishonesty an audience notices.
 */
function differential({ meta, ratings }, { maxOwned = 8 } = {}) {
  if (!ratings?.length) return []
  const pool = ratings.filter((p) =>
    num(p.season_overall_score) && num(p.selected_by_percent) &&
    p.selected_by_percent < maxOwned &&
    num(p.total_mins) && p.total_mins >= REAL_SAMPLE_MINS)
  if (!pool.length) return []

  const [lead] = [...pool].sort((a, b) => b.season_overall_score - a.season_overall_score)

  return [{
    id: 'differential',
    kind: 'differential',
    // The less owned he is at a given rating, the better the story.
    score: Math.min(1, 0.35 + (maxOwned - lead.selected_by_percent) / 20),
    headline: `${lead.web_name} at ${one(lead.selected_by_percent)}% owned`,
    lines: [
      // The numeric score, not the site's star string. The stars are the right
      // notation on a page that shows a legend beside them; in a post they are
      // emoji with no key, and they contradict the no-emoji rule the rewrite
      // step is held to.
      `${lead.web_name} (${lead.team}, ${lead.position}, £${one(lead.price)}m) rates ${one(lead.season_overall_score)} out of 5 and is owned by ${one(lead.selected_by_percent)}%.`,
      `${lead.season_total_points} points${seasonNote(meta)}.`,
    ],
    route: `/#/player?name=${encodeURIComponent(lead.web_name)}`,
    facts: {
      name: lead.web_name, team: lead.team, price: one(lead.price),
      owned: one(lead.selected_by_percent), points: lead.season_total_points,
    },
  }]
}

/**
 * Someone whose role has changed.
 *
 * The site classifies players into personas — Poacher, Set Piece Specialist,
 * Deep Lying Playmaker — and records what each man gained or lost. A gained
 * persona is a role change stated in one word, which is the most compressible
 * story in the whole dataset.
 */
function personaShift({ persona_shifts }) {
  if (!persona_shifts?.length) return []
  const gained = persona_shifts.filter((p) => p.gained?.length)
  if (!gained.length) return []

  const lead = gained[0]
  const persona = lead.gained[0]
  return [{
    id: 'persona',
    kind: 'persona',
    score: 0.4,
    // Half the persona names already carry their article — "The Raider", "The
    // Enforcer" — so a blanket "a" produces "a The Raider".
    headline: `${lead.web_name} is now ${article(persona)}${persona}`,
    lines: [
      `${lead.web_name} (${lead.team}, ${lead.position}) has picked up a new role: ${persona}.`,
      `${gained.length} players changed persona in the latest run.`,
    ],
    route: `/#/player?name=${encodeURIComponent(lead.web_name)}`,
    facts: { name: lead.web_name, team: lead.team, persona, count: gained.length },
  }]
}

const article = (s) => (/^(the|an?)\s/i.test(s) ? '' : /^[aeiou]/i.test(s) ? 'an ' : 'a ')

/**
 * Pre-season, every per-game number is carried from last season. Saying so is
 * not a disclaimer, it is the difference between a true post and a false one.
 */
function seasonNote(meta) {
  return meta.provisional && meta.ratings_season ? ` in ${label(meta.ratings_season)}` : ''
}

const label = (id) => id.replace('-', '/')

// ---------------------------------------------------------------- ranking

const FINDERS = [priceMoves, fixtureRuns, valuePick, differential, personaShift]

/**
 * Every story in today's data, best first.
 *
 * `exclude` carries the ids used recently so the account does not post the
 * same shape three mornings running — the second-best story today beats the
 * best one repeated, because a feed that repeats itself reads as automated
 * whatever the numbers underneath are worth.
 */
export function rank(data, { exclude = [] } = {}) {
  const skip = new Set(exclude)
  return FINDERS
    .flatMap((find) => {
      try { return find(data) } catch { return [] }
    })
    .filter((s) => s && s.lines?.length)
    .map((s) => ({ ...s, url: `${SITE}${s.route}`, repeat: skip.has(s.id) }))
    // A repeat is not banned, only heavily demoted: on a quiet morning the
    // same story again beats no story at all.
    .sort((a, b) => (b.score - (b.repeat ? 0.5 : 0)) - (a.score - (a.repeat ? 0.5 : 0)))
}
