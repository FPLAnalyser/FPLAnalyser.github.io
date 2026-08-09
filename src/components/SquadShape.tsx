import { Fragment, useMemo } from 'react'
import { Icon } from './Icon'
import { TeamBadge } from './badges'
import { bandOf } from '../lib/fixtureRuns'
import { num } from '../lib/rows'
import { sharesOf, herfindahl, type PlayerSeries, type Share } from '../lib/squadInsights'

/* ════════════════════════════════════════════════════════════════════════
   WHERE THE POINTS COME FROM.

   Four readings of the same projection, each answering a question the squad
   total cannot: who is carrying it, where the goals are, how much of the
   defence rides on one back line, and how exposed a single result leaves you.

   All four are concentration questions, and concentration is not a fault —
   a squad built around two premiums is a legitimate strategy. What the
   panels do is make the shape visible so it is a choice rather than an
   accident.
   ════════════════════════════════════════════════════════════════════════ */

const pct = (v: number) => `${Math.round(v * 100)}%`

export function Panel({ title, kicker, children, note }: {
  title: string
  kicker?: string
  children: React.ReactNode
  note?: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface-1/60 p-4 md:p-5">
      <div className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">{title}</div>
      {kicker && <p className="mb-3 max-w-[62ch] text-[13px] leading-snug text-ink-2">{kicker}</p>}
      {children}
      {note && <p className="mt-3 max-w-[70ch] text-[11.5px] leading-snug text-ink-3">{note}</p>}
    </section>
  )
}

/** A horizontal stacked bar of shares, with the long tail folded into "rest". */
function ShareBar({ shares, keep = 6 }: { shares: Share[]; keep?: number }) {
  const head = shares.slice(0, keep)
  const restShare = shares.slice(keep).reduce((s, x) => s + x.share, 0)
  /* One hue, stepping down in weight. The first version cycled accent, blue,
     green and red, and the green and red segments read as "good club" and
     "bad club" — a judgement the bar is not making. Nothing here is better or
     worse than anything else; it is a share of a whole. */
  const colours = [
    'color-mix(in oklab, var(--accent) 100%, transparent)',
    'color-mix(in oklab, var(--accent) 78%, var(--surface-3))',
    'color-mix(in oklab, var(--accent) 58%, var(--surface-3))',
    'color-mix(in oklab, var(--accent) 42%, var(--surface-3))',
    'color-mix(in oklab, var(--accent) 30%, var(--surface-3))',
    'color-mix(in oklab, var(--accent) 20%, var(--surface-3))',
  ]
  return (
    <div className="flex h-7 w-full overflow-hidden rounded-lg border border-line">
      {head.map((s, i) => (
        <div
          key={s.key}
          title={`${s.label} — ${pct(s.share)}`}
          className="flex items-center justify-center overflow-hidden text-[10px] font-bold whitespace-nowrap"
          style={{
            width: `${s.share * 100}%`,
            background: colours[i % colours.length],
            color: i < 2 ? 'var(--accent-contrast)' : 'var(--ink-1)',
          }}
        >
          {s.share > 0.09 ? pct(s.share) : ''}
        </div>
      ))}
      {restShare > 0.001 && (
        <div
          title={`Everyone else — ${pct(restShare)}`}
          className="flex items-center justify-center bg-surface-3 text-[10px] font-bold text-ink-3"
          style={{ width: `${restShare * 100}%` }}
        >
          {restShare > 0.09 ? pct(restShare) : ''}
        </div>
      )}
    </div>
  )
}

// ── who is carrying the squad ───────────────────────────────────────────────

