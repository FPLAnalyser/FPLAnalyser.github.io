/* snapshot_projections.mjs — freeze what the site projected for a gameweek,
   so the GW Review can say later how close it was.

   WHY THIS HAS TO RUN AT ALL. xP is not stored anywhere. It is computed in the
   browser at render time from xp_model, fixture_ease, odds and availability —
   so the moment any of those four refresh, the projection that was on screen
   before the deadline is gone and cannot be reconstructed. The site promises
   in two places to publish where the model missed (docs/BACKLOG.md, and the
   GW Review page's own "the ratings that got it wrong, published rather than
   quietly forgotten"), and none of that is possible without a record.

   WHEN TO RUN IT. At the deadline, on the gameweek that has just locked —
   which is exactly when advance_gameweek.py fires. At that moment the teams
   are set and the projection is final: no later team news can change it, and
   no later refresh has overwritten it yet.

   WHAT IT WRITES. site_data/<season>/projections/gw<N>.json — one row per
   player with the total and the breakdown. The breakdown is the point: it is
   the difference between "we were wrong about Haaland" and "we were wrong
   about clean sheets", and only the second of those is worth publishing.

   Run:  node snapshot_projections.mjs <gw> [--data DIR] [--out DIR]
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { minuteShares, seatFitness } from './src/lib/minutes.ts'
import { xpPartsForGw } from './src/lib/xp.ts'

const args = process.argv.slice(2)
const gw = Number(args[0])
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d }
if (!Number.isFinite(gw)) {
  console.error('usage: node snapshot_projections.mjs <gw> [--data DIR] [--out DIR]')
  process.exit(2)
}
const SEASON = JSON.parse(readFileSync('site_data/seasons.json', 'utf8')).seasons[0].id
const DATA = argOf('--data', join('site_data', SEASON))
const OUT = argOf('--out', join('site_data', SEASON, 'projections'))
const rd = (n) => JSON.parse(readFileSync(join(DATA, `${n}.json`), 'utf8'))
const rows = (x) => (Array.isArray(x) ? x : x?.rows ?? [])

const mf = rd('xp_model')
const af = rd('availability')
const ratings = rows(rd('ratings'))
const fe = rows(rd('fixture_ease'))
const tr = rows(rd('teams'))
const meta = rd('meta')
let profiles = null, charts
try { const p = rd('shot_profiles'); profiles = p?.league ? p : null } catch { /* optional */ }
try { charts = rd('depth_charts') } catch { /* optional */ }

const shortOf = (id) => tr?.[id - 1]?.short_name
const oKey = new Map()
for (const m of rd('odds').matches ?? []) {
  const h = shortOf(m.h), a = shortOf(m.a)
  if (!h || !a) continue
  oKey.set(`${h}:${m.gw}:${a}`, { for: m.lh, against: m.la })
  oKey.set(`${a}:${m.gw}:${h}`, { for: m.la, against: m.lh })
}
const market = { byKey: oKey, strength: rd('odds').strength ?? {} }

const byCode = new Map(mf.players.map((p) => [p.code, p]))
const { players: _drop, ...rest } = mf
const model = { ...rest, dcCurve: mf.dcCurve ?? {}, byCode }

// Availability exactly as lib/availability assembles it.
const seats = af.players.map((p) => ({
  code: p.code, team: p.team ?? 0, pos: p.pos ?? '', price: p.price, own: p.own,
  fitness: seatFitness(p), p60: byCode.get(p.code)?.p60, ppl: byCode.get(p.code)?.ppl,
  sameClub: (() => {
    const was = byCode.get(p.code)?.club
    if (!was || p.team == null) return true
    const now = shortOf(p.team)
    return now == null ? true : was === now
  })(),
}))
const kick = new Map()
for (const f of af.fixtures ?? []) for (const t of [f.h, f.a])
  kick.set(`${t}:${f.gw}`, [...(kick.get(`${t}:${f.gw}`) ?? []), new Date(f.k)])
const deadlines = new Map()
for (const e of af.events ?? []) deadlines.set(e.gw, new Date(e.deadline))
const avail = {
  shares: mf.shirts ? minuteShares(seats, mf.shirts, mf.conc, charts, (t) => shortOf(Number(t))) : new Map(),
  byElement: new Map(af.players.map((p) => [p.element, p])),
  byCode: new Map(af.players.map((p) => [p.code, p])),
  deadlines, kickoffs: kick, fixtures: af.fixtures ?? [], table: new Map(), generatedAt: null,
}

const r2 = (n) => Math.round(n * 100) / 100
const out = []
for (const r of ratings) {
  const parts = xpPartsForGw(r, gw, fe, avail, model, market, profiles)
  if (!parts) continue
  const total = parts.goal + parts.assist + parts.cs + parts.conceded
    + parts.saves + parts.dc + parts.bonus + parts.appearance + parts.cards
  if (!(total > 0)) continue
  out.push({
    code: r.code, element: r.element, name: r.web_name, team: r.team, pos: r.position,
    price: r.price, own: r.selected_by_percent ?? null,
    xp: r2(total),
    // The breakdown is what lets a review say WHICH part missed.
    parts: {
      goal: r2(parts.goal), assist: r2(parts.assist), cs: r2(parts.cs),
      conceded: r2(parts.conceded), saves: r2(parts.saves), dc: r2(parts.dc),
      bonus: r2(parts.bonus), appearance: r2(parts.appearance), cards: r2(parts.cards),
    },
    p60: r2(avail.shares.get(r.code)?.p60 ?? 0),
  })
}
out.sort((a, b) => b.xp - a.xp)

const dest = join(OUT, `gw${gw}.json`)
// Asked before anything else is judged: if the gameweek is already captured
// there is nothing to decide. A projection is only final once, so this file is
// written once and never rewritten — and checking it first means a re-run, or
// a recovery dispatch aimed at a gameweek already safely stored, costs nothing
// and cannot trip the guard below on data that has since moved on.
if (existsSync(dest) && !args.includes('--force')) {
  console.log(`${dest} already exists — a projection is only final once, so it is never rewritten.`)
  console.log('Pass --force if you genuinely mean to replace it.')
  process.exit(0)
}

// AN EMPTY SNAPSHOT IS WORSE THAN NO SNAPSHOT. A projection is only final
// once, so this file is never rewritten (see below) — an empty one would sit
// there permanently and there is no way to go back and recompute it. The way
// it happens is running this AFTER advance_gameweek.py, which trims the locked
// gameweek out of fixture_ease.json; xpPartsForGw then matches no fixture for
// anybody and every player returns nothing. Measured: 495 players before the
// trim, 0 after. Fail loudly instead, so the workflow stops and the gameweek
// is still there to be captured on the next run.
if (!out.length) {
  console.error(`GW${gw}: nothing projected — no player matched a fixture.`)
  console.error('  fixture_ease.json most likely no longer holds this gameweek, which')
  console.error('  means advance_gameweek.py has already run. Snapshot BEFORE advancing.')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const payload = {
  gw,
  season: SEASON,
  captured: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  data_generated: meta.generated_at ?? null,
  market_priced: [...new Set((rd('odds').matches ?? []).filter((m) => m.gw === gw).map((m) => m.gw))].length > 0,
  players: out,
}
writeFileSync(dest, JSON.stringify(payload, null, 0))
const top = out.slice(0, 5).map((p) => `${p.name} ${p.xp}`).join(', ')
console.log(`${dest} — GW${gw}, ${out.length} players projected`)
console.log(`  market priced this gameweek: ${payload.market_priced}`)
console.log(`  top: ${top}`)
