#!/usr/bin/env node
// A results card for a gameweek, from what actually happened.
//
//   node tools/social/card.mjs                      # latest gameweek, top 6
//   node tools/social/card.mjs --gw 1 --top 4
//   node tools/social/card.mjs --players Saka,White --format wide
//
// Reads `site_data/<season>/actuals/gw<N>.json` — the file pull-gw.yml writes
// every fifteen minutes while the football is on — and draws it. Nothing here
// computes a rating or a projection; it is the scoreboard, laid out.
//
// It does NOT need `npm run build`. The card is its own HTML rather than a
// screenshot of the site, because the site has no page shaped like this and
// adding one to serve a picture would be the tail wagging the dog. The colours,
// the type and the Def Con rule are all imported from the real thing, so it
// still cannot drift into inventing its own numbers.
//
// WHAT IT CANNOT SHOW: shots. The FPL API ships expected goals but not the
// shots behind them, and the Understat pull is a pre-season job — the shot maps
// in `site_data` are last season's, start to finish. A card that put a shot
// count next to a live xG would be quoting two different seasons at once. If
// in-season Understat ever lands, `SHOT_KEYS` below is where it joins.

import { chromium } from 'playwright'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }

/**
 * Actions needed for the two defensive-contribution points, by position.
 *
 * Mirrors `dc_rules.py`, which exists because this number was written down
 * twice and one edit away from a silent wrong answer. A third copy is not an
 * improvement, but this file has no Python to import and the alternative is
 * leaving the marker off — so it is duplicated here deliberately, named the
 * same, and any change to the rule has to touch both.
 */
const DC_THR = { GKP: 99, DEF: 10, MID: 12, FWD: 12 }

/** Positions a clean sheet actually pays: 4, 4 and 1 point. Not forwards. */
const CS_SCORES = new Set(['GKP', 'DEF', 'MID'])

/** Where a shot count would come from, if the data ever carried one. */
const SHOT_KEYS = ['shots', 'shots_total', 'total_shots']

// X renders a single square image at full width in the timeline and crops
// nothing; wide is for a card that has to sit beside a video; portrait takes
// the most vertical space a phone will give a single image.
const FORMATS = {
  square: { w: 1200, h: 1200, cols: 2, tiles: 6 },
  wide: { w: 1600, h: 900, cols: 3, tiles: 6 },
  portrait: { w: 1200, h: 1500, cols: 2, tiles: 8 },
}

const format = FORMATS[arg('format', 'square')]
if (!format) throw new Error(`unknown --format (want ${Object.keys(FORMATS).join(', ')})`)

/**
 * The bar's two segments.
 *
 * Gold is spoken for twice over on this card — it is the brand, and it now
 * marks whoever led the match in a column — so the bar cannot have it as well
 * without the same colour meaning two things a centimetre apart. Two golds a
 * value apart was the first attempt at that and they were too close to tell
 * apart at all; the pairs here are all cross-hue.
 *
 *   aurora  teal against violet. Cool, high contrast, and nothing else on the
 *           card is either — which is what a legend colour wants to be.
 *   neon    cyan against magenta. The loudest legible pair on black; picks a
 *           fight with the gold, which is the point of offering it.
 *   team    the club's own accent for shooting, a neutral for creating. Reads
 *           best on a full weekend where six tiles are six clubs; in a single
 *           match every Arsenal tile is the same red.
 */
const PALETTES = {
  aurora: { xg: '#2fe0c4', xa: '#b79bf0' },
  neon: { xg: '#22e0ff', xa: '#ff4d9d' },
  team: { xg: 'club', xa: 'rgba(237,239,243,.52)' },
}

const paletteName = arg('palette', 'aurora')
const palette = PALETTES[paletteName]
if (!palette) throw new Error(`unknown --palette (want ${Object.keys(PALETTES).join(', ')})`)

const one = (v) => Math.round(v * 10) / 10
const two = (v) => (Math.round(v * 100) / 100).toFixed(2)

// ---------------------------------------------------------------- data

const seasons = JSON.parse(await readFile(path.join(ROOT, 'site_data', 'seasons.json'), 'utf8'))
const season = arg('season', seasons.current)
const dir = path.join(ROOT, 'site_data', season)

const read = async (file) => JSON.parse(await readFile(path.join(dir, file), 'utf8'))
const maybe = async (file) => { try { return await read(file) } catch { return null } }