export function Contribution({ squad, gws }: { squad: PlayerSeries[]; gws: number[] }) {
  const shares = useMemo(() => sharesOf(squad.map((p) => ({
    key: String(p.element), label: String(p.row.web_name), value: p.total,
  }))), [squad])
  const h = herfindahl(shares)
  const top3 = shares.slice(0, 3).reduce((s, x) => s + x.share, 0)
  const max = Math.max(...shares.map((s) => s.value), 1e-6)

  return (
    <Panel
      title="Who is carrying this squad"
      kicker={`Each player's share of the fifteen's projected points over GW${gws[0]}–${gws[gws.length - 1]}. The bar behind each name is his share; the strip under the fixtures is where in the run he earns it.`}
      note={
        <>
          Your top three are <b>{pct(top3)}</b> of the projection. That is not a verdict — a squad
          built on two premiums is a strategy — but it is the number that decides how much a single
          injury costs you. The concentration index is {h.toFixed(2)}, where 0.07 is fifteen equal
          players and 1.00 is one man.
        </>
      }
    >
      <div className="grid gap-1">
        {squad
          .slice()
          .sort((a, b) => b.total - a.total)
          .map((p) => {
            const share = shares.find((s) => s.key === String(p.element))?.share ?? 0
            // Each week against HIS OWN average, not his best week. Scaled to
            // his max, a player whose six weeks run 4.0 to 4.4 comes out solid
            // green across the row and says nothing; ±30% of his mean is a
            // range in which a fantasy week genuinely differs.
            const wkMean = p.total / Math.max(p.weeks.length, 1)
            const rel = (v: number) => (wkMean > 0 ? (v - wkMean) / (0.3 * wkMean) : 0)
            return (
              <div key={p.element} className="flex items-center gap-2">
                <div className="relative w-[150px] shrink-0 overflow-hidden rounded-md sm:w-[190px]">
                  <div
                    className="absolute inset-y-0 left-0 bg-accent-soft"
                    style={{ width: `${(p.total / max) * 100}%` }}
                  />
                  <div className="relative flex items-baseline gap-1.5 px-2 py-1">
                    <span className="truncate text-[12.5px] font-semibold text-ink">{String(p.row.web_name)}</span>
                    <span className="font-num ml-auto text-[11px] text-ink-3 tabular-nums">{pct(share)}</span>
                  </div>
                </div>
                <div className="flex flex-1 gap-0.5">
                  {p.weeks.map((w) => (
                    <div
                      key={w.gw}
                      title={`GW${w.gw} — ${w.xp.toFixed(1)} xP`}
                      className="h-5 flex-1 rounded-[3px]"
                      style={{ background: bandOf(Math.max(-1, Math.min(1, rel(w.xp)))) }}
                    />
                  ))}
                </div>
                <span className="font-num w-10 shrink-0 text-right text-[12.5px] font-semibold text-accent-2 tabular-nums">
                  {p.total.toFixed(1)}
                </span>
              </div>
            )
          })}
      </div>
    </Panel>
  )
}

// ── where the goals are ─────────────────────────────────────────────────────

