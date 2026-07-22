import { useMemo } from 'react'
import { PlayerPhoto } from './PlayerPhoto'
import { TeamBadge } from './badges'
import { Icon } from './Icon'
import { num } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { RatingRow } from '../lib/types'

// Squad DNA + suggested moves for the My Team squad. Both read straight from the
// rating engine — the dimension scores are standardised to a league mean of 50,
// so 50 is the natural baseline for the radar.

interface Axis { label: string; key: string; norm?: boolean; pos: string[] }
const AXES: Axis[] = [
  { label: 'Goal Threat', key: 'season_goal_score', pos: ['MID', 'FWD'] },
  { label: 'Creativity', key: 'season_creative_score', pos: ['MID', 'FWD'] },
  { label: 'Clean Sheets', key: 'season_cs_score', pos: ['GKP', 'DEF'] },
  { label: 'Def Con', key: 'season_dc_score', pos: ['DEF', 'MID', 'FWD'] },
  { label: 'Value', key: 'season_value_score_norm', norm: true, pos: ['GKP', 'DEF', 'MID', 'FWD'] },
  { label: 'Form', key: 'gw4_overall_score', norm: true, pos: ['GKP', 'DEF', 'MID', 'FWD'] },
]

function axisAvg(xi: RatingRow[], a: Axis): number | null {
  const vals = xi
    .filter((p) => a.pos.includes(String(p.position)))
    .map((p) => {
      const v = num(p, a.key)
      return v == null ? null : a.norm ? v * 20 : v
    })
    .filter((v): v is number => v != null)
  if (!vals.length) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

export function SquadDNA({ xi }: { xi: RatingRow[] }) {
  const vals = useMemo(() => AXES.map((a) => axisAvg(xi, a)), [xi])
  const cx = 150, cy = 150, R = 108
  const pt = (i: number, v: number) => {
    const ang = (-90 + i * 60) * (Math.PI / 180)
    const r = (R * v) / 100
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
  }
  const poly = (arr: number[]) => arr.map((v, i) => pt(i, v).join(',')).join(' ')
  const you = vals.map((v) => v ?? 0)

  const ranked = AXES.map((a, i) => ({ label: a.label, v: vals[i] })).filter((x) => x.v != null) as { label: string; v: number }[]
  const strengths = ranked.filter((x) => x.v >= 60).sort((a, b) => b.v - a.v).slice(0, 2)
  const watch = ranked.filter((x) => x.v < 46).sort((a, b) => a.v - b.v).slice(0, 2)

  return (
    <div className="rounded-2xl border border-line bg-surface-1/60 p-4 md:p-5">
      <div className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Squad DNA</div>
      <div className="flex flex-wrap items-center justify-center gap-5">
        <svg width="240" height="240" viewBox="0 0 300 300" className="shrink-0">
          {[1, 2, 3, 4].map((ring) => (
            <polygon key={ring} points={poly(AXES.map(() => ring * 25))} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          ))}
          {AXES.map((a, i) => {
            const [x, y] = pt(i, 100)
            const [lx, ly] = pt(i, 130)
            return (
              <g key={a.label}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.06)" />
                <text x={lx} y={ly} fill="var(--ink-2)" fontSize="9" fontWeight="600" textAnchor="middle" dominantBaseline="middle">{a.label}</text>
              </g>
            )
          })}
          <polygon points={poly(AXES.map(() => 50))} fill="rgba(108,101,90,0.14)" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="3 3" />
          <polygon points={poly(you)} fill="rgba(217,180,92,0.20)" stroke="var(--accent)" strokeWidth="2" />
          {you.map((v, i) => { const [x, y] = pt(i, v); return <circle key={i} cx={x} cy={y} r="3" fill="var(--accent)" /> })}
        </svg>
        <div className="min-w-[180px] flex-1">
          <div className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Strengths</div>
          {strengths.length ? strengths.map((s) => (
            <div key={s.label} className="mb-2 flex items-start gap-2">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-good" />
              <div className="text-sm text-ink"><b>{s.label}</b> · {Math.round(s.v)}</div>
            </div>
          )) : <div className="mb-2 text-sm text-ink-3">Balanced — no standout strength.</div>}
          <div className="mt-3 mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Watch</div>
          {watch.length ? watch.map((s) => (
            <div key={s.label} className="mb-2 flex items-start gap-2">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-bad" />
              <div className="text-sm text-ink"><b>{s.label}</b> · {Math.round(s.v)}</div>
            </div>
          )) : <div className="text-sm text-ink-3">No glaring weakness.</div>}
          <div className="mt-3 flex gap-4 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-3.5 rounded bg-accent" />Your XI</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-3.5 rounded bg-ink-3" />League avg</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniPlayer({ r, size = 34 }: { r: RatingRow; size?: number }) {
  return (
    <PlayerPhoto
      code={r.code}
      element={r.element}
      className="shrink-0 rounded-md object-cover object-top"
      style={{ width: size, height: Math.round(size * 1.27) }}
      placeholder={<div className="shrink-0 rounded-md bg-surface-3" style={{ width: size, height: Math.round(size * 1.27) }} />}
    />
  )
}

const ov100 = (r: RatingRow) => { const v = num(r, 'season_overall_score'); return v == null ? null : Math.round(v * 20) }
const capScore = (r: RatingRow) => { const v = num(r, 'gw4_overall_score') ?? num(r, 'season_overall_score'); return v == null ? 0 : Math.round(v * 20) }

export function SquadMoves({ xi, pool, owned, onPlayer }: { xi: RatingRow[]; pool: RatingRow[]; owned: Set<number>; onPlayer: (n: string) => void }) {
  // Best single upgrade: the weakest starter with a clearly better, affordable
  // same-position option that isn't already owned (within +£1.5m).
  const upgrade = useMemo(() => {
    const starters = [...xi].filter((p) => num(p, 'season_overall_score') != null).sort((a, b) => (num(a, 'season_overall_score') ?? 0) - (num(b, 'season_overall_score') ?? 0))
    for (const out of starters) {
      const budget = (num(out, 'price') ?? 0) + 1.5
      const cand = pool
        .filter((p) => p.position === out.position && !owned.has(Number(p.element)) && (num(p, 'price') ?? 99) <= budget && (num(p, 'season_overall_score') ?? 0) > (num(out, 'season_overall_score') ?? 0) + 0.4)
        .sort((a, b) => (num(b, 'season_overall_score') ?? 0) - (num(a, 'season_overall_score') ?? 0))[0]
      if (cand) return { out, in: cand }
    }
    return null
  }, [xi, pool, owned])

  const captains = useMemo(() => [...xi].sort((a, b) => capScore(b) - capScore(a)).slice(0, 3), [xi])

  return (
    <div className="grid gap-3">
      {upgrade && (
        <div className="rounded-2xl border border-line bg-surface-1/60 p-4 md:p-5">
          <div className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Suggested upgrade</div>
          <div className="flex items-center gap-3">
            <button onClick={() => onPlayer(String(upgrade.out.web_name))} className="flex flex-1 items-center gap-2.5 rounded-xl border border-bad/30 bg-bad/[0.07] p-2.5 text-left">
              <MiniPlayer r={upgrade.out} />
              <div className="min-w-0"><div className="text-[10px] font-bold tracking-wide text-bad uppercase">Out</div><div className="truncate text-sm font-semibold text-ink">{String(upgrade.out.web_name)}</div><div className="text-xs text-ink-3">£{upgrade.out.price}m · {ov100(upgrade.out)}</div></div>
            </button>
            <span className="text-accent"><Icon name="trend-up" size={18} /></span>
            <button onClick={() => onPlayer(String(upgrade.in.web_name))} className="flex flex-1 items-center gap-2.5 rounded-xl border border-good/30 bg-good/[0.06] p-2.5 text-left">
              <MiniPlayer r={upgrade.in} />
              <div className="min-w-0"><div className="text-[10px] font-bold tracking-wide text-good uppercase">In</div><div className="truncate text-sm font-semibold text-ink">{String(upgrade.in.web_name)}</div><div className="text-xs text-accent">£{upgrade.in.price}m · {ov100(upgrade.in)}</div></div>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-good/12 px-2.5 py-1 text-good">+{(ov100(upgrade.in)! - ov100(upgrade.out)!)} Overall</span>
            <span className="rounded-full bg-surface-3 px-2.5 py-1 text-ink-2">{(() => { const d = (num(upgrade.in, 'price') ?? 0) - (num(upgrade.out, 'price') ?? 0); return `${d >= 0 ? '−' : '+'}£${Math.abs(d).toFixed(1)}m` })()}</span>
            {num(upgrade.in, 'season_ppg') != null && num(upgrade.out, 'season_ppg') != null && (
              <span className="rounded-full bg-good/12 px-2.5 py-1 text-good">+{((num(upgrade.in, 'season_ppg') ?? 0) - (num(upgrade.out, 'season_ppg') ?? 0)).toFixed(1)} PPG</span>
            )}
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-line bg-surface-1/60 p-4 md:p-5">
        <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Captain this week</div>
        {captains.map((r, i) => (
          <button key={String(r.element)} onClick={() => onPlayer(String(r.web_name))} className="flex w-full items-center gap-3 border-b border-line py-2.5 text-left last:border-0 hover:bg-surface-2/50">
            <span className="w-4 font-num text-xs text-ink-3">{i + 1}</span>
            <MiniPlayer r={r} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">{String(r.web_name)}{i === 0 && <span className="text-accent"><Icon name="crown" size={13} /></span>}</div>
              <div className="flex items-center gap-1 text-xs text-ink-2">{r.position} · <TeamBadge team={String(r.team)} size={11} />{teamFullNames[String(r.team)] || r.team}</div>
            </div>
            <div className="text-right"><div className="font-display text-lg text-accent tabular-nums">{capScore(r)}</div><div className="text-[9px] tracking-wide text-ink-3 uppercase">Form×Fix</div></div>
          </button>
        ))}
      </div>
    </div>
  )
}
