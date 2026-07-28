// util.ts — shared pure helpers: team names/codes/badges, string utils,
// star parsing, FDR colours, tooltip text. Ported from js/util.js. Rendering
// (badges, stars, tooltips, fixture chips) lives in components/.

import { teamCodeFor, teamNameFor } from './teamRegistry'

export const teamFullNames: Record<string, string> = {
  ARS: 'Arsenal', AVL: 'Aston Villa', BOU: 'Bournemouth', BRE: 'Brentford', BHA: 'Brighton',
  BUR: 'Burnley', CHE: 'Chelsea', CRY: 'Crystal Palace', EVE: 'Everton', FUL: 'Fulham',
  LEE: 'Leeds', LIV: 'Liverpool', MCI: 'Man City', MUN: 'Man Utd', NEW: 'Newcastle',
  NFO: "Nott'm Forest", SUN: 'Sunderland', TOT: 'Spurs', WHU: 'West Ham', WOL: 'Wolves',
}

export const teamCodes: Record<string, number> = {
  ARS: 3, AVL: 7, BUR: 90, BOU: 91, BRE: 94, BHA: 36, CHE: 8, CRY: 31,
  EVE: 11, FUL: 54, LEE: 2, LIV: 14, MCI: 43, MUN: 1, NEW: 4, NFO: 17,
  SUN: 56, TOT: 6, WHU: 21, WOL: 39,
}

export function teamBadgeUrl(team: string): string | null {
  // Prefer the code from loaded data (covers promoted clubs) then the fallback map.
  const code = teamCodeFor(team) ?? teamCodes[team]
  return code ? `https://resources.premierleague.com/premierleague/badges/t${code}.png` : null
}

/** Full club name — data first (promoted clubs), then the fallback map, then the code. */
export function teamLabel(team: string): string {
  return teamNameFor(team) || teamFullNames[team] || team
}

/** Club accent colours for hero glows/highlights — tuned to read on dark. */
export const teamColors: Record<string, string> = {
  ARS: '#ff5e56', AVL: '#9fc6e8', BOU: '#e8544c', BRE: '#ff6a63', BHA: '#5ba0f0',
  BUR: '#b06584', CHE: '#5f8fe8', CRY: '#6f8fe0', EVE: '#5d84e6', FUL: '#b9c2cf',
  LEE: '#ffd75e', LIV: '#ff5e6c', MCI: '#7ad1ff', MUN: '#ff6a5e', NEW: '#8fd6f7',
  NFO: '#ff6259', SUN: '#ff6272', TOT: '#8ea9d8', WHU: '#c76f83', WOL: '#ffc44d',
}

