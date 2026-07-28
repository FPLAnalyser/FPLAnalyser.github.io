import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { TeamBadge } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { useCore } from '../lib/useData'
import { useAvailability, availFor, type TeamRecord } from '../lib/availability'
import { useMarketOdds, useXpModel, useShotProfiles, xpForGw } from '../lib/xp'
import { num } from '../lib/rows'
import { teamLabel, playerHref, derbyName, teamColors } from '../lib/util'
import type { RatingRow } from '../lib/types'

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

const OUT = new Set(['i', 's', 'u', 'n'])
const pc = (x: number) => `${Math.round(x * 100)}%`

/** Clean-sheet odds on the site's five-band language, so a green percentage
 *  here means what a green cell means on the fixture grid. */
const csTone = (cs: number) => (cs >= 0.38 ? 'text-good' : cs >= 0.28 ? 'text-good/80' : cs >= 0.20 ? 'text-warn' : 'text-bad')
/** Within a fixture the favoured attack is gold and the other side cool, so
 *  which way a game is expected to go is readable without comparing digits. */
const xgTone = (mine: number, theirs: number) => (mine > theirs ? 'text-accent-2' : 'text-info')
const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

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
  const navigate = useNavigate()
  const [open, setOpen] = useState<string | null>(null)

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
    const rows: { r: RatingRow; xp: number; side: Side }[] = []
    for (const r of ratings) {
      const p = availFor(avail, num(r, 'element'), num(r, 'code'))
      if (p && OUT.has(String(p.status ?? 'a'))) continue
      const side = sides.get(String(r.team))
      if (!side) continue
      const xp = xpForGw(r, gw, fe, avail, model, market, profiles)
      if (xp == null) continue
      rows.push({ r, xp, side })
    }
    return rows.sort((a, b) => b.xp - a.xp)
  }, [ratings, avail, sides, data?.fixtureEase, gw, model, market, profiles])

  /* Flagged players, and who actually steps up. Only shown when the missing
     man was AHEAD in the pecking order — otherwise the page prints "Bruno
     Fernandes benefits from Tielemans being doubtful", which is true of
     nobody. Rating stands in for the pecking order; it is a rough proxy and
     the honest limit of what we can know before a team sheet lands. */
  const flagged = useMemo(() => {
    const out: { r: RatingRow; status: string; news: string; own: number | null; step: RatingRow | null }[] = []
    for (const r of ratings) {
      const p = availFor(avail, num(r, 'element'), num(r, 'code'))
      if (!p || String(p.status ?? 'a') === 'a') continue
      const mine = num(r, 'season_overall_score') ?? 0
      const mates = ratings
        .filter((x) => x.team === r.team && x.position === r.position && x.element !== r.element)
        .filter((x) => { const q = availFor(avail, num(x, 'element'), num(x, 'code')); return !q || !OUT.has(String(q.status ?? 'a')) })
        .sort((a, b) => (num(b, 'season_overall_score') ?? 0) - (num(a, 'season_overall_score') ?? 0))
      const best = mates[0]
      out.push({
        r, status: String(p.status), news: String(p.news ?? '').split(' - ')[0],
        own: p.own ?? null,
        step: best && (num(best, 'season_overall_score') ?? 0) < mine ? best : null,
      })
    }
    return out.sort((a, b) => (b.own ?? 0) - (a.own ?? 0))
  }, [ratings, avail])

  if (!data) {
    return (
      <PageShell>
        <SectionBanner imgKey="fixtures" title="Preview" subtitle="The whole gameweek on one screen, before the deadline" />
        <PageSkeleton error={error} />
      </PageShell>
    )
  }

  const ready = matches.length > 0
  const attacks = [...sides.values()].sort((a, b) => b.lam - a.lam)
  const shutouts = [...sides.values()].sort((a, b) => b.cs - a.cs)
  const steps = flagged.filter((f) => f.step)
  /** The club's first-choice penalty taker, when the live layer knows one. */
  const penTaker = (team: string): string | null => {
    for (const r of ratings) {
      if (r.team !== team) continue
      const p = availFor(avail, num(r, 'element'), num(r, 'code'))
      if (p?.pen_order === 1) return String(r.web_name)
    }
    return null
  }

  /** One fixture card. `feat` is the round's headline game: bigger, opened,
   *  and carrying the full read rather than waiting for a tap. */
  const card = (m: Match, feat: boolean) => {
              const id = `${m.h}-${m.a}`
              const isOpen = feat || open === id
              const derby = derbyName(m.h, m.a)
              const inGame = board.filter((b) => b.side.team === m.h || b.side.team === m.a).slice(0, 5)
              return (
                <div
                  key={id}
                  className={`relative overflow-hidden rounded-xl border transition-colors ${feat ? 'border-accent/45 p-4' : 'p-3'} ${isOpen && !feat ? 'border-accent/45 lg:col-span-2' : feat ? '' : 'border-line'}`}
                  style={{
                    // A wash in each club's colour, bleeding in from its own
                    // corner, so a card carries both identities without a
                    // photograph competing with the numbers.
                    background: `radial-gradient(110% ${feat ? 200 : 150}% at 6% 0%, color-mix(in srgb, ${teamColors[m.h] ?? 'var(--accent)'} ${feat ? 26 : 14}%, transparent), transparent 56%), radial-gradient(110% ${feat ? 200 : 150}% at 94% 0%, color-mix(in srgb, ${teamColors[m.a] ?? 'var(--info)'} ${feat ? 26 : 14}%, transparent), transparent 56%), var(--surface-1)`,
                  }}
                >
                  {/* Both tags ride in the flow above the teams. Pinned to the
                      top-right corner the derby ribbon sat on top of the away
                      club's crest, and no amount of padding fixes that on the
                      narrow cards. */}
                  {(feat || derby) && (
                    <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                      {feat && <span className="rounded bg-accent px-2 py-1 text-[9px] font-extrabold tracking-[0.12em] text-accent-contrast uppercase">Match of the round</span>}
                      {derby && <span className="rounded bg-gradient-to-r from-accent to-accent-2 px-2 py-1 text-[9px] font-extrabold tracking-[0.1em] text-accent-contrast uppercase">{derby}</span>}
                    </div>
                  )}
                  <button onClick={() => setOpen(isOpen ? null : id)} className="w-full text-left">
                    <div className="flex items-center gap-2.5">
                      <Club team={m.h} rec={avail.table.get(m.hid)} big={feat} />
                      <span className="flex-1 text-center">
                        <span className={`block font-num leading-none font-extrabold ${feat ? 'text-[22px] sm:text-[34px]' : 'text-[20px] sm:text-[26px]'} ${xgTone(m.lh, m.la)}`}>{m.lh.toFixed(2)}</span>
                        <span className="mt-1 block text-[9.5px] font-extrabold tracking-[0.14em] text-ink-3">xG</span>
                      </span>
                      <span className="rounded bg-black/35 px-2 py-1 text-[12px] font-extrabold whitespace-nowrap text-ink-2">
                        {m.k ? TIME.format(new Date(m.k)) : 'v'}
                      </span>
                      <span className="flex-1 text-center">
                        <span className={`block font-num leading-none font-extrabold ${feat ? 'text-[22px] sm:text-[34px]' : 'text-[20px] sm:text-[26px]'} ${xgTone(m.la, m.lh)}`}>{m.la.toFixed(2)}</span>
                        <span className="mt-1 block text-[9.5px] font-extrabold tracking-[0.14em] text-ink-3">xG</span>
                      </span>
                      <Club team={m.a} rec={avail.table.get(m.aid)} big={feat} right />
                    </div>
                    {/* One bar, split by which side the goals belong to. Gold is
                        the favoured attack rather than the home side, so the bar
                        and the two numbers above it always agree about who is
                        expected to score more. Both halves are solid: an earlier
                        version drew the underdog at 35% opacity, which read as
                        silver rather than blue and made the bar look like it was
                        saying something it wasn't. */}
                    <div className="mt-2.5 flex h-[8px] overflow-hidden rounded-full">
                      <span className={`block ${m.lh > m.la ? 'bg-accent' : 'bg-info'}`} style={{ width: `${(m.lh / m.total) * 100}%` }} />
                      <span className={`block flex-1 ${m.lh > m.la ? 'bg-info' : 'bg-accent'}`} />
                    </div>
                    <div className="mt-2.5 flex items-baseline justify-between text-[12.5px] text-ink-3">
                      <span>Clean Sheet <b className={`text-[17px] font-extrabold ${csTone(m.csh)}`}>{pc(m.csh)}</b></span>
                      <span className="text-[12px]">{m.total.toFixed(2)} goals expected</span>
                      <span>Clean Sheet <b className={`text-[17px] font-extrabold ${csTone(m.csa)}`}>{pc(m.csa)}</b></span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="mt-3 grid gap-4 border-t border-line-mid pt-3 lg:grid-cols-[1.4fr_1fr]">
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
                              <b className="font-semibold text-ink">{String(b.r.web_name)}</b>
                              <span className="text-[11.5px] text-ink-3">{b.side.team} · £{b.r.price}m</span>
                              <span className="ml-auto font-num text-[15px] font-extrabold text-accent-2">{b.xp.toFixed(2)}<span className="ml-0.5 text-[9px] font-extrabold tracking-wider text-ink-3">xP</span></span>
                            </div>
                            <div className="mt-1 h-[8px] overflow-hidden rounded-full bg-surface-2">
                              <span className="block h-full rounded-full bg-accent" style={{ width: `${(b.xp / (inGame[0]?.xp || 1)) * 100}%` }} />
                            </div>
                          </button>
                        ))}
                      </div>

                      <div className="text-[12.5px] leading-relaxed">
                        <div className="mb-2 text-[11px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Team notes</div>
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
                                const bits = [taker ? `${taker} (pens)` : null, set ? `${set} (set pieces)` : null].filter(Boolean).join(' · ')
                                return bits ? <Fact key={t} k={`${team} dead balls`} v={<b className="text-ink">{bits}</b>} /> : null
                              })}
                              {diff && (
                                <Fact k="Best differential" v={<><b className="text-ink">{String(diff.r.web_name)}</b> <span className="text-ink-3">{owned(diff).toFixed(1)}% owned · {diff.xp.toFixed(2)} xP</span></>} />
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
                                    k={`${team} missing`}
                                    v={outs.length
                                      ? <span className="text-warn">{outs.slice(0, 5).map((f) => String(f.r.web_name)).join(', ')}</span>
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
              )
  }

  // The biggest game of the round by total goals, lifted out of the list.
  const feature = matches.length ? matches.reduce((best, m) => (m.total > best.total ? m : best)) : null
  const byDay = useMemo(() => {
    const out = new Map<string, Match[]>()
    for (const m of matches) {
      if (m === feature) continue
      const key = m.k ? DAY.format(new Date(m.k)) : 'Kickoff to be confirmed'
      out.set(key, [...(out.get(key) ?? []), m])
    }
    return [...out.entries()]
  }, [matches, feature])

  return (
    <PageShell>
      <SectionBanner imgKey="fixtures" title={`GW${gw} Preview`} subtitle="Captain, chips, the games that produce the points, and who is missing" />

      {!ready ? (
        <EmptyState icon={<Icon name="calendar" size={44} />}>
          The preview switches on once the bookmakers price gameweek {gw}.
          <div className="mt-1 text-sm text-ink-3">Every number on it is market-implied for these exact fixtures, so it waits for real odds rather than guessing.</div>
        </EmptyState>
      ) : (
        <>
          <Band label="The round at a glance" />
          <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile k="Biggest attack" v={attacks[0].lam.toFixed(2)} s={<><b>{teamLabel(attacks[0].team)}</b> projected goals {attacks[0].venue === 'H' ? 'v' : 'at'} {attacks[0].opp}</>} />
            <Tile k="Safest clean sheet" v={pc(shutouts[0].cs)} s={<><b>{teamLabel(shutouts[0].team)}</b> — the shutout to buy into</>} />
            <Tile k="Top expected points" v={board[0] ? board[0].xp.toFixed(1) : '—'} s={board[0] ? <><b>{String(board[0].r.web_name)}</b> {board[0].side.venue === 'H' ? 'v' : 'at'} {board[0].side.opp}</> : null} />
            <Tile k="Goal-fest" v={matches[0].total.toFixed(2)} s={<><b>{matches[0].h} v {matches[0].a}</b> — most goals expected</>} />
          </div>

          <Band label="Captain" tip="Expected points for this gameweek: each player's availability-adjusted baseline scaled by how kind this specific fixture is — attackers by their side's projected goals, defenders and keepers by the clean-sheet odds." />
          <div className="mb-7 grid gap-3 sm:grid-cols-3">
            {board.slice(0, 3).map((b, i) => (
              <button
                key={String(b.r.element)}
                onClick={() => navigate(playerHref(b.r.web_name, num(b.r, 'code')))}
                className={`rounded-xl border p-3.5 text-left transition-colors ${i === 0 ? 'border-accent/55 bg-accent-soft/40' : 'border-line bg-surface-1/60 hover:border-line-strong'}`}
              >
                <div className="text-[9px] font-extrabold tracking-[0.14em] text-accent uppercase">{i === 0 ? 'The pick' : `Alternative ${i}`}</div>
                <div className="mt-1 text-[17px] font-extrabold text-ink">{String(b.r.web_name)}</div>
                <div className="text-[11px] text-ink-3">{b.r.position} · {b.side.team} {b.side.venue === 'H' ? 'v' : 'at'} {b.side.opp} · £{b.r.price}m</div>
                <div className="mt-2 font-num text-[26px] leading-none font-extrabold text-accent-2">{b.xp.toFixed(2)}</div>
                <div className="text-[10px] text-ink-3">expected points</div>
              </button>
            ))}
          </div>

          <Band label="Every fixture" tip="Projected goals for each side and the chance of a clean sheet, both from the bookmakers' prices for these exact games. Ordered by kickoff and grouped by day, because that is how a round is actually lived. Tap a fixture to see the players it should produce." />

          {/* One featured match — the round's biggest game, opened by default
              and given the room to carry the full read. Everything else stays
              in kickoff order underneath it. */}
          {feature && <div className="mb-4">{card(feature, true)}</div>}

          {byDay.map(([day, list]) => (
            <div key={day} className="mb-6">
              {/* The matchday is how the round is navigated, so it reads as a
                  heading rather than a caption. */}
              <div className="mb-2.5 flex items-center gap-2.5 border-b border-line-mid pb-2">
                <span className="h-4 w-[3px] shrink-0 rounded-full bg-accent" />
                <h3 className="text-[15px] font-extrabold tracking-[0.05em] text-ink uppercase">{day}</h3>
              </div>
              <div className="grid gap-2.5 lg:grid-cols-2">{list.map((m) => card(m, false))}</div>
            </div>
          ))}

          {/* Three columns rather than two: the top ten was a very wide table
              with a column of dead space beside it, and the two absence lists
              were stacked when they belong side by side. */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <Band label="Expected points · top 10" />
              <div className="overflow-hidden rounded-xl border border-line">
                {board.slice(0, 10).map((b, i) => (
                  <button key={String(b.r.element)} onClick={() => navigate(playerHref(b.r.web_name, num(b.r, 'code')))} className="block w-full border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2/50">
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-center font-num text-[12px] font-extrabold text-ink-3">{i + 1}</span>
                      <TeamBadge team={b.side.team} size={17} />
                      <b className="truncate text-[14px] font-semibold text-ink">{String(b.r.web_name)}</b>
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
            </div>

            <div>
              <Band label="Who's missing" tip="A replacement is only named when the missing man was genuinely ahead in the pecking order — otherwise the page would credit a nailed starter with benefiting from a squad player's absence." />
              <div className="overflow-hidden rounded-xl border border-line">
                {steps.map((f) => (
                  <div key={String(f.r.element)} className="border-b border-line px-3 py-2.5 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide ${f.status === 'd' ? 'bg-warn/30' : 'bg-bad/30'}`}>{LABEL[f.status] ?? 'OUT'}</span>
                      <TeamBadge team={String(f.r.team)} size={16} />
                      <b className="truncate text-[13.5px] text-ink">{String(f.r.web_name)}</b>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-3">{f.news}</div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[9.5px] font-extrabold tracking-[0.1em] text-good uppercase">Steps up</span>
                      <b className="text-[13px] text-ink">{String(f.step!.web_name)}</b>
                      <span className="text-[11px] text-ink-3">£{f.step!.price}m</span>
                    </div>
                  </div>
                ))}
                {!steps.length && <div className="px-3 py-6 text-center text-[13px] text-ink-3">Nobody's absence changes a starting eleven.</div>}
              </div>
            </div>

            <div>
              <Band label="Injury doubts" tip="Every flagged player in the round, most-owned first — FPL's own status and news, refreshed daily." />
              <div className="overflow-hidden rounded-xl border border-line">
                {flagged.slice(0, 12).map((f) => (
                  <div key={String(f.r.element)} className="border-b border-line px-3 py-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide ${f.status === 'd' ? 'bg-warn/30' : 'bg-bad/30'}`}>{LABEL[f.status] ?? 'OUT'}</span>
                      <TeamBadge team={String(f.r.team)} size={16} />
                      <b className="truncate text-[13.5px] font-semibold text-ink">{String(f.r.web_name)}</b>
                      <span className="ml-auto shrink-0 text-[11px] text-ink-3">{f.r.position}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-3">{f.news}</div>
                  </div>
                ))}
                {!flagged.length && <div className="px-3 py-6 text-center text-[13px] text-ink-3">Nobody flagged — a clean round.</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}

const PEN = ['h', 'a'] as const

/** One side of a fixture: crest, code, league position and last five. */
function Club({ team, rec, big, right }: { team: string; rec?: TeamRecord; big?: boolean; right?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 sm:gap-2 ${big ? 'w-[72px] sm:w-[148px]' : 'w-[72px] sm:w-[124px]'} ${right ? 'flex-row-reverse justify-start' : ''}`}>
      <TeamBadge team={team} size={big ? 26 : 22} className="shrink-0" />
      <span className={`min-w-0 ${right ? 'text-right' : ''}`}>
        <b className={`block leading-tight font-extrabold text-ink ${big ? 'text-[16px] sm:text-[20px]' : 'text-[14px] sm:text-[15px]'}`}>{team}</b>
        {rec?.pos ? <em className="text-[10.5px] font-bold text-ink-3 not-italic">{ord(rec.pos)}</em> : null}
      </span>
      <FormDots form={rec?.form} />
    </span>
  )
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-0">
      <span className="shrink-0 text-[11px] tracking-wide text-ink-3 uppercase">{k}</span>
      <span className="text-right text-ink-2">{v}</span>
    </div>
  )
}

const LABEL: Record<string, string> = { i: 'OUT', s: 'SUSP', d: 'DOUBT', u: 'OUT', n: 'OUT' }

function Band({ label, tip }: { label: string; tip?: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-1.5">
      <h2 className="text-sm font-semibold tracking-wide text-ink uppercase">{label}</h2>
      {tip && <InfoTip text={tip} />}
    </div>
  )
}

function Tile({ k, v, s }: { k: string; v: string; s: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1/60 p-3">
      <div className="text-[9px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">{k}</div>
      <div className="mt-1 font-num text-[23px] leading-none font-extrabold text-accent-2">{v}</div>
      <div className="mt-1 text-[11.5px] leading-snug text-ink-2">{s}</div>
    </div>
  )
}
