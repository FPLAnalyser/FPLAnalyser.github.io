import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { TeamBadge } from '../components/badges'
import { PlayerPhoto } from '../components/PlayerPhoto'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { Exportable } from '../components/ExportPanel'
import { useCore, useLazyTable } from '../lib/useData'
import { useAvailability, availFor, notPlaying, penaltyDuty, type TeamRecord } from '../lib/availability'
import { useMarketOdds, useXpModel, useShotProfiles, xpForGw } from '../lib/xp'
import { num } from '../lib/rows'
import { teamLabel, playerHref, derbyName, teamColors } from '../lib/util'
import { resolveFixture, kitBackground, kitOutline } from '../lib/kits'
import { useTheme } from '../lib/theme'
import { CARD_UPLIFT, edgeFor, edgeSentence, profileOf, type Edge, type Profile } from '../lib/matchup'
import { str } from '../lib/rows'
import type { RatingRow, Row } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   PREVIEW — the whole gameweek on one screen, before the deadline.

   Everything a manager does in the hours before a deadline, in the order
   they do it: who to captain, whether a chip is worth spending, which games
   produce the points, who is missing and who starts because of it.

   The numbers here are bookmaker-implied goal expectancies for these exact
   fixtures, not projections carried from last season, which is why the page
   can say things no other screen on the site can — that Arsenal are a 56%
   shutout at home to Coventry, or that City v Bournemouth is the shootout of
   the round.
   ════════════════════════════════════════════════════════════════════════ */


/** How many of each position a club typically starts, in FPL's classification
 *  rather than football's: wingers are midfielders here, so the common
 *  4-2-3-1 and 4-3-3 both come out as one keeper, four defenders, five
 *  midfielders and a lone striker. Last season's starts back that up — across
 *  the twenty clubs the average forward count is 0.85, not 2.
 *
 *  Used to work out who is in the first-choice line and therefore who gets
 *  promoted when one of them is out. Typical rather than tactical, which is
 *  why the page projects a replacement rather than claiming a team sheet. */
const STARTERS: Record<string, number> = { GKP: 1, DEF: 4, MID: 5, FWD: 1 }
const pc = (x: number) => `${Math.round(x * 100)}%`

/** Clean-sheet odds on the site's five-band language, so a green percentage
 *  here means what a green cell means on the fixture grid. */
const csTone = (cs: number) => (cs >= 0.38 ? 'text-good' : cs >= 0.28 ? 'text-good/80' : cs >= 0.20 ? 'text-warn' : 'text-bad')
/** Within a fixture the favoured attack is gold and the other side cool, so
 *  which way a game is expected to go is readable without comparing digits. */
/* Gold for the side expected to score more, neutral for the other.
 *
 * This used to be gold against blue, which paired with a gold-and-blue bar
 * underneath. The bar now wears the clubs' own colours, so a blue number is a
 * third colour competing with two shirts for no reason — and worse, it reads as
 * a category rather than a ranking. Gold against ink says the same thing and
 * leaves the bar to do the identifying. */
const xgTone = (mine: number, theirs: number) => (mine > theirs ? 'text-accent-2' : 'text-ink-2')
const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

const DEADLINE_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
})

/** The gameweek deadline, with a live countdown — the one fact that decides
 *  whether anything else on this page is still actionable. Renders nothing
 *  until the availability feed has the gameweek, rather than guessing a date. */
function DeadlineStrip({ gw, at }: { gw: number; at?: Date }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!at) return null
  const left = at.getTime() - now
  const d = Math.floor(left / 86400000)
  const h = Math.floor((left % 86400000) / 3600000)
  const mi = Math.floor((left % 3600000) / 60000)
  const s = Math.floor((left % 60000) / 1000)
  // Inside the last hour every minute matters, so the seconds appear; before
  // that they are noise on a page you sit and read.
  const cd = d > 0 ? `${d}d ${h}h ${mi}m` : h > 0 ? `${h}h ${mi}m` : `${mi}m ${s}s`
  const urgent = left > 0 && left < 6 * 3600000
  return (
    <div className={`mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border px-4 py-3 ${urgent ? 'border-warn/50 bg-warn/10' : 'border-accent/35 bg-accent-soft/30'}`}>
      <span className="flex items-center gap-2 text-[11px] font-extrabold tracking-[0.14em] text-ink-3 uppercase">
        <Icon name="clock" size={15} className="text-accent" />
        GW{gw} deadline
      </span>
      <span className="text-[16px] font-extrabold text-ink">{DEADLINE_FMT.format(at)}</span>
      <span className={`font-num ml-auto text-[17px] font-extrabold tabular-nums ${urgent ? 'text-warn' : 'text-accent-2'}`}>
        {left > 0 ? cd : 'Deadline passed'}
      </span>
    </div>
  )
}

/** When the team news on this page was last pulled from FPL.
 *
 *  Quiet, until it isn't. The refresh runs at 06:00 and the page has no way of
 *  knowing it failed — a stale feed and a fresh one look identical, which is
 *  exactly how this page went on calling an injured man Bournemouth's penalty
 *  taker for two days after the job started crashing. Past a day and a half
 *  the line turns amber and says so, so the next silent failure announces
 *  itself to whoever is reading rather than waiting to be noticed. */
function DataAge({ at }: { at: string | null }) {
  if (!at) return null
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) return null
  const hours = (Date.now() - when.getTime()) / 3600000
  // 30 hours: a refresh at 06:00 is a day old by the following mid-morning and
  // that is fine. Past 30 it has missed a run.
  const stale = hours > 30
  const day = hours < 20 ? 'today' : hours < 44 ? 'yesterday' : `${Math.floor(hours / 24)} days ago`
  return (
    <div className={`mb-5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] ${stale ? 'text-warn' : 'text-ink-3'}`}>
      <Icon name={stale ? 'alert' : 'clock'} size={12} className="shrink-0" />
      <span>
        Team news, prices and ownership from FPL, {day} at {TIME.format(when)}
      </span>
      {stale && <b className="font-semibold">— the daily refresh hasn’t run since, so treat the flags as out of date.</b>}
    </div>
  )
}

/** Last five results, most recent last. Renders nothing before a ball is
 *  kicked, which is the honest answer in August. */
function FormDots({ form }: { form?: ('W' | 'D' | 'L')[] }) {
  if (!form?.length) return null
  const tint = { W: 'bg-good', D: 'bg-ink-3', L: 'bg-bad/70' }
  return (
    <span className="flex gap-[2px]" title={`Last ${form.length}: ${form.join('')}`}>
      {form.slice(-5).map((r, i) => <i key={i} className={`h-2 w-2 rounded-[2px] ${tint[r]}`} />)}
    </span>
  )
}

interface Side { team: string; lam: number; against: number; cs: number; opp: string; venue: 'H' | 'A' }
interface Match { h: string; a: string; lh: number; la: number; csh: number; csa: number; total: number; k: string; hid: number; aid: number }

