import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { TeamBadge } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { useCore } from '../lib/useData'
import { useAvailability, availFor } from '../lib/availability'
import { useMarketOdds, useXpModel, useShotProfiles, xpForGw, xpPartsForGw, type XpParts } from '../lib/xp'
import { num } from '../lib/rows'
import { teamLabel, playerHref } from '../lib/util'
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

interface Side { team: string; lam: number; against: number; cs: number; opp: string; venue: 'H' | 'A' }
interface Match { h: string; a: string; lh: number; la: number; csh: number; csa: number; total: number }

export default function Preview() {
  const { data, error } = useCore()
  const market = useMarketOdds()
  const avail = useAvailability()
  const model = useXpModel()
  const profiles = useShotProfiles()
  const navigate = useNavigate()
  const [open, setOpen] = useState<string | null>(null)

  const gw = data?.meta?.next_gw != null ? Number(data.meta.next_gw) : 1
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
      if (!seen.has(pair)) { seen.add(pair); matches.push({ h: team, a: opp, lh: v.for, la: v.against, csh: Math.exp(-v.against), csa: Math.exp(-v.for), total: v.for + v.against }) }
    }
    // byKey holds both directions, so venue has to come from the fixture list.
    for (const f of data?.fixtureEase ?? []) {
      if (f.gw !== gw) continue
      const s = sides.get(String(f.team))
      if (s) { s.venue = String(f.venue) === 'H' ? 'H' : 'A'; s.opp = String(f.opponent) }
    }
    // Keep only the home side's view of each pairing so h/a are the right way round.
    const fixed = matches.map((m) => (sides.get(m.h)?.venue === 'A' ? { ...m, h: m.a, a: m.h, lh: m.la, la: m.lh, csh: m.csa, csa: m.csh } : m))
    fixed.sort((x, y) => y.total - x.total)
    return { matches: fixed, sides }
  }, [market, data?.fixtureEase, gw])

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
    const rows: { r: RatingRow; xp: number; parts: XpParts | null; side: Side }[] = []
    for (const r of ratings) {
      const p = availFor(avail, num(r, 'element'), num(r, 'code'))
      if (p && OUT.has(String(p.status ?? 'a'))) continue
      const side = sides.get(String(r.team))
      if (!side) continue
      const xp = xpForGw(r, gw, fe, avail, model, market, profiles)
      if (xp == null) continue
      rows.push({ r, xp, parts: xpPartsForGw(r, gw, fe, avail, model, market, profiles), side })
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

          <Band label="Every fixture" tip="Projected goals for each side and the chance of a clean sheet, both from the bookmakers' prices for these exact games. Tap a fixture to see the players it should produce." />
          <div className="mb-7 grid gap-2.5 lg:grid-cols-2">
            {matches.map((m) => {
              const id = `${m.h}-${m.a}`
              const isOpen = open === id
              const inGame = board.filter((b) => b.side.team === m.h || b.side.team === m.a).slice(0, 5)
              return (
                <div key={id} className={`rounded-xl border p-3 transition-colors ${isOpen ? 'border-accent/45 bg-surface-2/50 lg:col-span-2' : 'border-line bg-surface-1/50'}`}>
                  <button onClick={() => setOpen(isOpen ? null : id)} className="w-full text-left">
                    <div className="flex items-center gap-2.5">
                      <span className="flex w-16 shrink-0 items-center gap-1.5 text-[13px] font-extrabold text-ink"><TeamBadge team={m.h} size={15} />{m.h}</span>
                      <span className="flex-1 text-center">
                        <span className={`block font-num text-[19px] leading-none font-extrabold ${xgTone(m.lh, m.la)}`}>{m.lh.toFixed(2)}</span>
                        <span className="mt-0.5 block text-[8px] font-extrabold tracking-[0.14em] text-ink-3">xG</span>
                      </span>
                      <span className="text-[10px] text-ink-3">v</span>
                      <span className="flex-1 text-center">
                        <span className={`block font-num text-[19px] leading-none font-extrabold ${xgTone(m.la, m.lh)}`}>{m.la.toFixed(2)}</span>
                        <span className="mt-0.5 block text-[8px] font-extrabold tracking-[0.14em] text-ink-3">xG</span>
                      </span>
                      <span className="flex w-16 shrink-0 items-center justify-end gap-1.5 text-[13px] font-extrabold text-ink">{m.a}<TeamBadge team={m.a} size={15} /></span>
                    </div>
                    {/* One bar, split by which side the goals belong to. Gold is
                        the favoured attack rather than the home side, so the bar
                        and the two numbers above it always agree about who is
                        expected to score more. */}
                    <div className={`mt-2 flex h-[6px] overflow-hidden rounded-full ${m.lh > m.la ? 'bg-info/35' : 'bg-accent/70'}`}>
                      <span className={`block ${m.lh > m.la ? 'bg-accent' : 'bg-info/35'}`} style={{ width: `${(m.lh / m.total) * 100}%` }} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between text-[11px] text-ink-3">
                      <span>Clean sheet <b className={`text-[14px] font-extrabold ${csTone(m.csh)}`}>{pc(m.csh)}</b></span>
                      <span className="text-[10.5px]">{m.total.toFixed(2)} goals expected</span>
                      <span>Clean sheet <b className={`text-[14px] font-extrabold ${csTone(m.csa)}`}>{pc(m.csa)}</b></span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="mt-3 grid gap-4 border-t border-line-mid pt-3 lg:grid-cols-[1.4fr_1fr]">
                      <div>
                        <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Where the points come from</div>
                        {inGame.map((b) => {
                          const p = b.parts
                          const seg: [string, number, string][] = p
                            ? ([
                                ['Goals', p.goal, 'var(--accent)'],
                                ['Assists', p.assist, 'var(--chart-4)'],
                                ['Clean sheet', p.cs, 'var(--good)'],
                                ['Saves', p.saves, 'var(--info)'],
                                ['Def con', p.dc, 'var(--chart-3)'],
                                ['Bonus', p.bonus, 'var(--star-c)'],
                                ['Appearance', p.appearance, 'var(--ink-3)'],
                              ] as [string, number, string][]).filter((x) => x[1] > 0.01)
                            : []
                          const tot = seg.reduce((t, [, v]) => t + v, 0) || 1
                          return (
                            <button key={String(b.r.element)} onClick={() => navigate(playerHref(b.r.web_name, num(b.r, 'code')))} className="mb-2 block w-full text-left last:mb-0">
                              <div className="flex items-center gap-2 text-[12px]">
                                <span className="w-7 shrink-0 text-[9px] font-extrabold text-ink-3">{b.r.position}</span>
                                <b className="font-semibold text-ink">{String(b.r.web_name)}</b>
                                <span className="text-[10.5px] text-ink-3">{b.side.team} · £{b.r.price}m</span>
                                <span className="ml-auto font-num font-extrabold text-accent-2">{b.xp.toFixed(2)}<span className="ml-0.5 text-[8px] font-extrabold tracking-wider text-ink-3">xP</span></span>
                              </div>
                              {/* The projection split by where it is earned — the
                                  thing a single number can never tell you, and the
                                  reason a 4.0 keeper and a 4.0 midfielder are not
                                  the same bet. */}
                              <div className="mt-1 flex h-[7px] gap-px overflow-hidden rounded-full">
                                {seg.map(([label, v, col]) => (
                                  <span key={label} title={`${label} ${v.toFixed(2)}`} style={{ width: `${(v / tot) * 100}%`, background: col }} />
                                ))}
                              </div>
                            </button>
                          )
                        })}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-ink-3">
                          {[['Goals', 'var(--accent)'], ['Assists', 'var(--chart-4)'], ['Clean sheet', 'var(--good)'], ['Saves', 'var(--info)'], ['Def con', 'var(--chart-3)'], ['Bonus', 'var(--star-c)']].map(([l, c]) => (
                            <span key={l} className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: c }} />{l}</span>
                          ))}
                        </div>
                      </div>

                      <div className="text-[11.5px] leading-relaxed">
                        <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">What the card doesn&rsquo;t say</div>
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
                          const value = [...inGameAll].sort((a, c) => c.xp / Math.max(num(c.r, 'price') ?? 4, 0.1) - a.xp / Math.max(num(a.r, 'price') ?? 4, 0.1))[0]
                          const bonus = [...inGameAll].sort((a, c) => (c.parts?.bonus ?? 0) - (a.parts?.bonus ?? 0))[0]
                          const outs = flagged.filter((f) => f.r.team === m.h || f.r.team === m.a)
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
                              {value && (
                                <Fact k="Most points per £m" v={<><b className="text-ink">{String(value.r.web_name)}</b> <span className="text-ink-3">£{value.r.price}m · {value.xp.toFixed(2)} xP</span></>} />
                              )}
                              {bonus && (bonus.parts?.bonus ?? 0) > 0.2 && (
                                <Fact k="Most likely bonus" v={<><b className="text-ink">{String(bonus.r.web_name)}</b> <span className="text-ink-3">{bonus.parts!.bonus.toFixed(2)} of his xP</span></>} />
                              )}
                              <Fact
                                k="Missing"
                                v={outs.length
                                  ? <span className="text-warn">{outs.slice(0, 5).map((f) => String(f.r.web_name)).join(', ')}</span>
                                  : <span className="text-ink-3">Nobody flagged</span>}
                              />
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Band label="Expected points · top 10" />
              <div className="overflow-hidden rounded-xl border border-line">
                {board.slice(0, 10).map((b, i) => (
                  <button key={String(b.r.element)} onClick={() => navigate(playerHref(b.r.web_name, num(b.r, 'code')))} className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left text-[12.5px] transition-colors last:border-0 hover:bg-surface-2/50">
                    <span className="w-4 shrink-0 text-center font-num text-[11px] font-extrabold text-ink-3">{i + 1}</span>
                    <b className="font-semibold text-ink">{String(b.r.web_name)}</b>
                    <span className="text-[10.5px] whitespace-nowrap text-ink-3">{b.r.position} · {b.side.team} {b.side.venue === 'H' ? 'v' : 'at'} {b.side.opp}</span>
                    <span className="ml-auto shrink-0 text-[10.5px] text-ink-3">£{b.r.price}m</span>
                    <span className="w-11 shrink-0 text-right font-num font-extrabold text-accent-2">{b.xp.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Band label="Who's missing" tip="A replacement is only named when the missing man was genuinely ahead in the pecking order — otherwise the page would credit a nailed starter with benefiting from a squad player's absence." />
              {steps.length > 0 && (
                <div className="mb-3 overflow-hidden rounded-xl border border-line">
                  {steps.map((f) => (
                    <div key={String(f.r.element)} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
                      <div className="min-w-0">
                        <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[8px] font-extrabold tracking-wide ${f.status === 'd' ? 'bg-warn/30' : 'bg-bad/30'}`}>{LABEL[f.status] ?? 'OUT'}</span>
                        <b className="text-[12.5px] text-ink">{String(f.r.web_name)}</b>
                        <div className="truncate text-[10.5px] text-ink-3">{f.news}</div>
                      </div>
                      <div className="ml-auto shrink-0 text-right">
                        <div className="text-[8px] font-extrabold tracking-[0.12em] text-good uppercase">Steps up</div>
                        <b className="text-[12.5px] text-ink">{String(f.step!.web_name)}</b>
                        <div className="text-[10px] text-ink-3">£{f.step!.price}m</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-hidden rounded-xl border border-line">
                {flagged.slice(0, 10).map((f) => (
                  <div key={String(f.r.element)} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] last:border-0">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-extrabold tracking-wide ${f.status === 'd' ? 'bg-warn/30' : 'bg-bad/30'}`}>{LABEL[f.status] ?? 'OUT'}</span>
                    <b className="font-semibold text-ink">{String(f.r.web_name)}</b>
                    <span className="text-[10.5px] text-ink-3">{f.r.team} {f.r.position}</span>
                    <span className="ml-auto truncate text-[10.5px] text-ink-3">{f.news}</span>
                  </div>
                ))}
                {!flagged.length && <div className="px-3 py-6 text-center text-sm text-ink-3">Nobody flagged — a clean round.</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}

const PEN = ['h', 'a'] as const

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-0">
      <span className="shrink-0 text-[10px] tracking-wide text-ink-3 uppercase">{k}</span>
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
