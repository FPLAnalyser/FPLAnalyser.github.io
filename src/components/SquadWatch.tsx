import { useCallback, useMemo, useState } from 'react'
import { Panel } from './SquadShape'
import { Icon } from './Icon'
import { useLazyTable } from '../lib/useData'
import { availBadge, availFor, newsAge, type Availability } from '../lib/availability'
import { num } from '../lib/rows'
import type { PlayerSeries } from '../lib/squadInsights'
import type { FixtureEaseRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   Triage.

   Everything else on the Insights tab answers "how good is this squad".
   These two answer the question you actually have on a Friday: what, if
   anything, do I need to do about it.

   Both are compositions. Minutes risk, price velocity and the fixture run
   each already have a panel of their own that shows them properly; what
   was missing is the one place that puts a player's name against a single
   verdict, so a fifteen can be scanned rather than read. That is why the
   driver is always named — a lone composite score would be hiding the
   three panels it was built from, which is worse than not having it.
   ════════════════════════════════════════════════════════════════════════ */

interface PriceRow {
  element: number; web_name: string; team: string; position: string
  net_transfers_2gw: number; selected: number; velocity: number; risk: string
}

const HARD = 4          // FDR at which a fixture counts as hard
const SEEN_KEY = 'fpl_watch_seen'

// ── the monitor ─────────────────────────────────────────────────────────────

type Status = 'hold' | 'watch' | 'risk'
const PILL: Record<Status, { label: string; cls: string }> = {
  hold: { label: 'Hold', cls: 'border-good/45 text-good' },
  watch: { label: 'Watch', cls: 'border-warn/50 text-warn' },
  risk: { label: 'At risk', cls: 'border-bad/50 text-bad' },
}

export function SquadRiskMonitor({ squad, gws, fixtureEase, avail }: {
  squad: PlayerSeries[]
  gws: number[]
  fixtureEase: FixtureEaseRow[]
  /* Optional because the engine's is: the availability feed is a live fetch
     and every panel has to work before it lands, not after. */
  avail?: Availability
}) {
  const q = useLazyTable<PriceRow[]>('price_risk')
  const prices = useMemo(() => {
    const m = new Map<number, PriceRow>()
    if (Array.isArray(q.data)) for (const r of q.data) m.set(r.element, r)
    return m
  }, [q.data])

  const rows = useMemo(() => {
    const fdr = new Map<string, number>()
    for (const f of fixtureEase) fdr.set(`${f.team}|${f.gw}`, f.fdr)

    return squad.map((p) => {
      const p60 = p.weeks.find((w) => w.parts)?.parts?.p60 ?? null
      /* The chance he does not reach the hour. Every projection on the tab is
         multiplied by p60, so this is the assumption with the most leverage —
         and unlike rotation risk it is populated before a ball is kicked. */
      const mins = p60 == null ? 0 : Math.round((1 - p60) * 100)
      const hard = gws.filter((gw) => (fdr.get(`${p.team}|${gw}`) ?? 3) >= HARD).length
      const price = prices.get(p.element)
      const falling = price ? price.velocity < -0.15 : false
      const flag = avail ? availBadge(availFor(avail, p.element, num(p.row, 'code'))) : null

      /* Weighted so the two signals reach a comparable size over a six-week
         window: a fifth of a squad missing the hour and a fifth of the window
         being hard should push about equally hard. Availability is not blended
         in — a flagged player is not a "risk", he is a decision, so he
         short-circuits to the top instead of being averaged into the middle. */
      const mC = mins * 1.6
      const fC = hard * 13
      const score = flag ? Math.max(70, Math.round(mC + fC)) : Math.min(99, Math.round(mC + fC))

      let driver: string
      let detail: string
      if (flag) {
        driver = 'Availability'
        detail = flag.title
      } else if (mC >= 8 && fC >= 8 && Math.abs(mC - fC) < Math.max(mC, fC) / 3) {
        // Neither dominates. Naming one of them would be picking a winner off a
        // rounding difference and telling the reader something false about why
        // the row is red.
        driver = 'Minutes + fixtures'
        detail = `${mins}% below the hour · ${hard} hard of ${gws.length}`
      } else if (mC > fC && mins >= 8) {
        driver = 'Minutes'
        detail = `${mins}% chance he does not reach 60`
      } else if (hard) {
        driver = 'Fixtures'
        detail = `${hard} hard of ${gws.length}`
      } else if (falling) {
        driver = 'Price'
        detail = 'losing owners fast enough to drop'
      } else {
        driver = 'Nothing showing'
        detail = '—'
      }

      const status: Status = flag || score >= 50 ? 'risk' : score >= 32 ? 'watch' : 'hold'
      return { p, score, driver, detail, status, flagged: Boolean(flag) }
    }).sort((a, b) => b.score - a.score)
  }, [squad, gws, fixtureEase, prices, avail])

  if (!rows.length) return null
  const atRisk = rows.filter((r) => r.status === 'risk')
  const flagged = rows.filter((r) => r.flagged)

  return (
    <Panel
      title="Squad risk monitor"
      kicker="One row per player, sorted by how much attention he needs. Not how good he is — how likely you are to regret holding him."
      note={
        <>
          {atRisk.length
            ? <>{atRisk.length} of the fifteen {atRisk.length === 1 ? 'is' : 'are'} worth a second look
                {flagged.length ? `, ${flagged.length} of them because FPL has flagged ${flagged.length === 1 ? 'him' : 'them'}` : ''}. </>
            : <>Nothing in the fifteen is flagged and nobody clears the threshold, so there is no
                forced move this week. </>}
          <b>The driver column is the point.</b> A single risk score would be hiding the three panels
          it is built from — minutes, fixtures and price each have their own reading elsewhere on
          this tab, and each means something different. This table only tells you where to look
          first; it is not a fourth opinion.
          {' '}The minutes figure is last season&rsquo;s until a ball is kicked, and a manager&rsquo;s
          team sheet is not a thing any model reads.
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10px] tracking-[0.09em] text-ink-3 uppercase">
              <th className="py-1.5 pr-2 text-left font-semibold">Player</th>
              <th className="px-2 py-1.5 text-left font-semibold">Driver</th>
              <th className="px-2 py-1.5 text-left font-semibold">Attention</th>
              <th className="px-2 py-1.5 text-left font-semibold">Status</th>
              <th className="py-1.5 pl-2 text-right font-semibold">xP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, score, driver, detail, status }) => (
              <tr key={p.element} className="border-b border-line last:border-0">
                <td className="py-2 pr-2">
                  <span className="block text-[12.5px] font-semibold text-ink">{String(p.row.web_name ?? '—')}</span>
                  <span className="block text-[10px] text-ink-3">{p.pos} · {p.team} · £{p.price.toFixed(1)}</span>
                </td>
                <td className="px-2 py-2">
                  <span className="block text-[12px] text-ink-2">{driver}</span>
                  <span className="block max-w-[26ch] truncate text-[10px] text-ink-3" title={detail}>{detail}</span>
                </td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    <Segments v={score} status={status} />
                    <span className="font-num text-[11.5px] tabular-nums text-ink-3">{score}%</span>
                  </span>
                </td>
                <td className="px-2 py-2">
                  <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${PILL[status].cls}`}>
                    {PILL[status].label}
                  </span>
                </td>
                <td className="font-num py-2 pl-2 text-right tabular-nums text-ink-2">{p.total.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* Twelve blocks rather than a continuous bar. A quantity split into countable
   units reads as a level at a glance where a smooth bar reads as a value to be
   measured against its track — and at phone width the blocks stay legible when
   a 4px-tall bar does not. */
function Segments({ v, status }: { v: number; status: Status }) {
  const on = Math.round((Math.max(0, Math.min(100, v)) / 100) * 12)
  const fill = status === 'risk' ? 'bg-bad' : status === 'watch' ? 'bg-warn' : 'bg-good'
  return (
    <span className="flex gap-[2px]" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className={`h-3.5 w-[6px] rounded-[2px] ${i < on ? fill : 'bg-surface-3'}`} />
      ))}
    </span>
  )
}

// ── since you last looked ───────────────────────────────────────────────────

interface Item {
  id: string
  when: number | null          // null = a standing condition, not an event
  sev: 'high' | 'medium' | 'info'
  head: string
  sub: string
}

const SEV: Record<Item['sev'], string> = {
  high: 'border-bad/50 text-bad',
  medium: 'border-warn/50 text-warn',
  info: 'border-line-mid text-ink-3',
}
const DOT: Record<Item['sev'], string> = { high: 'bg-bad', medium: 'bg-warn', info: 'bg-ink-3' }

export function SquadWatch({ squad, gws, fixtureEase, avail }: {
  squad: PlayerSeries[]
  gws: number[]
  fixtureEase: FixtureEaseRow[]
  avail?: Availability
}) {
  const q = useLazyTable<PriceRow[]>('price_risk')
  const [seen, setSeen] = useState<number>(() => {
    try { return Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { return 0 }
  })
  const markSeen = useCallback(() => {
    const now = Date.now()
    try { localStorage.setItem(SEEN_KEY, String(now)) } catch { /* private mode */ }
    setSeen(now)
  }, [])

  const { events, standing } = useMemo(() => {
    const ev: Item[] = []
    const st: Item[] = []
    const owned = new Set(squad.map((p) => p.element))

    // 1. Team news. The only genuinely timestamped source here — FPL publishes
    //    when the note was added, so these are events in the ordinary sense.
    for (const p of squad) {
      const a = avail ? availFor(avail, p.element, num(p.row, 'code')) : null
      const badge = availBadge(a)
      if (!a || !badge) continue
      const t = a.news_added ? Date.parse(a.news_added) : NaN
      ev.push({
        id: `news-${p.element}`,
        when: Number.isFinite(t) ? t : null,
        sev: badge.tone === 'bad' ? 'high' : 'medium',
        head: `${String(p.row.web_name)} — ${badge.label}`,
        sub: `${a.news || 'No detail from FPL'}${newsAge(a.news_added) ? ` · ${newsAge(a.news_added)}` : ''}`,
      })
    }

    // 2. Price moves among your own players.
    if (Array.isArray(q.data)) {
      for (const r of q.data) {
        if (!owned.has(r.element) || Math.abs(r.velocity) < 0.15) continue
        const up = r.velocity > 0
        st.push({
          id: `price-${r.element}`,
          when: null,
          sev: 'medium',
          head: `${r.web_name} is ${up ? 'gaining' : 'shedding'} owners fast enough to ${up ? 'rise' : 'drop'}`,
          sub: `${r.net_transfers_2gw > 0 ? '+' : ''}${Math.round(r.net_transfers_2gw / 1000)}k net over two gameweeks · worth 0.1m and nothing else`,
        })
      }
    }

    // 3. The worst week on the horizon.
    const fdr = new Map<string, number>()
    for (const f of fixtureEase) fdr.set(`${f.team}|${f.gw}`, f.fdr)
    const perGw = gws.map((gw) => ({
      gw, n: squad.filter((p) => (fdr.get(`${p.team}|${gw}`) ?? 3) >= HARD).length,
    }))
    const worst = perGw.reduce((a, b) => (b.n > a.n ? b : a), perGw[0] ?? { gw: 0, n: 0 })
    if (worst.n >= 5) {
      st.push({
        id: `horizon-${worst.gw}`,
        when: null,
        sev: worst.n >= 7 ? 'high' : 'medium',
        head: `GW${worst.gw} puts ${worst.n} of your fifteen in a hard game`,
        sub: 'The roughest week in the window — early enough to plan around rather than react to',
      })
    }

    // 4. Club stacks at the limit.
    const byClub = new Map<string, string[]>()
    for (const p of squad) byClub.set(p.team, [...(byClub.get(p.team) ?? []), String(p.row.web_name)])
    for (const [team, names] of byClub) {
      if (names.length < 3) continue
      st.push({
        id: `club-${team}`,
        when: null,
        sev: 'medium',
        head: `Three ${team} players — one postponement moves a fifth of your outfield`,
        sub: `${names.join(', ')} · a correlation the projection cannot price`,
      })
    }

    const rank = { high: 0, medium: 1, info: 2 }
    ev.sort((a, b) => (b.when ?? 0) - (a.when ?? 0) || rank[a.sev] - rank[b.sev])
    st.sort((a, b) => rank[a.sev] - rank[b.sev])
    return { events: ev, standing: st }
  }, [squad, gws, fixtureEase, avail, q.data])

  const fresh = events.filter((i) => i.when != null && i.when > seen)
  if (!events.length && !standing.length) return null

  return (
    <Panel
      title="Since you last looked"
      kicker="Team news on your own players, and the conditions worth knowing about before you spend a transfer."
      note={
        <>
          <b>Only the first group is really &ldquo;since&rdquo;.</b> FPL timestamps its team news, so
          those are events and can be new or not. The rest are standing conditions — a hard week or a
          triple-up is true until you change it, and dressing it as breaking news would be inventing
          urgency. {seen ? 'Marking as seen is stored in this browser only.' : 'Nothing has been marked seen yet, so every note below is new to this browser.'}
          {' '}There are no accounts here: a different phone starts again, which is the cost of not
          asking you to sign in for anything.
        </>
      }
    >
      {events.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold tracking-[0.11em] text-ink-3 uppercase">
              Team news · {fresh.length ? `${fresh.length} new` : 'nothing new'}
            </span>
            {fresh.length > 0 && (
              <button
                onClick={markSeen}
                className="rounded-lg border border-line-mid px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              >
                Mark as seen
              </button>
            )}
          </div>
          <div className="grid">
            {events.map((i) => <Row key={i.id} item={i} isNew={i.when != null && i.when > seen} />)}
          </div>
        </div>
      )}

      {standing.length > 0 && (
        <>
          <div className="mb-1.5 text-[10px] font-bold tracking-[0.11em] text-ink-3 uppercase">
            Standing conditions · {standing.length}
          </div>
          <div className="grid">
            {standing.map((i) => <Row key={i.id} item={i} isNew={false} />)}
          </div>
        </>
      )}

      {!events.length && (
        <p className="text-[13px] text-ink-2">Nobody in your fifteen is carrying a flag from FPL.</p>
      )}
    </Panel>
  )
}

function Row({ item, isNew }: { item: Item; isNew: boolean }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-line py-2.5 last:border-0">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[item.sev]}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-ink">{item.head}</span>
          {isNew && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/50 px-1.5 py-px text-[9.5px] font-bold tracking-[0.06em] text-accent uppercase">
              <Icon name="star" size={9} />New
            </span>
          )}
          <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase ${SEV[item.sev]}`}>
            {item.sev}
          </span>
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{item.sub}</span>
      </span>
    </div>
  )
}