export default function Preview() {
  const { data, error } = useCore()
  const market = useMarketOdds()
  const avail = useAvailability()
  const model = useXpModel()
  const profiles = useShotProfiles()
  // The kit bars are painted differently per mode — a black shirt on the dark
  // card and a white one on the light card both need help to have a shape.
  const { mode } = useTheme()
  const navigate = useNavigate()
  const [open, setOpen] = useState<string | null>(null)
  // The featured match opens by default but is a toggle like any other card.
  const [featOpen, setFeatOpen] = useState(true)

  const gw = data?.meta?.next_gw != null ? Number(data.meta.next_gw) : 1
  // FPL team ids are assigned alphabetically — the order of teams.json.
  const teamShorts = useMemo(() => (data?.teams ?? []).map((t) => String(t.short_name)), [data?.teams])
  const ratings = (data?.ratings ?? []) as RatingRow[]

  /* Both sides of every fixture in the round, from the market's goal
     expectancies. A clean sheet is Poisson with no goals: e^-λ. */
  const { matches, sides } = useMemo(() => {
    const sides = new Map<string, Side>()
    const seen = new Set<string>()
    const matches: Match[] = []
    for (const [key, v] of market?.byKey ?? []) {
      const [team, g, opp] = key.split(':')
      if (Number(g) !== gw) continue
      sides.set(team, { team, lam: v.for, against: v.against, cs: Math.exp(-v.against), opp, venue: 'H', })
      const pair = [team, opp].sort().join('|')
      if (!seen.has(pair)) { seen.add(pair); matches.push({ h: team, a: opp, lh: v.for, la: v.against, csh: Math.exp(-v.against), csa: Math.exp(-v.for), total: v.for + v.against, k: '', hid: 0, aid: 0 }) }
    }
    // byKey holds both directions, so venue has to come from the fixture list.
    for (const f of data?.fixtureEase ?? []) {
      if (f.gw !== gw) continue
      const s = sides.get(String(f.team))
      if (s) { s.venue = String(f.venue) === 'H' ? 'H' : 'A'; s.opp = String(f.opponent) }
    }
    // Keep only the home side's view of each pairing so h/a are the right way round.
    const fixed = matches.map((m) => (sides.get(m.h)?.venue === 'A' ? { ...m, h: m.a, a: m.h, lh: m.la, la: m.lh, csh: m.csa, csa: m.csh } : m))
    // Kickoff time and team ids, for the day grouping and the league table.
    const short = (id: number) => teamShorts[id - 1]
    for (const f of avail.fixtures) {
      if (f.gw !== gw) continue
      const h = short(f.h), a = short(f.a)
      const hit = fixed.find((m) => (m.h === h && m.a === a) || (m.h === a && m.a === h))
      if (hit) { hit.k = f.k; hit.hid = hit.h === h ? f.h : f.a; hit.aid = hit.a === a ? f.a : f.h }
    }
    // Kickoff order: the round is lived in time, not in a table.
    fixed.sort((x, y) => (x.k ?? '').localeCompare(y.k ?? '') || y.total - x.total)
    return { matches: fixed, sides }
  }, [market, data?.fixtureEase, gw, avail.fixtures, teamShorts])

  /* ── Matchups: whose shot profile the opposing defence is least built for.
     ────────────────────────────────────────────────────────────────────────
     Same computation as the Fixtures page's explorer, over the whole round
     instead of one opponent — `lib/matchup` so there is one of it. Three
     lazy tables, none of them small, so they load after the page rather than
     with it: the round reads perfectly well without this and it arrives when
     it arrives. */
  const concededQ = useLazyTable<Record<string, Row[]>>('shots_conceded')
  const playerShotsQ = useLazyTable<Record<string, Row[]>>('player_shots')
  const scoutQ = useLazyTable<Row[]>('scouting')

  const leagueProfile = useMemo(
    () => profileOf(Object.values(concededQ.data ?? {}).flat(), true),
    [concededQ.data],
  )
  const teamProfiles = useMemo(() => {
    const m = new Map<string, Profile>()
    for (const [t, list] of Object.entries(concededQ.data ?? {})) m.set(t, profileOf(list, true))
    return m
  }, [concededQ.data])
  /* Headed share comes from the scouting table, not the shot events: shot
     events carry no body-part field, so reading headers off them returns zero
     for everybody and the whole header route vanishes without saying so. */
  const headShareByEl = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of scoutQ.data ?? []) {
      if ((str(r, 'window') || 'season') !== 'season') continue
      const el = num(r, 'element')
      const shots = num(r, 'shots_per90')
      const headed = num(r, 'headed_shots_per90')
      if (el != null && shots && headed != null && shots > 0) m.set(el, headed / shots)
    }
    return m
  }, [scoutQ.data])

  const edges = useMemo(() => {
    if (!playerShotsQ.data || leagueProfile.totalXg <= 0) return []
    const oppOf = new Map<string, string>()
    for (const m of matches) { oppOf.set(m.h, m.a); oppOf.set(m.a, m.h) }
    const out: Edge[] = []
    for (const r of ratings) {
      if (r.position !== 'MID' && r.position !== 'FWD') continue
      const opp = oppOf.get(String(r.team))
      if (!opp) continue
      const p = availFor(avail, num(r, 'element'), num(r, 'code'))
      if (p && notPlaying(p.status)) continue
      const e = edgeFor(r, playerShotsQ.data[String(r.element)], teamProfiles.get(opp), leagueProfile, opp, headShareByEl.get(Number(r.element)))
      if (e) out.push(e)
    }
    out.sort((a, b) => b.score - a.score)
    return out
  }, [playerShotsQ.data, teamProfiles, leagueProfile, headShareByEl, ratings, matches, avail])

  /** The one line a fixture card earns — the best edge in that game, either
   *  side of it, and only when it clears the bar. Most fixtures get nothing,
   *  which is the point. */
  const edgeByFixture = useMemo(() => {
    const m = new Map<string, { e: Edge; why: string }>()
    for (const e of edges) {
      if (e.uplift < CARD_UPLIFT) continue
      const why = edgeSentence(e, teamLabel(e.opp), false)
      if (!why) continue
      const key = [String(e.player.team), e.opp].sort().join('|')
      const cur = m.get(key)
      if (!cur || e.score > cur.e.score) m.set(key, { e, why })
    }
    return m
  }, [edges])

  /* Four each way. Six was tested and the lane ran past the 427px the left
     column has spare, which is the whole reason this section fits where it
     does. */
  const gainers = useMemo(
    () => edges.filter((e) => e.uplift > 0 && edgeSentence(e, teamLabel(e.opp))).slice(0, 4),
    [edges],
  )
  const losers = useMemo(
    () => [...edges].reverse().filter((e) => e.uplift < 0).slice(0, 4),
    [edges],
  )

  /* Expected points for THIS gameweek, from the site's own per-gameweek model:
     goal, assist, clean sheet, saves, defensive contribution, bonus and
     appearance, each priced off this fixture's goal expectancies and the
     player's own rates. An earlier draft scaled a season average by a fixture
     multiplier and produced numbers around 10 for a single week — roughly
     double what a gameweek can pay a premium, because a season average is
     already a per-game figure and multiplying it again double-counts the
     fixture. */
  const board = useMemo(() => {
    const fe = data?.fixtureEase ?? []
    const rows: { r: RatingRow; xp: number; side: Side; own: number }[] = []
    for (const r of ratings) {
      const p = availFor(avail, num(r, 'element'), num(r, 'code'))
      if (p && notPlaying(p.status)) continue
      const side = sides.get(String(r.team))
      if (!side) continue
      const xp = xpForGw(r, gw, fe, avail, model, market, profiles)
      if (xp == null) continue
      // Live ownership when the daily feed has it; the ratings build's own
      // figure is a season snapshot and drifts between refreshes.
      rows.push({ r, xp, side, own: p?.own ?? num(r, 'selected_by_percent') ?? 0 })
    }
    return rows.sort((a, b) => b.xp - a.xp)
  }, [ratings, avail, sides, data?.fixtureEase, gw, model, market, profiles])

  /* Flagged players, and who actually steps up.

     This is a promotion model, not a "next best player" one. The first
     version named the highest-rated fit team-mate and only printed him if he
     was rated BELOW the absentee — which silently dropped the biggest news of
     the week. Saliba out at Arsenal returned Gabriel, rated above him, so the
     rule threw the pair away; but Gabriel was always starting. He is not the
     replacement.

     Instead: rank the club's players at that position, take the first-choice
     line (four defenders, one keeper, and so on), and see who enters it once
     the absentees are removed. The men who are newly in ARE the replacements,
     paired to the absentees in rating order. Two Arsenal centre-halves out
     promotes two players, not one.

     Rating stands in for the pecking order and the line sizes are typical
     rather than tactical, so this is a projection of who comes in — the
     honest limit of what anyone can know before a team sheet lands. */
  const flagged = useMemo(() => {
    const score = (r: RatingRow) => num(r, 'season_overall_score') ?? 0
    const statusOf = (r: RatingRow) => String(availFor(avail, num(r, 'element'), num(r, 'code'))?.status ?? 'a')

    const groups = new Map<string, RatingRow[]>()
    for (const r of ratings) {
      const k = `${r.team}|${r.position}`
      const g = groups.get(k)
      if (g) g.push(r); else groups.set(k, [r])
    }

    const stepFor = new Map<number, RatingRow>()
    for (const [k, pool] of groups) {
      const n = STARTERS[k.split('|')[1]] ?? 4
      pool.sort((a, b) => score(b) - score(a))
      const firstChoice = pool.slice(0, n)
      const fc = new Set(firstChoice.map((r) => r.element))
      // A doubt has not vacated anything, so he still counts as holding a
      // shirt — but he can never BE the answer. Naming a doubtful player as
      // the man who steps up produced rows like "Kudus (doubt) steps up" on a
      // page that flagged Kudus two lines below.
      const fit = pool.filter((r) => !notPlaying(statusOf(r)))
      const line = fit.slice(0, n)
      const promoted = line.filter((r) => !fc.has(r.element) && statusOf(r) === 'a')
      const absent = firstChoice.filter((r) => notPlaying(statusOf(r)))
      absent.forEach((r, i) => { if (promoted[i]) stepFor.set(r.element, promoted[i]) })
      // For a doubtful starter, the first fit man outside the line comes in.
      const next = fit.slice(n).find((r) => statusOf(r) === 'a')
      if (next) for (const r of line) if (statusOf(r) === 'd') stepFor.set(r.element, next)
    }

    const out: { r: RatingRow; status: string; news: string; own: number | null; step: RatingRow | null }[] = []
    for (const r of ratings) {
      const p = availFor(avail, num(r, 'element'), num(r, 'code'))
      if (!p || String(p.status ?? 'a') === 'a') continue
      out.push({
        r, status: String(p.status), news: String(p.news ?? '').split(' - ')[0],
        own: p.own ?? null,
        step: stepFor.get(r.element) ?? null,
      })
    }
    return out.sort((a, b) => (b.own ?? 0) - (a.own ?? 0))
  }, [ratings, avail])

  /* The round's biggest game by total goals, lifted out of the list, and
     everything else grouped by matchday. This has to sit ABOVE the loading
     return: a hook after an early return runs on the loaded pass and not the
     loading one, and React counts hooks — that mismatch is what crashed this
     page with error #310 on the first paint after the data landed. */
  const { feature, byDay } = useMemo(() => {
    const feature = matches.length ? matches.reduce((best, m) => (m.total > best.total ? m : best)) : null
    const out = new Map<string, Match[]>()
    for (const m of matches) {
      if (m === feature) continue
      const key = m.k ? DAY.format(new Date(m.k)) : 'Kickoff to be confirmed'
      out.set(key, [...(out.get(key) ?? []), m])
    }
    return { feature, byDay: [...out.entries()] }
  }, [matches])

  if (!data) {
    return (
      <PageShell>
        <SectionBanner imgKey="preview" title="Preview" subtitle="Everything you need to get ready for the next gameweek" />
        <PageSkeleton error={error} />
      </PageShell>
    )
  }

  const ready = matches.length > 0
  /** The best projection nobody owns — the one thing the captain podium can
   *  never be, since it ranks the players everybody already has. */
  const differential = board.filter((b) => b.own <= 5 && b.xp >= 3)[0] ?? null
  const attacks = [...sides.values()].sort((a, b) => b.lam - a.lam)
  const shutouts = [...sides.values()].sort((a, b) => b.cs - a.cs)
  /** Who is on penalties for this club on Saturday — not who is first choice.
   *
   *  Those came apart the moment Bournemouth's first choice picked up a
   *  three-month injury: FPL keeps listing him at order 1, so the card went on
   *  naming a man who will not be on the pitch. When the ball falls to a
   *  deputy the card says whose absence put it there, because that is the bit
   *  that decides whether you trust it to last. */
  const penTaker = (team: string): string | null => {
    const id = ratings.find((r) => r.team === team)
    const p0 = id ? availFor(avail, num(id, 'element'), num(id, 'code')) : null
    if (p0?.team == null) return null
    const duty = penaltyDuty(avail, p0.team)
    if (!duty) return null
    const nameOf = (el: number) => {
      const hit = ratings.find((r) => Number(r.element) === el)
      return hit ? String(hit.web_name) : null
    }
    const who = nameOf(duty.taker.element)
    if (!who) return null
    const first = duty.deputisingFor ? nameOf(duty.deputisingFor.element) : null
    // The whole phrase, not just the name: the reason has to sit inside the
    // brackets with "pens" or it reads as two separate parentheticals.
    return first ? `${who} (pens — ${first} out)` : `${who} (pens)`
  }

  /** One fixture card. `feat` is the round's headline game: bigger, opened,
   *  and carrying the full read rather than waiting for a tap. */
  const card = (m: Match, feat: boolean) => {
              const id = `${m.h}-${m.a}`
              const isOpen = feat ? featOpen : open === id
              const derby = derbyName(m.h, m.a)
              const inGame = board.filter((b) => b.side.team === m.h || b.side.team === m.a).slice(0, 5)
              const kits = resolveFixture(m.h, m.a, teamLabel)
              return (
                // The column span lives on the wrapper, not the card: an
                // opening card widens by becoming a two-column grid item, and
                // the grid item is now the Exportable around it.
                //
                // min-w-0 for the same reason. A grid item's automatic minimum
                // is its content, unless it clips — the card does clip, so it
                // used to shrink to the column and cut the overhang. The
                // wrapper doesn't clip (the format menu hangs out of it), so
                // without this the phone got a card wider than the screen.
                <Exportable
                  key={id}
                  variant="corner"
                  title={`GW${gw} — ${teamLabel(m.h)} v ${teamLabel(m.a)}`}
                  filename={`gw${gw}-${m.h.toLowerCase()}-${m.a.toLowerCase()}`}
                  className={`min-w-0 ${feat ? 'mb-4' : isOpen ? 'lg:col-span-2' : ''}`}
                  // A collapsed card is a scoreline and two crests; the reason
                  // to send someone a fixture is the expected points and the
                  // team news behind the tap. So the card opens itself for the
                  // picture and goes back to however the reader had it.
                  beforeCapture={() => { if (feat) setFeatOpen(true); else setOpen(id) }}
                  afterCapture={() => { if (feat) setFeatOpen(featOpen); else setOpen(open) }}
                >
                <div
                  className={`relative overflow-hidden rounded-xl border bg-surface-1 transition-colors ${feat ? 'border-accent/45 p-4 pt-[1.15rem]' : 'p-3 pt-[0.95rem]'} ${isOpen && !feat ? 'border-accent/45' : feat ? '' : 'border-line'}`}
                >
                  {/* A stub of club colour over each club, and nothing across
                      the middle. Corner-to-corner radial washes carried no
                      information and put two saturated hues in collision; a
                      full-width band fixed the fairness but still painted the
                      whole top edge. Each side now gets the same short run,
                      sitting directly above its own crest, and it fades out
                      before it reaches the numbers. */}
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 flex h-1 justify-between">
                    <span
                      className="block w-[78px] sm:w-[150px]"
                      style={{ background: `linear-gradient(90deg, ${teamColors[m.h] ?? 'var(--accent)'}, transparent)` }}
                    />
                    <span
                      className="block w-[78px] sm:w-[150px]"
                      style={{ background: `linear-gradient(270deg, ${teamColors[m.a] ?? 'var(--info)'}, transparent)` }}
                    />
                  </div>
                  <button
                    onClick={(e) => {
                      // An opening card spans both columns, which pushes it to
                      // a row of its own — so it is scrolled back under the
                      // cursor, or the next click lands on whatever moved up
                      // into its place.
                      const el = e.currentTarget
                      if (feat) setFeatOpen(!featOpen)
                      else setOpen(isOpen ? null : id)
                      requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }))
                    }}
                    aria-expanded={isOpen}
                    aria-label={`${m.h} v ${m.a} — ${isOpen ? 'hide' : 'show'} detail`}
                    className="w-full cursor-pointer text-left"
                  >
                    {/* Both tags ride in the flow above the teams, INSIDE the
                        toggle. Pinned to the top-right corner the derby ribbon
                        sat on the away club's crest; left outside the button
                        they were a dead strip across the top of the card that
                        swallowed clicks. The right padding is the share button,
                        which floats over this corner from outside the toggle —
                        nested buttons aren't legal, and the alternative was a
                        whole row of chrome above every card in the round. */}
                    <div className="mb-2.5 flex flex-wrap items-center gap-1.5 pr-11">
                      {feat && <span className="rounded bg-accent px-2 py-1 text-[9px] font-extrabold tracking-[0.12em] text-accent-contrast uppercase">Match of the round</span>}
                      {derby && <span className="rounded bg-gradient-to-r from-accent to-accent-2 px-2 py-1 text-[9px] font-extrabold tracking-[0.1em] text-accent-contrast uppercase">{derby}</span>}
                      {/* The featured match is lifted out of its day group, so
                          it has to carry its own date — the rest sit under one. */}
                      {feat && m.k && (
                        <span className="rounded border border-line-strong bg-surface-2 px-2 py-1 text-[11px] font-extrabold tracking-[0.08em] text-ink uppercase">{DAY.format(new Date(m.k))}</span>
                      )}
                      {/* An instruction to the reader of the page, not part of
                          the fixture — a picture of the card shouldn't tell
                          whoever it reaches to tap something. */}
                      <span data-no-capture className="ml-auto flex items-center gap-1 text-[10px] font-bold tracking-wide text-ink-3 uppercase">
                        {isOpen ? 'Hide' : 'Detail'}
                        <Icon name="chevron-right" size={13} className={`transition-transform ${isOpen ? '-rotate-90' : 'rotate-90'}`} />
                      </span>
                    </div>
                    {/* Tighter gaps on a phone. The row's fixed parts — two
                        club boxes and the kickoff pill — plus 10px gaps come to
                        more than a 390px screen leaves, so the away club was
                        pushed 18px past the card and its crest cut in half by
                        the card's own clipping. Nothing was visibly broken,
                        which is why it survived: the card just quietly ate the
                        right-hand badge. */}
                    <div className="flex items-center gap-1.5 sm:gap-2.5">
                      <Club team={m.h} rec={avail.table.get(m.hid)} big={feat} />
                      {/* The unit sits on the baseline beside the number, as
                          it does on the captain podium — a whole line of card
                          height for two characters is a poor trade, and it
                          buys back the vertical room the card needs on a
                          phone. */}
                      <span className="flex flex-1 items-baseline justify-center gap-1">
                        <span className={`font-num leading-none font-extrabold ${feat ? 'text-[22px] sm:text-[34px]' : 'text-[20px] sm:text-[26px]'} ${xgTone(m.lh, m.la)}`}>{m.lh.toFixed(2)}</span>
                        <span className="text-[9.5px] font-extrabold tracking-[0.14em] text-ink-3">xG</span>
                      </span>
                      <span className="rounded bg-black/35 px-2 py-1 text-[12px] font-extrabold whitespace-nowrap text-ink-2">
                        {m.k ? TIME.format(new Date(m.k)) : 'v'}
                      </span>
                      <span className="flex flex-1 items-baseline justify-center gap-1">
                        <span className={`font-num leading-none font-extrabold ${feat ? 'text-[22px] sm:text-[34px]' : 'text-[20px] sm:text-[26px]'} ${xgTone(m.la, m.lh)}`}>{m.la.toFixed(2)}</span>
                        <span className="text-[9.5px] font-extrabold tracking-[0.14em] text-ink-3">xG</span>
                      </span>
                      <Club team={m.a} rec={avail.table.get(m.aid)} big={feat} right />
                    </div>
                    {/* One bar, split by which side the goals belong to, each
                        half in that club's shirt for this fixture: home in home
                        colours, away in its away kit, and the away side changed
                        where the two would read as the same colour.

                        This gives up something and it is worth being clear about
                        it. The bar used to be gold for the favoured attack and
                        blue for the other, so the bar itself said who was
                        expected to score more. In kit colours it says who is who
                        — the favoured side's xG number carries the judgement
                        instead, at full strength against the other dimmed. What
                        you get back is that you recognise the game without
                        reading it, which a two-colour bar can never do.

                        12px rather than 8: a striped shirt needs the height, and
                        a shirt with contrast trim needs it twice over. */}
                    <div
                      className="mt-2.5 flex h-[12px] overflow-hidden rounded-full"
                      title={kits.clash ?? undefined}
                    >
                      <span
                        className="block"
                        style={{
                          width: `${(m.lh / m.total) * 100}%`,
                          background: kitBackground(kits.home, mode),
                          outline: kitOutline(kits.home, mode),
                          outlineOffset: '-1px',
                        }}
                      />
                      <span
                        className="block flex-1"
                        style={{
                          background: kitBackground(kits.away, mode),
                          outline: kitOutline(kits.away, mode),
                          outlineOffset: '-1px',
                        }}
                      />
                    </div>
                    <div className="mt-2.5 flex items-baseline justify-between text-[12.5px] text-ink-3">
                      <span>Clean Sheet <b className={`text-[17px] font-extrabold ${csTone(m.csh)}`}>{pc(m.csh)}</b></span>
                      <span className="text-[12px]">{m.total.toFixed(2)} goals expected</span>
                      <span>Clean Sheet <b className={`text-[17px] font-extrabold ${csTone(m.csa)}`}>{pc(m.csa)}</b></span>
                    </div>
                    {/* One line about the matchup, and only where the shot
                        profiles actually say something — most fixtures get
                        nothing and take no extra height for it. Inside the
                        button rather than under it so the whole card stays one
                        tap target. */}
                    {(() => {
                      const hit = edgeByFixture.get([m.h, m.a].sort().join('|'))
                      if (!hit) return null
                      return (
                        <div className="mt-2.5 flex gap-2 border-t border-dashed border-line-mid pt-2.5 text-left text-[12px] leading-snug text-ink-2">
                          <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-good" />
                          <span>
                            <b className="font-bold text-ink">{String(hit.e.player.web_name)}.</b> {hit.why}
                          </span>
                        </div>
                      )
                    })()}
                  </button>
                  {isOpen && (
                    <div className="mt-3 grid grid-cols-1 gap-4 border-t border-line-mid pt-3 lg:grid-cols-[1.4fr_1fr]">
                      <div>
                        <div className="mb-2 text-[11px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Expected points</div>
                        {/* One gold bar each, on the same scale, so the gap
                            between the game's best pick and the rest is the
                            thing you read. An earlier version split every bar
                            into seven sources; it was more information than a
                            fixture card can carry. */}
                        {inGame.map((b) => (
                          <button key={String(b.r.element)} onClick={() => navigate(playerHref(b.r.web_name, num(b.r, 'code')))} className="mb-2.5 block w-full text-left last:mb-0">
                            <div className="flex items-center gap-2 text-[13px]">
                              <span className="w-7 shrink-0 text-[10px] font-extrabold text-ink-3">{b.r.position}</span>
                              <TeamBadge team={b.side.team} size={18} className="shrink-0" />
                              <b className="font-semibold text-ink">{String(b.r.web_name)}</b>
                              <span className="text-[11.5px] text-ink-3">£{b.r.price}m</span>
                              <span className="ml-auto font-num text-[15px] font-extrabold text-accent-2">{b.xp.toFixed(2)}<span className="ml-0.5 text-[9px] font-extrabold tracking-wider text-ink-3">xP</span></span>
                            </div>
                            <div className="mt-1 h-[8px] overflow-hidden rounded-full bg-surface-2">
                              <span className="block h-full rounded-full bg-accent" style={{ width: `${(b.xp / (inGame[0]?.xp || 1)) * 100}%` }} />
                            </div>
                          </button>
                        ))}
                      </div>

                      <div className="text-[12.5px] leading-relaxed">
                        <div className="mb-2 text-[11px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Behind the numbers</div>
                        {/* Projected score and clean-sheet odds are already on the
                            card above, so repeating them here spends the best
                            space on the page saying nothing twice. These are the
                            things you would otherwise have to leave the page to
                            find. */}
                        {(() => {
                          const inGameAll = board.filter((x) => x.side.team === m.h || x.side.team === m.a)
                          const sp = (team: string) => {
                            const names: string[] = []
                            for (const r of ratings) {
                              if (r.team !== team) continue
                              const p = availFor(avail, num(r, 'element'), num(r, 'code'))
                              if (p && ((p.corner_order != null && p.corner_order <= 1) || (p.fk_order != null && p.fk_order <= 1))) names.push(String(r.web_name))
                            }
                            return names.slice(0, 2).join(', ')
                          }
                          const owned = (x: typeof inGameAll[number]) => num(x.r, 'selected_by_percent') ?? 0
                          const diff = [...inGameAll].filter((x) => owned(x) <= 5 && x.xp >= 3).sort((a, c) => c.xp - a.xp)[0]
                          return (
                            <>
                              {PEN.map((t) => {
                                const team = t === 'h' ? m.h : m.a
                                const taker = penTaker(team)
                                const set = sp(team)
                                const bits = [taker, set ? `${set} (set pieces)` : null].filter(Boolean).join(' · ')
                                return bits ? <Fact key={t} k={<ClubTag team={team} what="dead balls" />} v={<b className="text-ink">{bits}</b>} /> : null
                              })}
                              {diff && (
                                <Fact
                                  k="Best differential"
                                  v={
                                    <span className="flex items-center justify-end gap-2">
                                      {/* Crest only. A headshot cropped to a
                                          table row's height is unreadable —
                                          you get a chin and a shoulder. */}
                                      <TeamBadge team={diff.side.team} size={17} className="shrink-0" />
                                      <span>
                                        <b className="text-ink">{String(diff.r.web_name)}</b>{' '}
                                        <span className="text-ink-3">{owned(diff).toFixed(1)}% owned · {diff.xp.toFixed(2)} xP</span>
                                      </span>
                                    </span>
                                  }
                                />
                              )}
                              {/* A line per club: a single merged list forces the
                                  reader to work out which side each name is on,
                                  which is the only thing they wanted to know. */}
                              {PEN.map((t) => {
                                const team = t === 'h' ? m.h : m.a
                                const outs = flagged.filter((f) => f.r.team === team)
                                return (
                                  <Fact
                                    key={`miss-${t}`}
                                    k={<ClubTag team={team} what="team news" />}
                                    v={outs.length
                                      ? (
                                        // Red is a ruling, amber is a doubt.
                                        // Printing both in one colour under the
                                        // word "missing" claimed a certainty
                                        // FPL itself doesn't have: a doubtful
                                        // player starts most weeks.
                                        <span className="inline-flex flex-wrap justify-end gap-x-1.5">
                                          {outs.slice(0, 5).map((f, i, a) => (
                                            <span key={String(f.r.element)} className={outTone(f.status)} title={`${LABEL[f.status] ?? 'OUT'}${f.news ? ` — ${f.news}` : ''}`}>
                                              {String(f.r.web_name)}{f.status === 'd' ? ' (doubt)' : ''}{i < a.length - 1 ? ',' : ''}
                                            </span>
                                          ))}
                                        </span>
                                      )
                                      : <span className="text-ink-3">Nobody flagged</span>}
                                  />
                                )
                              })}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  )}
                </div>
                </Exportable>
              )
  }

  return (
    <PageShell>
      <SectionBanner imgKey="preview" title={`GW${gw} Preview`} subtitle="Everything you need to get ready for the next gameweek" />

      <DeadlineStrip gw={gw} at={avail.deadlines.get(gw)} />
      <DataAge at={avail.generatedAt} />

      {!ready ? (
        <EmptyState icon={<Icon name="calendar" size={44} />}>
          The preview switches on once the bookmakers price gameweek {gw}.
          <div className="mt-1 text-sm text-ink-3">Every number on it is market-implied for these exact fixtures, so it waits for real odds rather than guessing.</div>
        </EmptyState>
      ) : (
        <>
          {/* Four different answers. An earlier version led with top expected
              points, which named the same player the captain podium below
              already leads with; the differential is the thing that block
              never tells you. */}
          <Section gw={gw} label="The round at a glance" name="at-a-glance">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              k="Biggest attack" v={attacks[0].lam.toFixed(2)} unit="xG"
              s={<><b>{teamLabel(attacks[0].team)}</b> projected goals {attacks[0].venue === 'H' ? 'v' : 'at'} {teamLabel(attacks[0].opp)}</>}
              media={<TeamBadge team={attacks[0].team} size={46} />}
            />
            <Tile
              k="Safest clean sheet" v={pc(shutouts[0].cs)}
              s={<><b>{teamLabel(shutouts[0].team)}</b> — the shutout to buy into</>}
              media={<TeamBadge team={shutouts[0].team} size={46} />}
            />
            <Tile
              k="Best differential" v={differential ? differential.xp.toFixed(2) : '—'} unit={differential ? 'xP' : undefined}
              s={differential
                ? <span className="flex items-center gap-1.5">
                    <TeamBadge team={differential.side.team} size={18} className="shrink-0" />
                    <span><b>{String(differential.r.web_name)}</b> — {differential.own.toFixed(1)}% owned, {differential.side.venue === 'H' ? 'v' : 'at'} {teamLabel(differential.side.opp)}</span>
                  </span>
                : <span className="text-ink-3">Nobody under 5% owned projects a return worth the risk.</span>}
              media={differential
                ? <PlayerPhoto
                    element={num(differential.r, 'element')}
                    code={num(differential.r, 'code')}
                    placeholder={<TeamBadge team={differential.side.team} size={46} />}
                    className="h-[68px] w-auto object-contain object-bottom"
                  />
                : undefined}
            />
            <Tile
              k="Goal-fest" v={matches[0].total.toFixed(2)} unit="xG"
              s={<><b>{teamLabel(matches[0].h)} v {teamLabel(matches[0].a)}</b> — most goals expected</>}
              media={<span className="flex items-center -space-x-2"><TeamBadge team={matches[0].h} size={38} /><TeamBadge team={matches[0].a} size={38} /></span>}
            />
          </div>
          </Section>

          {/* A podium: gold, silver, bronze foil, the same card material the
              rest of the site uses for rating tiers, so first place looks like
              first place before a number is read. */}
          <Section gw={gw} label="Captain" name="captain" tip="Expected points for this gameweek: each player's availability-adjusted baseline scaled by how kind this specific fixture is — attackers by their side's projected goals, defenders and keepers by the clean-sheet odds.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {board.slice(0, 3).map((b, i) => {
              const p = PODIUM[i]
              return (
                <button
                  key={String(b.r.element)}
                  onClick={() => navigate(playerHref(b.r.web_name, num(b.r, 'code')))}
                  className="relative overflow-hidden rounded-[11px] text-left transition-transform hover:-translate-y-0.5"
                  style={{ padding: 2, background: p.edge, boxShadow: p.glow }}
                >
                  <div className="relative min-h-[132px] overflow-hidden rounded-[9px] p-3.5 pr-[96px]" style={{ background: p.stock }}>
                    {p.foil && <div className="foil-shine-once" aria-hidden="true" />}
                    <PlayerPhoto
                      element={num(b.r, 'element')}
                      code={num(b.r, 'code')}
                      placeholder={null}
                      className="pointer-events-none absolute right-0 bottom-0 z-[1] h-[126px] w-auto object-contain object-bottom"
                      style={{ maskImage: 'linear-gradient(90deg, transparent, #000 42%)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 42%)' }}
                    />
                    <div className="relative z-[2]">
                      <div className="capture-flush text-[10px] font-extrabold tracking-[0.16em] uppercase" style={{ color: 'rgba(255,255,255,.6)' }}>{p.label}</div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <TeamBadge team={b.side.team} size={19} className="capture-sink shrink-0" />
                        <b className="capture-flush text-[18px] leading-tight font-extrabold text-white">{String(b.r.web_name)}</b>
                      </div>
                      <div className="capture-flush mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,.6)' }}>
                        {b.r.position} · {b.side.team} {b.side.venue === 'H' ? 'v' : 'at'} {b.side.opp} · £{b.r.price}m
                      </div>
                      {/* The unit rides on the baseline beside the number
                          rather than under it — a whole line of card height
                          for two characters was never a good trade. */}
                      <div className="mt-2.5 flex items-baseline gap-1.5">
                        <span className="tier-num font-num text-[34px] leading-none font-extrabold" style={{ backgroundImage: p.num, '--tier-capture': p.flat } as React.CSSProperties}>{b.xp.toFixed(2)}</span>
                        <span className="text-[11px] font-extrabold tracking-[0.14em]" style={{ color: 'rgba(255,255,255,.55)' }}>xP</span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          </Section>

          {/* Two levels of sharing here, and they answer different questions.
              The section export is the whole round — the picture you post on a
              Friday night. Each card carries its own share button so a single
              game can travel on its own, which is the one people actually
              send each other. */}
          <Section gw={gw} label="Every fixture" name="fixtures" className="mb-2" tip="Projected goals for each side and the chance of a clean sheet, both from the bookmakers' prices for these exact games. Ordered by kickoff and grouped by day, because that is how a round is actually lived. Tap a fixture to see the players it should produce.">
          {/* One featured match — the round's biggest game, opened by default
              and given the room to carry the full read. Everything else stays
              in kickoff order underneath it. */}
          {feature && card(feature, true)}

          {byDay.map(([day, list]) => (
            <div key={day} className="mb-6">
              {/* The matchday is how the round is navigated, so it reads as a
                  heading rather than a caption. */}
              <div className="mb-2.5 flex items-center gap-2.5 border-b border-line-mid pb-2">
                <span className="h-4 w-[3px] shrink-0 rounded-full bg-accent" />
                <h3 className="text-[15px] font-extrabold tracking-[0.05em] text-ink uppercase">{day}</h3>
              </div>
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">{list.map((m) => card(m, false))}</div>
            </div>
          ))}
          </Section>

          {/* Three columns rather than two: the top ten was a very wide table
              with a column of dead space beside it, and the two absence lists
              were stacked when they belong side by side. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.85fr_1.15fr]">
            <Section gw={gw} label="Expected points · top 10" name="top-10" className="">
              <div className="overflow-hidden rounded-xl border border-line">
                {board.slice(0, 10).map((b, i) => (
                  <button key={String(b.r.element)} onClick={() => navigate(playerHref(b.r.web_name, num(b.r, 'code')))} className="block w-full border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2/50">
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-center font-num text-[12px] font-extrabold text-ink-3">{i + 1}</span>
                      <TeamBadge team={b.side.team} size={17} />
                      <b className="capture-line truncate text-[14px] font-semibold text-ink">{String(b.r.web_name)}</b>
                      <span className="ml-auto shrink-0 font-num text-[15px] font-extrabold text-accent-2">{b.xp.toFixed(2)}</span>
                    </div>
                    <div className="mt-0.5 pl-6 text-[11px] text-ink-3">{b.r.position} · {b.side.team} {b.side.venue === 'H' ? 'v' : 'at'} {b.side.opp} · £{b.r.price}m</div>
                    {/* Scaled to the round's best pick, so the chart says how
                        far clear the captain choice actually is. */}
                    <div className="mt-1.5 ml-6 h-[7px] overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${(b.xp / (board[0]?.xp || 1)) * 100}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            </Section>

            {/* Who the fixture suits, in the space the top ten leaves behind.
                Measured on the live page at 1440 and 1760: the left column
                runs out at the tenth row and Team news carries on for another
                427px, so this costs the page no height at all — everything
                below it was already there. It reads as the shortlist you check
                after the captain call rather than before it, which is the
                right order for a tie-breaker.

                A whole round spreads about -9% to +15%, so the note under it
                says what the number is worth. On a phone the columns stack and
                this simply lands between the two lists. */}
            {gainers.length > 0 && (
              <Section gw={gw} label="Who the fixture suits" name="matchups" className="lg:col-start-1" share={false} tip="Where each defence gives up its expected goals — left, central or right channel, set pieces, headers — against the league average, and which attackers' own shot profiles land there. Ranked by that fit multiplied by the player's season expected goals, because a profile that suits a weakness perfectly is worth nothing on somebody who barely shoots. Every shot this season, penalties excluded.">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <MatchupLane title="The fixture helps" tone="good" rows={gainers} />
                  <MatchupLane title="The fixture hurts" tone="bad" rows={losers} />
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
                  Fit is how much of a player's shot profile lands where this defence is weakest, against the league.
                  Across a whole round the spread is about &minus;9% to +15% &mdash; a tie-breaker between two players you
                  already fancy, not a reason to captain somebody.
                </p>
              </Section>
            )}

            {/* One list, not two. "Who steps up" and "Team news" were the same
                players sorted differently — the same name appeared in both
                columns, once with a replacement and once without, which read
                as two contradictory lists rather than one story. Now every
                flagged player appears once, and the replacement is simply an
                extra line on the rows that have one. */}
            <Section gw={gw} label="Team news" name="team-news" className="" share={false} tip="Every flagged player in the round, most-owned first, from FPL's own status and news. Red is a ruling — injured, suspended, unavailable; amber is a doubt, and most doubts start. A replacement is named only where the absent man was in the first-choice line, so nobody is credited with benefiting from a squad player's absence.">
              <div className="overflow-hidden rounded-xl border border-line">
                {flagged.slice(0, 14).map((f) => (
                  <div key={String(f.r.element)} className="border-b border-line px-3 py-2.5 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide ${f.status === 'd' ? 'bg-warn/30 text-warn' : 'bg-bad/30 text-bad'}`}>{LABEL[f.status] ?? 'OUT'}</span>
                      <TeamBadge team={String(f.r.team)} size={18} className="shrink-0" />
                      <b className="capture-line truncate text-[14px] font-semibold text-ink">{String(f.r.web_name)}</b>
                      <span className="ml-auto shrink-0 text-[11px] text-ink-3">{f.r.position}</span>
                    </div>
                    {/* capture-line: the rasteriser measures a truncating line
                        into a box a few pixels short and slices the glyphs
                        through the middle — "Groin injury" exported with its
                        descenders cut off. */}
                    <div className="capture-line mt-0.5 truncate text-[11.5px] text-ink-3">{f.news}</div>
                    {f.step && (
                      <div className="mt-1.5 flex items-center gap-1.5 border-t border-line pt-1.5">
                        <Icon name="arrow-right" size={13} className="shrink-0 text-good" />
                        <span className="text-[9.5px] font-extrabold tracking-[0.1em] text-good uppercase">Steps up</span>
                        <b className="text-[13.5px] text-ink">{String(f.step.web_name)}</b>
                        <span className="text-[11.5px] text-ink-3">£{f.step.price}m</span>
                      </div>
                    )}
                  </div>
                ))}
                {!flagged.length && <div className="px-3 py-6 text-center text-[13px] text-ink-3">Nobody flagged — a clean round.</div>}
              </div>
            </Section>
          </div>
        </>
      )}
    </PageShell>
  )
}

const PEN = ['h', 'a'] as const

/** Gold, silver and bronze foil for the captain podium — the same material
 *  language as the rating cards: a gradient edge, dark stock, and a metal
 *  numeral. Only first place keeps the live shimmer.
 *
 *  `flat` is the same metal as a flat colour, for the share image: the numeral
 *  is a gradient clipped to the glyphs, which the rasteriser can't draw, so in
 *  capture mode it needs a colour or it exports as an empty space. */
const PODIUM = [
  {
    label: 'The pick', foil: true,
    edge: 'linear-gradient(160deg,#5f4d26,#c9a227,#ead188,#50411f)',
    stock: 'linear-gradient(168deg,#241f16,#141009 56%,#0c0906)',
    num: 'linear-gradient(180deg,#fffbf0,#f0e0b0 52%,#c9a227)',
    // A share image cannot draw the gradient — index.css explains why — so it
    // falls back to this one colour, taken from the gradient's midpoint.
    flat: '#ead188',
    glow: '0 0 0 1px rgba(255,251,240,.16), 0 0 20px -4px rgba(201,162,39,.55)',
  },
  {
    label: 'The challenger',
    edge: 'linear-gradient(160deg,#5C636B,#C9CFD6,#e8ecf1,#4a5057)',
    stock: 'linear-gradient(168deg,#1a1d21,#12151a 56%,#0a0c0e)',
    num: 'linear-gradient(180deg,#f4f7fa,#c9cfd6 52%,#7c838c)',
    flat: '#dfe4ea',
    glow: undefined as string | undefined,
  },
  {
    label: 'The outsider',
    edge: 'linear-gradient(160deg,#4a2f1a,#b87333,#e8b98a,#3d2614)',
    stock: 'linear-gradient(168deg,#221811,#17100b 56%,#0d0806)',
    num: 'linear-gradient(180deg,#f5d9bc,#d79a5e 52%,#9c5f2c)',
    flat: '#e8b98a',
    glow: undefined as string | undefined,
  },
]

/** One side of a fixture: crest, code, league position and last five. */
function Club({ team, rec, big, right }: { team: string; rec?: TeamRecord; big?: boolean; right?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center gap-1 sm:gap-2.5 ${big ? 'w-[68px] sm:w-[168px]' : 'w-[68px] sm:w-[158px]'} ${right ? 'flex-row-reverse justify-start' : ''}`}>
      <TeamBadge team={team} size={big ? 26 : 24} className="shrink-0 sm:hidden" />
      <TeamBadge team={team} size={big ? 42 : 38} className="hidden shrink-0 sm:block" />
      <span className={`min-w-0 ${right ? 'text-right' : ''}`}>
        <b className={`block leading-tight font-extrabold text-ink ${big ? 'text-[16px] sm:text-[24px]' : 'text-[14px] sm:text-[22px]'}`}>{team}</b>
        {rec?.pos ? <em className="text-[10.5px] font-bold text-ink-3 not-italic">{ord(rec.pos)}</em> : null}
      </span>
      {/* Desktop only. Five dots need about fifty pixels and the phone box is
          sixty-eight all in — crest, three-letter code and nothing else fits.
          In pre-season the dots render empty so this cost nothing and hid
          nothing; from the first result onward they would have pushed the
          crest straight off the card. */}
      <span className="hidden sm:flex"><FormDots form={rec?.form} /></span>
    </span>
  )
}

function Fact({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <span className="shrink-0 text-[11px] tracking-wide text-ink-3 uppercase">{k}</span>
      <span className="text-right text-ink-2">{v}</span>
    </div>
  )
}

/** A club label inside the notes: crest plus the full name, big enough to
 *  read — a three-letter code is fine on a fixture bar and too terse here. */
function ClubTag({ team, what }: { team: string; what: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <TeamBadge team={team} size={20} className="shrink-0" />
      <span className="text-[13px] font-semibold text-ink normal-case">{teamLabel(team)}</span>
      <span className="text-[11px] text-ink-3">{what}</span>
    </span>
  )
}

const LABEL: Record<string, string> = { i: 'OUT', s: 'SUSP', d: 'DOUBT', u: 'OUT', n: 'OUT' }

/** How certain FPL is. `d` is a doubt carrying a chance of playing — most
 *  doubts start — and everything else in OUT is a ruling. Red therefore means
 *  he is not playing; amber means nobody knows yet, including the club. */
const outTone = (status: string) => (status === 'd' ? 'text-warn' : 'text-bad')

/** A titled block of the page that can be lifted out of it as a picture.
 *
 *  The heading rides in the share button's own row rather than above it, so
 *  making a section shareable costs no height — and the export is the block
 *  itself, headed and footed by the exporter, not a screenshot of the page
 *  around it. */
/** One side of the matchup shortlist. Name, the fixture, the fit and the
 *  volume it is weighted by — the volume is on screen because it is half the
 *  ranking, and leaving it off is what made a +9% appear above a +10%. */
function MatchupLane({ title, tone, rows }: { title: string; tone: 'good' | 'bad'; rows: Edge[] }) {
  const navigate = useNavigate()
  if (!rows.length) return null
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className={`border-b border-line px-3 py-2 text-[10.5px] font-extrabold tracking-[0.12em] uppercase ${
        tone === 'good' ? 'bg-good/[0.07] text-good' : 'bg-bad/[0.06] text-bad'
      }`}>
        {tone === 'good' ? '\u2191' : '\u2193'} {title}
      </div>
      {rows.map((e) => {
        /* Only the good lane gets a sentence. On the other side there is no
           single category to name — the profile just misses everywhere — so
           four rows produced four copies of the same clause. It is said once,
           under the lane, instead. */
        const why = tone === 'good' ? edgeSentence(e, teamLabel(e.opp), false) : null
        return (
          <button
            key={String(e.player.element)}
            onClick={() => navigate(playerHref(String(e.player.web_name), num(e.player, 'code')))}
            className="flex w-full items-start gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold text-ink">{String(e.player.web_name)}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                <TeamBadge team={String(e.player.team)} size={11} />
                {e.player.team} v {e.opp} · £{e.player.price}m
              </span>
              {why && <span className="mt-1 block text-[11.5px] leading-snug text-ink-2">{why}</span>}
            </span>
            <span className="shrink-0 text-right">
              <span className={`block font-num text-[13px] font-extrabold tabular-nums ${tone === 'good' ? 'text-good' : 'text-bad'}`}>
                {e.uplift > 0 ? '+' : ''}{(e.uplift * 100).toFixed(0)}%
              </span>
              <span className="block text-[10px] text-ink-3">{e.xg.toFixed(1)} xG</span>
            </span>
          </button>
        )
      })}
      {tone === 'bad' && (
        <div className="border-t border-line px-3 py-2 text-[11px] leading-snug text-ink-3">
          These defences give up less than the league average in the areas each of these men shoots from.
        </div>
      )}
    </div>
  )
}

function Section({ gw, label, tip, name, className, share = true, children }: {
  gw: number
  label: string
  tip?: string
  name: string
  className?: string
  /** Off for a section that is worth reading here and not worth sending on.
   *
   *  Team news is the case: a picture of every flagged player in the round,
   *  with the replacement named for each, is most of an afternoon's research
   *  in one image. It is the reason to open the site, so giving it away as a
   *  file that travels without the site attached is a poor trade. Everything
   *  else on this page is a headline — a captain, a scoreline, one
   *  differential — and headlines are what you want reposted. */
  share?: boolean
  children: React.ReactNode
}) {
  const head = (
    <div className="mb-1.5 flex items-center gap-1.5">
      <h2 className="text-sm font-semibold tracking-wide text-ink uppercase">{label}</h2>
      {tip && <InfoTip text={tip} />}
    </div>
  )
  if (!share) {
    return (
      <div className={className ?? 'mb-7'}>
        {head}
        {children}
      </div>
    )
  }
  return (
    <Exportable
      title={`GW${gw} — ${label}`}
      filename={`gw${gw}-${name}`}
      className={className ?? 'mb-7'}
      toolbar={
        <>
          <h2 className="text-sm font-semibold tracking-wide text-ink uppercase">{label}</h2>
          {tip && <InfoTip text={tip} />}
        </>
      }
    >
      {children}
    </Exportable>
  )
}

function Tile({ k, v, s, unit, media }: { k: string; v: string; s: React.ReactNode; unit?: string; media?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-1/60 p-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">{k}</div>
        {/* A bare 2.38 says nothing. Every figure carries what it is. */}
        <div className="mt-1.5 font-num text-[30px] leading-none font-extrabold text-accent-2">
          {v}
          {unit && <span className="ml-1 text-[13px] font-extrabold tracking-wide text-ink-3">{unit}</span>}
        </div>
        {/* The subject of the tile — Gakpo, Arsenal, City v Bournemouth — at
            full ink strength while the sentence around it stays one step back.
            Every tile leads with a number, and the number is meaningless until
            you know who it belongs to; that name should be the second thing
            read, not something found by reading the whole line.

            The gap is 10px rather than 6 because of the export. On screen 6px
            cleared the number comfortably; in a share image the club crest on
            this line rode up into it and the Liverpool bird sat on top of the
            3.81. The rasteriser does not reproduce `leading-none` exactly, so
            the number's box is a few pixels off what the browser draws, and at
            export scale a few pixels is a collision. Four more here costs
            nothing on screen and puts the clearance beyond the error. */}
        <div className="mt-2.5 text-[13px] leading-snug text-ink-2 [&_b]:font-extrabold [&_b]:text-ink">{s}</div>
      </div>
      {media && <div className="shrink-0">{media}</div>}
    </div>
  )
}
