/* What the market blend does to a real player's xP.

   Not a unit test of the arithmetic — the arithmetic is easy to get right and
   still ship a number nobody should believe. This runs the actual engine over
   the actual site_data, twice: once with the props map empty, once with the
   prices the live pull returned for GW1, and prints the difference.

   The market xG values below are the ones refresh_player_props.py produced on
   the runner (Arsenal v Coventry, Everton v Palace, Hull v United), because
   player_props.json is not committed yet and the artifact host is unreachable
   from here. Everything else — ratings, shot profiles, the xP model, the team
   lambdas — is read from site_data as the site reads it.  */
import { readFileSync } from 'node:fs'
import { xpForGw, xpPartsForGw, type XpModel, type MarketOdds, type ShotProfiles } from '../src/lib/xp'
import type { FixtureEaseRow, Row } from '../src/lib/types'

const SEASON = JSON.parse(readFileSync('site_data/seasons.json', 'utf8')).seasons[0].id
const read = (n: string) => JSON.parse(readFileSync(`site_data/${SEASON}/${n}.json`, 'utf8'))

const ratings: Row[] = read('ratings')
const ease: FixtureEaseRow[] = read('fixture_ease')
/* Shaped exactly as useXpModel shapes it — spread, not relisted. The hook
   carries a comment about why: an explicit field list dropped `pen` and `mins`
   silently, and the penalty term measured as working and shipped inert. A
   probe that rebuilds the model its own way reproduces that bug rather than
   catching it. */
const modelFile = read('xp_model')
const byCode = new Map<number, never>()
for (const p of modelFile.players) byCode.set(p.code, p)
const { players: _drop, ...modelRest } = modelFile
const model: XpModel = { ...modelRest, dcCurve: modelFile.dcCurve ?? {}, byCode } as XpModel
const profiles: ShotProfiles = read('shot_profiles')
const odds = read('odds')
const teams: { short_name: string }[] = read('teams')
const shortOf = (id: number) => teams[id - 1]?.short_name

const byKey = new Map<string, { for: number; against: number }>()
for (const m of odds.matches) {
  const h = shortOf(m.h), a = shortOf(m.a)
  if (!h || !a) continue
  byKey.set(`${h}:${m.gw}:${a}`, { for: m.lh, against: m.la })
  byKey.set(`${a}:${m.gw}:${h}`, { for: m.la, against: m.lh })
}
const gwOf = new Map<string, number>()
for (const m of odds.matches) gwOf.set(`${m.h}:${m.a}`, m.gw)

/** name -> what the books priced him at, and how many of them. */
const PRICED: [string, number, number][] = [
  ['Gyökeres', 0.3706, 3], ['Šeško', 0.3238, 3], ['Havertz', 0.2950, 3],
  ['Beto', 0.2695, 5], ['G.Jesus', 0.2686, 1], ['Mateta', 0.2461, 5],
  ['Mbeumo', 0.2417, 3], ['Tzolis', 0.2357, 3], ['Barry', 0.2293, 5],
  ['Cunha', 0.2244, 3], ['Saka', 0.2172, 3], ['Zirkzee', 0.2091, 2],
]

const GW = Number(read('meta').next_gw ?? 1)
const base: MarketOdds = { byKey, strength: odds.strength ?? {} }

const props = new Map<string, { xg: number; books: number }>()
const rows: Row[] = []
for (const [web, xg, books] of PRICED) {
  const r = ratings.find((x) => String(x.web_name) === web)
  if (!r) { console.log(`  ! ${web} not in ratings.json`); continue }
  const fix = ease.find((f) => f.team === r.team && f.gw === GW)
  if (!fix) { console.log(`  ! ${web} (${r.team}) has no GW${GW} fixture`); continue }
  props.set(`${r.element}:${GW}:${fix.opponent}`, { xg, books })
  rows.push(r)
}
const blended: MarketOdds = { ...base, props }

console.log(`GW${GW}, ${rows.length} priced players, season ${SEASON}\n`)
console.log('player            pos  team  opp   shots  w      xP model  xP blend   d      goal pts')
console.log('-'.repeat(88))
let moved = 0
for (const r of rows) {
  const before = xpForGw(r as never, GW, ease, undefined, model, base, profiles)
  const after = xpForGw(r as never, GW, ease, undefined, model, blended, profiles)
  const pb = xpPartsForGw(r as never, GW, ease, undefined, model, base, profiles)
  const pa = xpPartsForGw(r as never, GW, ease, undefined, model, blended, profiles)
  if (before == null || after == null || !pb || !pa) { console.log(`  ! ${r.web_name} null xP`); continue }
  const shots = profiles.players?.[String(r.element)]?.n ?? 0
  const fix = ease.find((f) => f.team === r.team && f.gw === GW)!
  const books = props.get(`${r.element}:${GW}:${fix.opponent}`)!.books
  const mktPrec = books / (books + 2), modelPrec = shots / (shots + 30)
  const w = Math.min(mktPrec / (mktPrec + modelPrec), 0.75)
  moved += Math.abs(after - before)
  console.log(
    `${String(r.web_name).padEnd(17)} ${String(r.position).padEnd(4)} ${String(r.team).padEnd(5)} ` +
    `${String(fix.opponent).padEnd(5)} ${String(shots).padStart(5)}  ${w.toFixed(2)}   ` +
    `${before.toFixed(2).padStart(7)}  ${after.toFixed(2).padStart(8)}  ${(after - before).toFixed(2).padStart(6)}   ` +
    `${pb.goal.toFixed(2)} -> ${pa.goal.toFixed(2)}`)
}
console.log('-'.repeat(88))
console.log(`mean |change| in xP: ${(moved / Math.max(rows.length, 1)).toFixed(3)} points`)

/* An unpriced player must come out bit-identical: the blend may not touch
   anyone the market did not quote. */
const control = ratings.filter((r) => !props.has(`${r.element}:${GW}:${(ease.find((f) => f.team === r.team && f.gw === GW) ?? { opponent: '' }).opponent}`)).slice(0, 200)
let drift = 0, checked = 0
for (const r of control) {
  const a = xpForGw(r as never, GW, ease, undefined, model, base, profiles)
  const b = xpForGw(r as never, GW, ease, undefined, model, blended, profiles)
  if (a == null || b == null) continue
  checked++
  drift = Math.max(drift, Math.abs(a - b))
}
console.log(`unpriced control: ${checked} players, largest drift ${drift.toExponential(1)} ` +
  (drift === 0 ? '(untouched, correct)' : '(SHOULD BE ZERO)'))