export function GoalSources({ squad }: { squad: PlayerSeries[] }) {
  const rows = useMemo(() => squad
    .filter((p) => p.pos !== 'GKP' && p.modelled)
    .map((p) => {
      const g = p.weeks.reduce((s, w) => s + (w.parts?.lamGoal ?? 0), 0)
      const a = p.weeks.reduce((s, w) => s + (w.parts?.lamAssist ?? 0), 0)
      return { p, g, a, gi: g + a }
    })
    .filter((x) => x.gi > 0.001)
    .sort((a, b) => b.gi - a.gi), [squad])

  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => r.gi))
  const totG = rows.reduce((s, r) => s + r.g, 0)
  const totA = rows.reduce((s, r) => s + r.a, 0)
  const byPos = ['DEF', 'MID', 'FWD'].map((pos) => ({
    pos, v: rows.filter((r) => r.p.pos === pos).reduce((s, r) => s + r.gi, 0),
  }))
  const totGi = totG + totA

  return (
    <Panel
      title="Where the goals are projected to come from"
      kicker="Expected goals and expected assists over the horizon, split. Two squads with the same attacking projection can be built completely differently, and the split is what tells them apart."
      note={
        <>
          {(totGi).toFixed(1)} projected goal involvements — {(totG).toFixed(1)} goals,{' '}
          {(totA).toFixed(1)} assists. {byPos.map((b, i) => (
            <Fragment key={b.pos}>
              {i > 0 && ', '}{b.pos} {pct(totGi > 0 ? b.v / totGi : 0)}
            </Fragment>
          ))} by position. A squad whose threat is nearly all forwards has nowhere to hide when one
          blanks; one spread across midfield usually costs more per point.
        </>
      }
    >
      <div className="grid gap-1.5">
        {rows.map(({ p, g, a, gi }) => (
          <div key={p.element} className="flex items-center gap-2">
            <span className="w-[110px] shrink-0 truncate text-[12.5px] font-semibold text-ink sm:w-[150px]">
              {String(p.row.web_name)}
              <span className="ml-1 text-[10.5px] font-medium text-ink-3">{p.pos}</span>
            </span>
            <div className="flex h-5 flex-1 overflow-hidden rounded-md bg-surface-2">
              <div style={{ width: `${(g / max) * 100}%`, background: 'var(--accent)' }} title={`${g.toFixed(2)} xG`} />
              <div style={{ width: `${(a / max) * 100}%`, background: 'var(--info)' }} title={`${a.toFixed(2)} xA`} />
            </div>
            <span className="font-num w-10 shrink-0 text-right text-[12px] text-ink-2 tabular-nums">{gi.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-[2px]" style={{ background: 'var(--accent)' }} />xG</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-[2px]" style={{ background: 'var(--info)' }} />xA</span>
      </div>
    </Panel>
  )
}

// ── how concentrated the defence is ─────────────────────────────────────────

export function DefenceConcentration({ squad }: { squad: PlayerSeries[] }) {
  const backs = useMemo(() => squad.filter((p) => p.pos === 'GKP' || p.pos === 'DEF'), [squad])
  const byClub = useMemo(() => {
    const m = new Map<string, { club: string; n: number; cs: number; pts: number }>()
    for (const p of backs) {
      const e = m.get(p.team) ?? { club: p.team, n: 0, cs: 0, pts: 0 }
      e.n += 1
      e.pts += p.total
      // The club's clean-sheet chance is the same for all of them, so take it
      // once rather than averaging identical numbers.
      e.cs = p.weeks.reduce((s, w) => s + (w.parts ? Math.exp(-w.parts.lamAgainst) : 0), 0) / Math.max(p.weeks.length, 1)
      m.set(p.team, e)
    }
    return [...m.values()].sort((a, b) => b.n - a.n || b.pts - a.pts)
  }, [backs])

  if (!backs.length) return null
  const shares = sharesOf(byClub.map((c) => ({ key: c.club, label: c.club, value: c.pts })))
  const doubled = byClub.filter((c) => c.n >= 2)

  return (
    <Panel
      title="How concentrated the defence is"
      kicker="Your keepers and defenders grouped by club. Clean sheets are a club event, so two players from the same back line are not two chances at one — they are one chance, paid twice."
      note={
        doubled.length
          ? <>You are doubled up at {doubled.map((c) => `${c.club} (${c.n})`).join(', ')}. That is the
              position with the widest spread of outcomes in the squad: the good weeks are twice as
              good and the bad ones twice as bad, and no amount of projection changes that.</>
          : <>No club supplies more than one of your back line, so a single leaky afternoon costs you
              one player rather than three. It also means you never get the double payout.</>
      }
    >
      <ShareBar shares={shares} />
      <div className="mt-3 grid gap-1.5">
        {byClub.map((c) => (
          <div key={c.club} className="flex items-center gap-2 text-[12.5px]">
            <TeamBadge team={c.club} size={16} />
            <span className="w-12 shrink-0 font-semibold text-ink">{c.club}</span>
            <span className="text-ink-3">{c.n} player{c.n === 1 ? '' : 's'}</span>
            <span className="ml-auto flex items-center gap-3">
              <span className="font-num text-ink-2 tabular-nums" title="Average clean-sheet chance per week">
                {pct(c.cs)} CS
              </span>
              <span className="font-num w-11 text-right font-semibold text-accent-2 tabular-nums">{c.pts.toFixed(1)}</span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── how much rides on one result ────────────────────────────────────────────

export function ClubRisk({ squad, gws }: { squad: PlayerSeries[]; gws: number[] }) {
  /* One fixture can carry several of your players — and if two of them are on
     OPPOSITE sides of the same match, the squad is hedged whatever happens.
     Both facts are invisible on a pitch and obvious here. */
  const perFixture = useMemo(() => {
    const out: { gw: number; key: string; label: string; xp: number; players: PlayerSeries[]; both: boolean }[] = []
    gws.forEach((gw, i) => {
      const m = new Map<string, { label: string; xp: number; players: PlayerSeries[]; sides: Set<string> }>()
      for (const p of squad) {
        const w = p.weeks[i]
        if (!w?.parts) continue
        for (const o of w.opponents) {
          // A fixture is one object however you arrive at it, so key on the
          // sorted pair — that is what makes two owners on opposite sides
          // collapse into one row.
          const pair = [p.team, o.opponent].sort()
          const key = `${gw}:${pair[0]}-${pair[1]}`
          const e = m.get(key) ?? { label: `${pair[0]} v ${pair[1]}`, xp: 0, players: [], sides: new Set<string>() }
          e.xp += w.xp / w.opponents.length
          e.players.push(p)
          e.sides.add(p.team)
          m.set(key, e)
        }
      }
      for (const [key, e] of m) {
        if (e.players.length < 2) continue
        out.push({ gw, key, label: e.label, xp: e.xp, players: e.players, both: e.sides.size > 1 })
      }
    })
    return out.sort((a, b) => b.xp - a.xp).slice(0, 8)
  }, [squad, gws])

  const weekTotals = gws.map((_, i) => squad.reduce((s, p) => s + (p.weeks[i]?.xp ?? 0), 0))

  if (!perFixture.length) {
    return (
      <Panel title="How much rides on one result" kicker="No single fixture carries two or more of your players over this horizon — the squad is spread across matches.">
        <div className="text-[13px] text-ink-2">Nothing concentrated enough to draw.</div>
      </Panel>
    )
  }

  return (
    <Panel
      title="How much rides on one result"
      kicker="Fixtures where two or more of your players are involved, biggest first. This is the exposure a pitch cannot show you — the eleven looks spread out, the results it depends on are not."
      note={
        <>
          A <span className="text-accent">hedged</span> row has your players on both sides: whatever
          happens, some of it lands. Everything else is a single result carrying that much of your
          week — {pct(perFixture[0].xp / Math.max(weekTotals[gws.indexOf(perFixture[0].gw)], 1e-6))} of it
          in the biggest case.
        </>
      }
    >
      <div className="grid gap-1.5">
        {perFixture.map((f) => {
          const share = f.xp / Math.max(weekTotals[gws.indexOf(f.gw)], 1e-6)
          return (
            <div key={f.key} className="flex items-center gap-2">
              <span className="font-num w-11 shrink-0 text-[11px] text-ink-3 tabular-nums">GW{f.gw}</span>
              <span className="w-[104px] shrink-0 text-[12.5px] font-semibold text-ink">{f.label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-md bg-surface-2">
                <div className="h-full rounded-md" style={{ width: `${Math.min(100, share * 100)}%`, background: f.both ? 'var(--info)' : 'var(--accent)' }} />
              </div>
              <span className="font-num w-11 shrink-0 text-right text-[12px] text-ink-2 tabular-nums">{pct(share)}</span>
              <span className="w-14 shrink-0 text-right text-[10.5px] font-bold tracking-wide uppercase">
                {f.both ? <span className="text-info">hedged</span> : <span className="text-ink-3">{f.players.length} on</span>}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        {perFixture.slice(0, 3).map((f) => (
          <span key={f.key} className="flex items-center gap-1">
            <Icon name="users" size={11} />
            GW{f.gw} {f.label}: {f.players.map((p) => String(p.row.web_name)).join(', ')}
          </span>
        ))}
      </div>
    </Panel>
  )
}

// ── minutes risk ────────────────────────────────────────────────────────────

export function MinutesRisk({ squad }: { squad: PlayerSeries[] }) {
  const rows = useMemo(() => squad
    .filter((p) => p.modelled)
    .map((p) => {
      const p60 = p.weeks.find((w) => w.parts)?.parts?.p60 ?? 0
      const m90 = num(p.row, 'season_m_mins90_rate') ?? 0.5
      return { p, p60, m90, risk: (1 - p60) * p.total }
    })
    .sort((a, b) => a.p60 - b.p60), [squad])

  if (!rows.length) return null
  const exposed = rows.filter((r) => r.p60 < 0.75)

  return (
    <Panel
      title="Minutes risk"
      kicker="The chance each player reaches 60 minutes, lowest first. Every other projection on this page is multiplied by this number, so it is the assumption the whole squad rests on."
      note={
        exposed.length
          ? <>{exposed.length} player{exposed.length === 1 ? '' : 's'} below a 75% chance of the hour.
              That is where the projection is least trustworthy — not because the rate is wrong, but
              because a rotation call is a decision by one manager on one morning, and no model reads
              those.</>
          : <>Nobody in the fifteen is below a 75% chance of the hour, so the projections here are
              resting on about as solid a minutes assumption as this game offers.</>
      }
    >
      <div className="grid gap-1.5">
        {rows.map(({ p, p60, m90 }) => (
          <div key={p.element} className="flex items-center gap-2">
            <span className="w-[110px] shrink-0 truncate text-[12.5px] font-semibold text-ink sm:w-[150px]">
              {String(p.row.web_name)}
              <span className="ml-1 text-[10.5px] font-medium text-ink-3">{p.pos}</span>
            </span>
            {/* Colour runs over the range minutes actually vary in. Mapped from
                zero, everyone above 50% is solid green and the panel loses the
                only distinction it exists to draw. */}
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface-2">
              <div
                className="h-full"
                style={{ width: `${p60 * 100}%`, background: bandOf(Math.max(-1, Math.min(1, (p60 - 0.8) / 0.15))) }}
              />
            </div>
            <span className="font-num w-10 shrink-0 text-right text-[12px] font-semibold text-ink tabular-nums">{pct(p60)}</span>
            <span className="font-num w-14 shrink-0 text-right text-[11px] text-ink-3 tabular-nums" title="Share of his appearances that went the full 90">
              {pct(m90)} of 90
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
