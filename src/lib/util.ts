// util.ts — shared pure helpers: team names/codes/badges, string utils,
// star parsing, FDR colours, tooltip text. Ported from js/util.js. Rendering
// (badges, stars, tooltips, fixture chips) lives in components/.

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
  const code = teamCodes[team]
  return code ? `https://resources.premierleague.com/premierleague/badges/t${code}.png` : null
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

export function getPositionEmoji(pos: string): string {
  return ({ GKP: '🧤', DEF: '🛡️', MID: '⚡', FWD: '⚽' } as Record<string, string>)[pos] || '👤'
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
  4: ['#E8434F', '#fff'],
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
  set_piece_share: 'Share of the team’s expected goals that come from set pieces and penalties. High values flag a set-piece threat.',
  overall: 'Availability-adjusted expected points on one absolute scale across all players — FPL points are worth the same whoever scores them. Built from expected points per game (xG, xA, clean-sheet probability, defensive contributions, saves and bonus at their real FPL point values, refined by shot quality, box presence, shots on target, chance quality and set-piece delivery), then adjusted for how often the player actually starts. 50 = league average; only exceptional seasons approach 99.',
  xpts: 'Expected FPL points per game from the underlying data: xG × goal value + xA × 3 + clean-sheet probability × value + defensive contributions + saves + bonus, with quality modifiers from shot quality, box presence, shots on target, touches in the box, chance quality and set-piece delivery. What the player "should" score per game — before availability.',
  save: 'Based on saves per90 and frequency of earning save points (3+ saves per game). Higher = more active shot-stopper.',
  cs: 'Based on clean sheet rate, xGC per90 and goals conceded vs xGC. Higher = better defensive record.',
  goal: 'Based on xG per90 and goals per90, adjusted for shot-profile sustainability: xG backed by shots in the box and shots on target is boosted; xG built on long-range pot-shots is trimmed.',
  creative: 'Based on xA per90 and assists per90, refined with chances created and big chances created per90 when opta data is available.',
  shot_quality: 'Non-penalty xG per shot. High = takes high-quality chances (close range, good positions). Low = shoots from anywhere.',
  finishing_skill: 'Sustained goals-minus-xG. Positive = converting above expectation (clinical); negative = leaving goals on the pitch.',
  creativity_depth: 'xG Chain + xG Buildup per90 — involvement in moves that lead to shots, even without the final pass. Finds deep playmakers whose value xA misses.',
  set_piece: 'Set piece delivery volume per90 (crosses, corners taken, free kick deliveries). Set piece takers have extra assist routes.',
  next4: "Fixture-adjusted forward rating: the player's quality and form (season + last 4 GW ratings) weighted by how attackable their next 4 gameweeks of opponents are, based on opponent recent xG conceded (for attackers) and xG created (for defenders/keepers), with home/away adjustment.",
  dc: 'Based on frequency of hitting the defensive contribution threshold and tackles/interceptions per90.',
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
    'Shot Stopper': 'High saves and high xGC — this keeper is carrying a leaky defence but making crucial saves.',
    'Premium Keeper': 'High saves but low xGC — faces lots of shots but mostly low quality. Gets save points AND clean sheets.',
    'Sweeper Keeper': 'Low saves and low xGC — easy life behind a solid defence. Buy for clean sheets not save points.',
    Overperformer: 'Goals conceded significantly below xGC — keeper or defence is beating the odds.',
    Liability: 'Goals conceded significantly above xGC — errors or bad luck costing points.',
    'Reliable Shieldwall': 'High clean sheets with goals conceded below xGC — deserved defensive record.',
    'Flattering Back': 'High clean sheets but xGC suggests they have been fortunate. May not sustain.',
    'Attacking Defender': 'High xA per90 — this defender contributes significantly in attack.',
    'Scoring Defender': 'High xG per90 for a defender — genuine goal threat from set pieces or runs.',
    'Defensive Workhorse': 'Regularly hits the defensive contribution threshold — earns DC bonus points consistently.',
    'Emerging Contributor': 'Just below the DC threshold regularly — could start earning bonus points soon.',
    'Budget Enabler': 'Cheap, plays regularly and keeps clean sheets. Ideal budget defensive option.',
    'Goal Machine': 'High xG per90 — genuine goal threat with strong underlying numbers.',
    'Clinical Finisher': 'Scoring significantly above their xG — converting chances at an elite rate.',
    'Wasteful Striker': 'High xG but goals well below it — underperforming their chances.',
    'Creative Wizard': 'High xA per90 — elite chance creator.',
    'xGI Beast': 'High combined xG and xA — heavily involved in attacks even when returns do not show.',
    'Defensive Contributor': 'Regularly hits the DC threshold for midfielders — earns defensive bonus points.',
    'Captaincy King': 'Top points scorer — elite captaincy option.',
    Metronome: 'Consistent moderate returns every week — reliable floor player.',
    'Chaos Merchant': 'High variance — boom or bust. Hard to predict week to week.',
    Differential: 'Low ownership but decent returns — could give you an edge over your rivals.',
    'Bonus Magnet': 'High BPS — virtually guaranteed bonus points when they get any return.',
    'Minutes Monster': 'Starts almost every game and plays the full 90. Completely nailed.',
    'Minutes Risk': 'Not starting regularly in the last 4 games. Risky to own right now.',
    'Volume Shooter': 'Lots of shots but poor shot quality — long-range efforts that rarely convert. xG may flatter.',
    Poacher: 'Shots concentrated in the six-yard box with little buildup involvement. Feeds off service.',
    'Set Piece Threat': 'On set piece duty (corners/free kicks) with high delivery volume — extra assist and goal routes.',
    'Aerial Threat': 'Top-quintile headed-shot volume for their position — dangerous from crosses and corners.',
    'Deep Lying Creator': 'High xG chain/buildup with low direct goal threat — drives attacks from deep. Value that xA misses.',
  },
}