/** The most recent gameweek with a file, unless one was named. */
async function latestGw() {
  const files = await readdir(path.join(dir, 'actuals'))
  const gws = files.map((f) => Number(/^gw(\d+)\.json$/.exec(f)?.[1])).filter(Number.isFinite)
  if (!gws.length) throw new Error(`no actuals in site_data/${season}/actuals`)
  return Math.max(...gws)
}

const gw = Number(arg('gw', await latestGw()))
const actual = await read(path.join('actuals', `gw${gw}.json`))
const ratings = (await maybe('ratings.json')) || []
const teams = (await maybe('teams.json')) || []

/**
 * The club accents the site already uses, read from the site rather than
 * copied into here.
 *
 * A second copy of twenty hex values is a second copy to go stale, and the one
 * that goes stale is always the one nobody looks at. Parsing throws loudly if
 * the shape of that declaration ever changes, which is the failure mode worth
 * having — a card that stops rendering beats a card quietly drawing last
 * season's colours.
 */
async function clubColours() {
  const src = await readFile(path.join(ROOT, 'src/lib/util.ts'), 'utf8')
  const block = /export const teamColors[^{]*\{([\s\S]*?)\n\}/.exec(src)
  if (!block) throw new Error('no teamColors in src/lib/util.ts — the team palette reads its accents from there')
  const out = new Map()
  for (const m of block[1].matchAll(/\b([A-Z]{3})\s*:\s*'(#[0-9a-fA-F]{3,8})'/g)) out.set(m[1], m[2])
  if (out.size < 20) throw new Error(`teamColors parsed as ${out.size} clubs, expected the whole league`)
  return out
}

const clubs = palette.xg === 'club' ? await clubColours() : new Map()

const byCode = new Map(ratings.map((r) => [r.code, r]))
const teamCode = new Map(teams.map((t) => [t.short_name, t.code]))
const teamName = new Map(teams.map((t) => [t.short_name, t.name]))

// Only players who were on the pitch. In a midweek round with one match played
// this is thirty-one names out of six hundred, and every other row is a zero
// that would otherwise sort into the middle of the card.
const played = actual.players.filter((p) => p.minutes > 0)
if (!played.length) throw new Error(`GW${gw} has nobody with minutes yet`)

/**
 * Opponents for one appearance, parsed out of the API's own notation.
 *
 * `opp` is an ARRAY of strings like "COV(H)" — an array because a gameweek can
 * be a double, and a string because the venue is packed into it. Reading it as
 * a plain team code silently pairs nobody with anybody, which is exactly the
 * failure it produced first time: no match found, so the card fell back to
 * captioning itself with the season.
 */
function opponents(p) {
  return (Array.isArray(p.opp) ? p.opp : [p.opp]).filter(Boolean).map((s) => {
    const m = /^(.+?)\((H|A)\)$/.exec(String(s).trim())
    return m ? { code: m[1], venue: m[2] } : { code: String(s).trim(), venue: null }
  })
}

/**
 * The matches this file covers, with scores derived from the players in it.
 *
 * `goals_scored` is per player, so a team's goals are its players' goals plus
 * the opposition's own goals — which is also how the scoreline on the site is
 * built, and why a 3-0 with an own goal in it does not come out 2-0 here.
 *
 * Only single fixtures are paired. A blank-or-double round is a scoreline with
 * no single answer, and the header falls back to counting matches rather than
 * picking one of a team's two and calling it the game.
 */
function fixtures() {
  const sides = new Map()
  for (const p of played) {
    const opp = opponents(p)
    if (!sides.has(p.team)) {
      sides.set(p.team, {
        team: p.team,
        opp: opp[0]?.code ?? null,
        venue: opp[0]?.venue ?? null,
        double: opp.length > 1,
        goals: 0, og: 0, xg: 0,
      })
    }
    const s = sides.get(p.team)
    s.goals += p.goals_scored || 0
    s.og += p.own_goals || 0
    s.xg += p.expected_goals || 0
  }
  const seen = new Set()
  const out = []
  for (const s of sides.values()) {
    if (s.double || !s.opp || !sides.has(s.opp)) continue
    const key = [s.team, s.opp].sort().join('-')
    if (seen.has(key)) continue
    seen.add(key)
    const o = sides.get(s.opp)
    // Home first, the way a scoreline is written. Venue is on both sides, so
    // an unlabelled one still lands the right way round from the other.
    const [home, away] = s.venue === 'A' || o.venue === 'H' ? [o, s] : [s, o]
    out.push({
      home, away,
      hg: home.goals + away.og,
      ag: away.goals + home.og,
    })
  }
  return out
}

const games = fixtures()

/**
 * The best xG, xA and defensive contribution anybody managed, so a tile can
 * say when its man led on one.
 *
 * Over everyone in the file, which is the right scope in both directions
 * without a special case: with one fixture played the file IS that match, and
 * on a full weekend it is the gameweek. Zero never counts as a lead — in a
 * round where nobody registered an expected assist, six tiles marked joint-top
 * on 0.00 is a decoration, not a fact.
 */
const best = {
  xg: Math.max(...played.map((p) => p.expected_goals || 0)),
  xa: Math.max(...played.map((p) => p.expected_assists || 0)),
  dc: Math.max(...played.map((p) => p.defensive_contribution || 0)),
}
const leads = (key, v) => v > 0 && v >= best[key]

/**
 * A repo file as something an <img> can load, or null if it is not there.
 *
 * Absolute, because the page is written to `--out` and a relative path is then
 * relative to wherever that happens to be — which the first render proved by
 * resolving every photo, crest and the logo itself one directory short and
 * drawing six broken-image glyphs instead.
 */
const asset = (rel) =>
  existsSync(path.join(ROOT, rel)) ? `file://${path.join(ROOT, rel)}` : null

/** Everything the card shows about one player, resolved once. */
function tile(p) {
  const r = byCode.get(p.code)
  const thr = DC_THR[p.pos] ?? 99
  const shots = SHOT_KEYS.map((k) => p[k]).find((v) => typeof v === 'number')
  return {
    name: p.name,
    team: p.team,
    pos: p.pos,
    opp: opponents(p).map((o) => o.code + (o.venue ? ` (${o.venue})` : '')).join(', '),
    photo: asset(`public/img/players/${p.code}.webp`),
    badge: teamCode.has(p.team) ? asset(`public/img/badges/t${teamCode.get(p.team)}.webp`) : null,
    price: r && typeof r.price === 'number' ? one(r.price) : null,
    points: p.total_points,
    mins: p.minutes,
    goals: p.goals_scored,
    assists: p.assists,
    xg: p.expected_goals || 0,
    xa: p.expected_assists || 0,
    dc: p.defensive_contribution || 0,
    dcHit: (p.defensive_contribution || 0) >= thr,
    dcThr: thr,
    bps: p.bps,
    bonus: p.bonus || 0,
    // Whoever topped the match on a column gets it in gold. Announced in the
    // footer, because a colour nobody has been given a key to is decoration.
    topXg: leads('xg', p.expected_goals || 0),
    topXa: leads('xa', p.expected_assists || 0),
    topDc: leads('dc', p.defensive_contribution || 0),
    club: clubs.get(p.team) || 'var(--ink-2)',
    saves: p.saves,
    // A clean sheet only pays a keeper, a defender and — at a quarter of the
    // rate — a midfielder. The API sets the flag on the whole side, so a
    // forward comes back with `clean_sheets: 1` and no points from it; showing
    // him a clean-sheet badge would be crediting him with nothing.
    cs: p.clean_sheets > 0 && CS_SCORES.has(p.pos),
    shots: shots ?? null,
  }
}

const names = String(arg('players', '')).split(',').map((s) => s.trim()).filter(Boolean)
const top = Number(arg('top', format.tiles))

let picked
if (names.length) {
  picked = names.map((want) => {
    const hit = played.find((p) => p.name.toLowerCase() === want.toLowerCase())
      || played.find((p) => p.name.toLowerCase().startsWith(want.toLowerCase()))
    if (!hit) throw new Error(`no GW${gw} minutes for "${want}"`)
    return tile(hit)
  })
} else {
  // Points first, BPS as the tie-break — the same order the site's own
  // gameweek tables use, so a reader who has seen one recognises the other.
  picked = [...played]
    .sort((a, b) => b.total_points - a.total_points || b.bps - a.bps)
    .slice(0, top)
    .map(tile)
}

// ---------------------------------------------------------------- markup

const fonts = {
  m600: await readFile(path.join(ROOT, 'src/fonts/manrope-600.woff2')),
  m700: await readFile(path.join(ROOT, 'src/fonts/manrope-700.woff2')),
  m800: await readFile(path.join(ROOT, 'src/fonts/manrope-800.woff2')),
}
const face = (weight, buf) => `@font-face{font-family:Manrope;font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2')}`

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

/** The line under the gameweek: the match if there is one, the round if not. */
function subtitle() {
  if (games.length === 1) {
    const g = games[0]
    return `${esc(teamName.get(g.home.team) || g.home.team)} ${g.hg}–${g.ag} ${esc(teamName.get(g.away.team) || g.away.team)}`
  }
  if (games.length) return `${games.length} matches played`
  return season.replace('-', '/')
}

/**
 * A statistic in the strip under a player's name.
 *
 * `tone` colours the value: gold for the best in the match, green for a
 * defensive threshold cleared. Gold wins a tie between them — leading the
 * match is the rarer thing, and the DC badge on the name line has already said
 * the threshold was cleared.
 */
const stat = (label, value, tone = '') =>
  `<div class="s"><b class="${tone}">${value}</b><i>${label}</i></div>`

/**
 * Everything this appearance actually earned, as badges.
 *
 * The scoreline in the header says who won; the points number says how much;
 * these say WHY, which is the part a reader is really scanning for. A clean
 * sheet, a defensive threshold cleared and three bonus are each worth as much
 * as a goal or more, and a card that showed only goals and assists was
 * crediting a 90-minute defender with nothing at all.
 *
 * Bonus is set apart as an outline rather than a fill, because it is the one
 * badge that can still change: `pull-gw.yml` keeps writing until FPL closes
 * the gameweek, and until then the footer says so. Outline rather than a
 * different colour because gold is now spoken for — it marks the best in the
 * match, and a gold badge here would be a second meaning for it a centimetre
 * away. `+3` rather than `+3 BONUS` for width: with three badges beside it,
 * the longer label pushed "Ødegaard" into an ellipsis.
 */
function badges(t) {
  const out = []
  if (t.goals) out.push(['ret', `${t.goals}G`])
  if (t.assists) out.push(['ret', `${t.assists}A`])
  if (t.cs) out.push(['ret', 'CS'])
  if (t.dcHit) out.push(['ret', 'DC'])
  if (t.bonus) out.push(['bon', `+${t.bonus}`])
  return out.map(([k, v]) => `<em class="chip ${k}">${esc(v)}</em>`).join('')
}

/**
 * The tallest expected involvement on the card, which every bar is drawn
 * against.
 *
 * Scaled to the card rather than to a fixed ceiling, because a fixed one has
 * to be picked for the busiest match of the season and then draws every
 * ordinary one as six near-empty tracks.
 */
const peak = Math.max(...picked.map((t) => t.xg + t.xa), 0.01)

/**
 * xG and xA as one bar, so the six tiles can be compared at a glance.
 *
 * The strip underneath still prints both numbers. This is not a duplicate of
 * it: the numbers answer "how much", the bar answers "compared to whom", and
 * at 0.64 against 0.13 that is the difference between a card you read and a
 * card you scan.
 */
function bar(t) {
  const pct = (v) => `${(v / peak) * 100}%`
  // The club accent only varies per tile, so it rides on the element rather
  // than in the stylesheet; every other palette resolves once, in :root.
  const xg = palette.xg === 'club' ? t.club : 'var(--seg-xg)'
  return `
    <div class="xgi">
      <div class="track">
        <span style="width:${pct(t.xg)};background:${xg}"></span>
        <span style="width:${pct(t.xa)};background:var(--seg-xa)"></span>
      </div>
      <div class="key">
        <em style="background:${xg}"></em>xG
        <em style="background:var(--seg-xa)"></em>xA
        <b>${two(t.xg + t.xa)} xGI</b>
      </div>
    </div>`
}

function card(t) {
  return `
  <article class="p">
    <header>
      ${t.photo ? `<img class="face" src="${t.photo}" alt="">` : '<div class="face"></div>'}
      <div class="who">
        <h2><span>${esc(t.name)}</span>${badges(t)}</h2>
        <p>${t.badge ? `<img class="crest" src="${t.badge}" alt="">` : ''}${esc(t.pos)}${t.price ? ` · £${t.price}m` : ''}${games.length === 1 ? '' : ` · v ${esc(t.opp)}`}</p>
      </div>
      <div class="pts"><b>${t.points}</b><i>pts</i></div>
    </header>
    ${bar(t)}
    <div class="strip">
      ${stat('MIN', t.mins)}
      ${stat('xG', two(t.xg), t.topXg ? 'top' : '')}
      ${stat('xA', two(t.xa), t.topXa ? 'top' : '')}
      ${t.pos === 'GKP'
        ? stat('SAVES', t.saves)
        : stat(`DC/${t.dcThr}`, t.dc, t.topDc ? 'top' : t.dcHit ? 'good' : '')}
      ${stat('BPS', t.bps)}
      ${t.shots === null ? '' : stat('SHOTS', t.shots)}
    </div>
  </article>`
}

/** The team xG line, which is the one number that reframes a scoreline. */
function xgLine() {
  if (games.length !== 1) return ''
  const g = games[0]
  return `<span><em>${esc(g.home.team)}</em> ${two(g.home.xg)} xG</span>
          <span class="sep">·</span>
          <span><em>${esc(g.away.team)}</em> ${two(g.away.xg)} xG</span>`
}

const html = `<!doctype html><meta charset="utf-8">
<style>
  ${face(600, fonts.m600)}${face(700, fonts.m700)}${face(800, fonts.m800)}
  /* Straight from src/index.css, dark theme. A card that is nearly the site's
     colours reads as a fake of it; these are the values themselves. */
  :root{
    --bg-0:#000; --surface-1:#121316; --surface-2:#1b1c1f;
    --ink-1:#edeff3; --ink-2:#aaacb0; --ink-3:#828386;
    --line-subtle:rgba(255,255,255,.07); --line-mid:rgba(255,255,255,.12);
    --accent:#c9a227; --accent-2:#ead188; --accent-strong:#9a761c; --good:#3ddc7a;
    --seg-xg:${palette.xg === 'club' ? 'var(--ink-2)' : palette.xg}; --seg-xa:${palette.xa};
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    width:${format.w}px; height:${format.h}px; background:var(--bg-0);
    color:var(--ink-1); font-family:Manrope,sans-serif; font-weight:600;
    -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column; padding:56px 56px 44px;
    /* A single warm wash from the top-left, the same gradient the site puts
       behind its section banners. Flat black photographs as a screenshot of
       nothing; this reads as a designed object at thumbnail size. */
    background-image:radial-gradient(1100px 620px at 12% -10%, rgba(201,162,39,.16), transparent 62%);
  }
  .top{display:flex; align-items:flex-start; justify-content:space-between; gap:24px}
  .kicker{
    font-weight:800; font-size:22px; letter-spacing:.16em; text-transform:uppercase;
    color:var(--accent-2);
  }
  .title{font-weight:800; font-size:${games.length === 1 ? 52 : 46}px; letter-spacing:-.02em; margin-top:10px}
  .mark{width:96px; height:96px; flex:0 0 auto; opacity:.95}
  /* Content-sized rows, centred in whatever the header and footer leave.
     Letting the rows stretch instead sized every tile to a share of the card,
     which is right at the default six and absurd at three: one row of tiles
     half a metre tall, each with its bar and stat strip marooned at the
     bottom. Packing to the start was the other failure — a fifth of the square
     card as empty black under the last row. */
  .grid{
    flex:1; display:grid; gap:20px; margin:38px 0 0;
    grid-template-columns:repeat(${format.cols}, 1fr);
    grid-auto-rows:max-content; align-content:center;
  }
  .p{
    background:var(--surface-1); border:1px solid var(--line-subtle);
    border-radius:20px; padding:22px 24px 20px; display:flex; flex-direction:column; gap:16px;
  }
  .p header{display:flex; align-items:center; gap:16px}
  .face{
    width:72px; height:72px; flex:0 0 auto; border-radius:16px; object-fit:cover;
    object-position:top center; background:var(--surface-2);
  }
  .who{flex:1; min-width:0}
  .who h2{display:flex; align-items:center; gap:7px; font-weight:800; font-size:30px; letter-spacing:-.02em}
  /* The name yields, the badges do not. A tile that elides "1G" to fit
     "Lewis-Skelly" has dropped the thing the reader was looking for; one that
     shows "Lewis-Skell… 1G CS" has not. */
  .who h2 span{min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
  .who p{
    display:flex; align-items:center; gap:8px; margin-top:4px;
    font-size:19px; color:var(--ink-2); white-space:nowrap;
  }
  .crest{width:22px; height:22px; object-fit:contain}
  .pts{text-align:right; flex:0 0 auto}
  .pts b{display:block; font-weight:800; font-size:46px; line-height:1; color:var(--accent-2)}
  .pts i{font-style:normal; font-size:15px; letter-spacing:.1em; color:var(--ink-3); text-transform:uppercase}
  .xgi{margin-top:auto}
  .track{
    display:flex; height:12px; border-radius:999px; overflow:hidden;
    background:var(--surface-2);
  }
  .key{
    display:flex; align-items:center; gap:7px; margin-top:11px;
    font-size:16px; color:var(--ink-3); letter-spacing:.02em;
  }
  .key em{width:11px; height:11px; border-radius:3px; margin-left:6px}
  .key em:first-child{margin-left:0}
  .key b{margin-left:auto; font-weight:800; color:var(--ink-2); font-variant-numeric:tabular-nums}
  .chip{
    flex:0 0 auto; font-style:normal; padding:3px 9px; border-radius:999px;
    border:1.5px solid transparent; line-height:1.35;
    font-weight:800; font-size:15px; letter-spacing:.04em;
  }
  /* Earned outright: filled green, the site's own colour for a good number.
     Bonus: the same green, outlined — one family, because both are points on
     the board, and a different treatment because only one of them can still
     change. */
  .chip.ret{background:rgba(61,220,122,.14); color:var(--good)}
  .chip.bon{border-color:rgba(61,220,122,.45); color:var(--good)}
  .strip{
    display:flex; gap:8px; border-top:1px solid var(--line-subtle); padding-top:16px;
  }
  .s{flex:1; text-align:center}
  .s b{display:block; font-weight:800; font-size:27px; line-height:1.1; font-variant-numeric:tabular-nums}
  .s b.good{color:var(--good)}
  .s b.top{color:var(--accent-2)}
  .s i{font-style:normal; display:block; margin-top:5px; font-size:13px; letter-spacing:.09em; color:var(--ink-3)}
  .foot{
    display:flex; align-items:center; justify-content:space-between; gap:24px;
    margin-top:32px; padding-top:22px; border-top:1px solid var(--line-mid);
    font-size:21px; color:var(--ink-2);
  }
  .foot em{font-style:normal; font-weight:800; color:var(--ink-1)}
  .foot .sep{color:var(--ink-3); margin:0 12px}
  .site{font-weight:800; color:var(--accent-2); letter-spacing:-.01em}
  .note{font-size:16px; color:var(--ink-3); margin-top:10px; text-align:right}
  /* Gold in the stat strip means nothing until this says what. */
  .legend{font-size:16px; color:var(--ink-3); margin-top:10px}
  .legend b{color:var(--accent-2); font-weight:800}
</style>
<div class="top">
  <div>
    <div class="kicker">Gameweek ${gw}</div>
    <div class="title">${subtitle()}</div>
  </div>
  <img class="mark" src="${asset('public/logo.png')}" alt="">
</div>
<div class="grid">${picked.map(card).join('')}</div>
<div class="foot">
  <div>
    ${xgLine()}
    <div class="legend"><b>Gold</b> marks the best in the ${games.length === 1 ? 'match' : 'gameweek'}</div>
  </div>
  <div>
    <div class="site">fplanalyser.co.uk</div>
    ${actual.provisional ? '<div class="note">Provisional — bonus not final</div>' : ''}
  </div>
</div>`

// ---------------------------------------------------------------- render

// Resolved, because the page is loaded over file:// and a relative --out
// produces a URL with no host and no root that Chromium will not open.
const outDir = path.resolve(arg('out', path.join(ROOT, 'build', 'social', 'cards')))
await mkdir(outDir, { recursive: true })
const htmlFile = path.join(outDir, `gw${gw}-card.html`)
await writeFile(htmlFile, html)

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'],
})
const page = await browser.newPage({
  viewport: { width: format.w, height: format.h },
  // 2x so the card survives being opened full-screen on a phone. X re-encodes
  // anything larger without adding detail.
  deviceScaleFactor: 2,
})
await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)

const png = path.join(outDir, `gw${gw}-${arg('format', 'square')}.png`)
await page.screenshot({ path: png })
await browser.close()

console.log(`GW${gw} · ${subtitle().replace(/<[^>]+>/g, '')} · ${picked.length} players`)
for (const t of picked) {
  console.log(`  ${t.name.padEnd(14)} ${t.points} pts  xG ${two(t.xg)}  xA ${two(t.xa)}  DC ${t.dc}/${t.dcThr}  BPS ${t.bps}`)
}
console.log(`\n  ${png}`)