/** Accent-insensitive comparison ("Dubravka" matches "Dúbravka"). */
export function norm(s: unknown): string {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Extra search terms per web_name — FPL abbreviates famous names to an
 *  initial ("B.Fernandes"), so searching "bruno" found nothing. Keyed by
 *  web_name, matched in addition to the displayed name. */
const SEARCH_ALIASES: Record<string, string> = {
  'B.Fernandes': 'bruno fernandes',
  'J.Timber': 'jurrien timber',
  'M.Salah': 'mohamed mo salah',
  'N.Williams': 'neco williams',
  'R.James': 'reece james',
  'D.Luiz': 'douglas luiz',
  'A.Becker': 'alisson becker',
  'J.Ramsey': 'jacob ramsey',
  'Sánchez': 'robert sanchez',
  'Virgil': 'van dijk virgil',
  'Raúl': 'raul jimenez',
  'Kiwior': 'jakub kiwior',
  'Gabriel': 'gabriel magalhaes',
  'Bruno G.': 'bruno guimaraes',
}

/** Everything a player row should match on: the displayed name plus any
 *  alias, accent-folded. */
export function searchText(webName: unknown): string {
  const n = String(webName)
  const alias = SEARCH_ALIASES[n]
  // Split "B.Fernandes" so the surname alone matches too.
  return norm(alias ? `${n} ${alias}` : n).replace(/\./g, ' ') + ' ' + norm(n)
}

export function getPositionEmoji(pos: string): string {
  return ({ GKP: '🧤', DEF: '🛡️', MID: '⚡', FWD: '⚽' } as Record<string, string>)[pos] || '👤'
}

/** Player-detail URL. Always include the permanent `code` when known so two
 *  players who share a web_name (e.g. two Hendersons) never collide. */
export function playerHref(name: string | null | undefined, code?: number | null): string {
  const n = encodeURIComponent(String(name ?? ''))
  return code != null ? `/player?name=${n}&code=${code}` : `/player?name=${n}`
}

/** Ordinal suffix: 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th". */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Parse a pipeline star string like "⭐⭐⭐½" into a number, or null. */
export function starsToNum(s: unknown): number | null {
  if (!s || typeof s !== 'string') return null
  const stars = (s.match(/⭐/g) || []).length
  const half = s.includes('½') ? 0.5 : 0
  const total = stars + half
  return total > 0 ? total : null
}

/** Coerce a rating value (0–5 number, or star string) to a number, or null. */
export function ratingToNum(value: unknown): number | null {
  if (typeof value === 'string') return starsToNum(value)
  if (typeof value === 'number' && !isNaN(value)) return value
  return null
}

export function avgRatingField<T extends Record<string, unknown>>(rows: T[], field: string): number | null {
  const vals = rows.map((r) => starsToNum(r[field])).filter((v): v is number => v !== null)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

// Fixture difficulty colours: [background, text]. FDR 3 is a neutral dark chip.
export const FDR_COLORS: Record<number, [string, string]> = {
  1: ['#2F5D24', '#EAF5E4'],
  2: ['#27C46B', '#06240F'],
  3: ['#39424E', '#E8EDF3'],
  // #E8434F put white text at 3.93:1 — under the bar at the 11px these chips
  // are set in, and the only one of the five that failed. Darkened just far
  // enough to clear it (4.75:1) so it still reads as a distinct red against
  // chip 5's maroon rather than collapsing into it.
  4: ['#D33844', '#fff'],
  5: ['#7A1030', '#fff'],
}

export interface TooltipDict {
  [key: string]: string | Record<string, string>
}

export const TOOLTIPS: TooltipDict = {
  attack: 'Our 0–100 team attack rating: a percentile blend of xG, box-shot share, shot volume, chance creation, finishing edge and shot quality across the 20 teams. Higher = more dangerous going forward.',
  defence: 'Our 0–100 team defence rating: a percentile blend of xG conceded, box shots conceded, shots-conceded volume, clean-sheet rate, keeping edge and shot-quality conceded. Higher = harder to score against.',
  team_xg: 'Total expected goals — the quality-weighted sum of the chances this team has created.',
  team_xgc: 'Total expected goals conceded — the quality-weighted sum of the chances this team has allowed.',
  team_xa: 'Total expected assists — the quality-weighted sum of the chances this team has created for teammates.',
  finish_delta: 'Finishing vs the league: goals scored minus xG, shown relative to the league average. Positive (green) = clinical, converting above expectation; negative = wasteful.',
  prevent_delta: 'Prevention vs the league: expected goals conceded minus goals conceded, relative to the league average. Positive (green) = keeping out more than expected; negative = leaky.',
  box_share: 'Share of the team’s shots taken from inside the box (six-yard + penalty area). Higher = better shot locations.',
  box_share_conceded: 'Share of shots conceded that came from inside the box. Lower = keeping opponents to lower-quality chances.',
  set_piece_share: 'Share of the team’s expected goals that come from open-play set pieces — corners and free kicks. Penalties are excluded (see the Penalty column). High values flag a set-piece threat.',
  pen_share: 'Share of the team’s expected goals that come from penalties only. A distinct, transferable threat that hinges on the penalty taker.',
  overall: 'Availability-adjusted expected points on one absolute scale across all players — FPL points are worth the same whoever scores them. Built from expected points per game (xG, xA, clean-sheet probability, defensive contributions, saves and bonus at their real FPL point values, refined by shot quality, box presence, shots on target, chance quality and set-piece delivery), then adjusted for how often the player actually starts. 50 = league average; only exceptional seasons approach 99.',
  xpts: 'Expected FPL points per game from the underlying data: xG × goal value + xA × 3 + clean-sheet probability × value + defensive contributions + saves + bonus, with quality modifiers from shot quality, box presence, shots on target, touches in the box, chance quality and set-piece delivery. What the player "should" score per game — before availability.',
  save: 'Availability-adjusted expected save points: saves per game at their FPL value, scaled by how often the keeper starts. On one absolute scale across all keepers.',
  cs: 'Availability-adjusted expected clean-sheet points: the probability of a clean sheet (from xGC blended with the realised rate) at its FPL value, eased by the shot load faced, then scaled by how often the player starts. On one absolute scale.',
  goal: 'Availability-adjusted expected goal points: expected goals at their FPL value, refined by shot quality, box-shot share and shots on target, then scaled by how often the player actually starts. On one absolute scale — a big per-90 threat who rarely starts scores below a nailed one. The columns show the raw ingredients.',
  creative: 'Availability-adjusted expected assist points: expected assists at 3 pts each, refined by big chances, deep creation and set-piece delivery, then scaled by how often the player starts. On one absolute scale. The columns show the raw ingredients.',
  shot_quality: 'Non-penalty xG per shot. High = takes high-quality chances (close range, good positions). Low = shoots from anywhere.',
  finishing_skill: 'Sustained goals-minus-xG. Positive = converting above expectation (clinical); negative = leaving goals on the pitch.',
  creativity_depth: 'xG Chain + xG Buildup per90 — involvement in moves that lead to shots, even without the final pass. Finds deep playmakers whose value xA misses.',
  set_piece: 'Set piece delivery volume per90 (crosses, corners taken, free kick deliveries). Set piece takers have extra assist routes.',
  next4: "Fixture-adjusted forward rating: the player's quality and form (season + last 4 GW ratings) weighted by how attackable their next 4 gameweeks of opponents are, based on opponent recent xG conceded (for attackers) and xG created (for defenders/keepers), with home/away adjustment.",
  dc: 'Availability-adjusted expected defensive-contribution points: how often the player hits FPL’s DC threshold for the 2-point bonus (10 CBIT for defenders; 12 including recoveries for MID/FWD), scaled by how often they start. On one absolute scale. The columns show tackles, CBI and recoveries per 90.',
  attacking: 'Based on xA and xG per90 for defenders. Identifies defenders who contribute offensively.',
  bps: 'Based on BPS and bonus per90. Players who consistently earn bonus points when they get any return.',
  value: 'Points per game divided by price. Higher = better value for money relative to cost.',
  reliability: 'Start rate across the season. Higher = more nailed in the starting XI.',
  mins90: 'How often a player completes 90 minutes when they start. Lower = frequently substituted.',
  alpha: 'Average points above the position benchmark per game. Positive = outperforming peers. The higher the better.',
  sharpe: 'Risk-adjusted return. Alpha divided by score volatility. Above 1.0 is good, above 2.0 is excellent. Below 0 means underperforming on a risk-adjusted basis.',
  sortino: 'Like Sharpe but only penalises bad weeks (blanks). Above 1.0 is good, above 2.0 is excellent. Higher than Sharpe = good upside with occasional blanks. Lower than Sharpe = volatility mostly on the downside.',
  consistency: 'Measures week-to-week score variation. Below 0.3 = very predictable. Above 0.6 = highly variable. Around 0.4-0.5 is typical.',
  personas: {
    // Identity — what kind of player he is. Eleven of the sixteen names are
    // football's own words rather than ours, which is why they need so little
    // explaining: a poacher is a poacher on any gantry in the country.
    'The Spectator': 'Barely has a save to make — the defence in front of him concedes almost no shots. His points are clean sheets, not saves.',
    'The Last Line': 'Behind a defence that leaks shots. Three saves a game, so the save points are the whole investment case — the clean sheets are not coming.',
    'Complete Keeper': 'Busy and protected at the same time: high save volume with a low xGC. Save points and clean-sheet points from the same price.',
    'The Enforcer': 'Clears the defensive-contribution threshold week after week. Two points a game before anything else happens.',
    'The Supply Line': 'A defender with a genuine assist threat. He is not only a clean-sheet bet.',
    'The Raider': 'Gets into the box himself — real goal threat from the back, usually attacking the near post.',
    Poacher: 'Lives in the six-yard box and does almost nothing in build-up. Judge his team\u2019s chance creation, not his involvement.',
    'Goal Machine': 'Serious xG volume from good positions. The shots are there and they are the right shots.',
    Playmaker: 'The attack runs through him. Chances created, not just xA — he plays the final ball.',
    'Deep Lying Playmaker': 'Starts the moves he never finishes. A first-phase creator, so his thin xA understates how involved he is.',
    'Ball Winner': 'Clears the 12-action defensive threshold. Two points a game earned entirely off the ball.',
    'Shoots On Sight': 'Pot-shots from range. Plenty of shots but poor shot quality, so the returns lag the shot count.',
    Metronome: 'Scores steadily. Low variance — never wins your week, never loses it either.',
    'Boom or Bust': 'Blank, blank, seventeen. High variance: a captaincy gamble rather than a floor.',
    'Set Piece Specialist': 'On the deliveries, or on the end of them. The single most useful thing to know about a cheap defender.',
    'Aerial Threat': 'Top-quintile headed-shot volume for his position — dangerous from crosses and corners.',
    // Status — true this window, not a verdict on the player. Deliberately
    // plain: a memorable name for a temporary state reads as a permanent one.
    'Beating his xGC': 'Conceding fewer goals than the chances he faces — the shot-stopping metric running in his favour.',
    'Conceding above xGC': 'Shipping more than the chances warrant. Part him, part the back four in front of him.',
    'Clean sheets earned': 'The underlying numbers back the clean sheets up. This is a real defensive record.',
    'Clean sheets flattered': 'Clean sheets the chances faced do not support. It may not hold.',
    'Beating his xG': 'Scoring above the quality of his chances. Enjoy it, but the model expects it to fade.',
    'Due a goal': 'Getting the chances and missing them. The process is fine; the finishing should catch up.',
    'Returns overdue': 'Heavily involved in attacks, with none of it landing on the scoresheet yet.',
    'One action short': 'Repeatedly within three actions of the defensive threshold without clearing it.',
    'Under-owned': 'Genuinely low ownership and still producing — an edge over your rivals.',
    'Ever-present': 'Starts almost every game and plays the full 90. Completely nailed.',
    'Minutes risk': 'Not starting regularly over the last 4 games. Everything else here rests on a thin sample.',
  },
}

/* ── Derbies ─────────────────────────────────────────────────────────────
   Named where football names them, and "London derby" for the rest, because
   six clubs in one city produce fifteen pairings and only three of them have
   a name anyone uses. A fixture only gets the ribbon if it earns it. */
const NAMED_DERBIES: [string, string, string][] = [
  ['LIV', 'EVE', 'Merseyside derby'],
  ['MCI', 'MUN', 'Manchester derby'],
  ['ARS', 'TOT', 'North London derby'],
  ['NEW', 'SUN', 'Tyne–Wear derby'],
  ['CRY', 'BHA', 'M23 derby'],
  ['LEE', 'HUL', 'Yorkshire derby'],
  ['CHE', 'FUL', 'West London derby'],
  ['CHE', 'BRE', 'West London derby'],
  ['FUL', 'BRE', 'West London derby'],
  ['AVL', 'WOL', 'Midlands derby'],
  ['NFO', 'LEI', 'East Midlands derby'],
  ['IPS', 'NOR', 'East Anglian derby'],
  ['BUR', 'BLA', 'Lancashire derby'],
]
const LONDON = new Set(['ARS', 'TOT', 'CHE', 'CRY', 'FUL', 'BRE', 'WHU'])

export function derbyName(a: string, b: string): string | null {
  for (const [x, y, name] of NAMED_DERBIES) {
    if ((a === x && b === y) || (a === y && b === x)) return name
  }
  return LONDON.has(a) && LONDON.has(b) ? 'London derby' : null
}
