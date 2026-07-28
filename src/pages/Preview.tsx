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
import { useMarketOdds } from '../lib/xp'
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

interface Side { team: string; lam: number; against: number; cs: number; opp: string; venue: 'H' | 'A' }
interface Match { h: string; a: string; lh: number; la: number; csh: number; csa: number; total: number }

export default function Preview() {
  const { data, error } = useCore()
  const market = useMarketOdds()
  const avail = useAvailability()
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

  /* Expected points for the round. A player's availability-adjusted baseline,
     scaled by how this specific fixture compares with an average one —
     attackers ride their side's goal expectancy, defenders and keepers ride
     the clean-sheet odds. */
  const board = useMemo(() => {
    const rows: { r: RatingRow; xp: number; side: Side }[] = []
    for (const r of ratings) {
      const p = availFor(avail, num(r, 'element'), num(r, 'code'))
      if (p && OUT.has(String(p.status ?? 'a'))) continue
      const xp = num(r, 'season_xpts_adjusted')
      const side = sides.get(String(r.team))
      if (xp == null || !side) continue
      const att = r.position === 'MID' || r.position === 'FWD'
      const mult = Math.max(0.55, Math.min(1.9, att ? side.lam / 1.45 : side.cs / 0.24))
      rows.push({ r, xp: xp * mult, side })
    }
    return rows.sort((a, b) => b.xp - a.xp)
  }, [ratings, avail, sides])

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
                      <span className="flex-1 text-center font-num text-[19px] leading-none font-extrabold text-accent-2">{m.lh.toFixed(2)}</span>
                      <span className="text-[10px] text-ink-3">v</span>
                      <span className="flex-1 text-center font-num text-[19px] leading-none font-extrabold text-accent-2">{m.la.toFixed(2)}</span>
                      <span className="flex w-16 shrink-0 items-center justify-end gap-1.5 text-[13px] font-extrabold text-ink">{m.a}<TeamBadge team={m.a} size={15} /></span>
                    </div>
                    {/* One bar, split by which side the goals belong to. */}
                    <div className="mt-2 flex h-[5px] overflow-hidden rounded-full bg-info/35">
                      <span className="block bg-accent" style={{ width: `${(m.lh / m.total) * 100}%` }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] text-ink-3">
                      <span>CS <b className="text-ink">{pc(m.csh)}</b></span>
                      <span>{m.total.toFixed(2)} goals</span>
                      <span>CS <b className="text-ink">{pc(m.csa)}</b></span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="mt-3 border-t border-line-mid pt-3">
                      <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Top expected points in this game</div>
                      {inGame.map((b) => (
                        <button key={String(b.r.element)} onClick={() => navigate(playerHref(b.r.web_name, num(b.r, 'code')))} className="flex w-full items-center gap-2 py-1 text-left text-[12px] hover:text-accent">
                          <span className="w-8 shrink-0 text-[9px] font-extrabold text-ink-3">{b.r.position}</span>
                          <b className="font-semibold text-ink">{String(b.r.web_name)}</b>
                          <span className="text-[10.5px] text-ink-3">{b.side.team} · £{b.r.price}m</span>
                          <span className="ml-auto font-num font-extrabold text-accent-2">{b.xp.toFixed(2)}</span>
                        </button>
                      ))}
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
