import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageShell, EmptyState } from '../components/PageShell'
import { PageSkeleton } from '../components/Skeleton'
import { SearchBox } from '../components/SearchBox'
import { PosBadge, TeamCell } from '../components/cells'
import { Icon } from '../components/Icon'
import { useCore } from '../lib/useData'
import { num } from '../lib/rows'
import { norm } from '../lib/util'
import type { RatingRow } from '../lib/types'

const A_COLOR = '#ead188'
const B_COLOR = '#7fb0ff'

interface Metric { label: string; key: string; norm?: boolean }
const METRICS: Metric[] = [
  { label: 'Goal Threat', key: 'season_goal_score' },
  { label: 'Creativity', key: 'season_creative_score' },
  { label: 'Clean Sheet', key: 'season_cs_score' },
  { label: 'Def Con', key: 'season_dc_score' },
  { label: 'Value', key: 'season_value_score_norm', norm: true },
  { label: 'Form', key: 'gw4_overall_score', norm: true },
]

function val100(r: RatingRow | undefined, m: { key: string; norm?: boolean }): number | null {
  if (!r) return null
  const v = num(r, m.key)
  if (v == null) return null
  return Math.round(m.norm ? v * 20 : v)
}
const overall100 = (r?: RatingRow) => val100(r, { key: 'season_overall_score', norm: true })

function Picker({ ratings, color, label, selected, onPick }: { ratings: RatingRow[]; color: string; label: string; selected?: RatingRow; onPick: (code: string) => void }) {
  return (
    <div className="flex-1">
      <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] uppercase" style={{ color }}>{label}</div>
      <SearchBox
        items={ratings}
        getLabel={(r) => String(r.web_name)}
        onSelect={(r) => onPick(String(num(r, 'code') ?? r.web_name))}
        placeholder="Search a player…"
        initialValue={selected ? String(selected.web_name) : ''}
        renderItem={(r) => (
          <span className="flex items-center gap-2">
            <PosBadge pos={String(r.position)} />
            <span className="text-ink">{String(r.web_name)}</span>
            <span className="text-ink-3">£{r.price}m</span>
          </span>
        )}
      />
      {selected && (
        <div className="mt-3 flex items-center gap-3">
          <span className="font-display text-[34px] leading-none tabular-nums" style={{ color }}>{overall100(selected) ?? '—'}</span>
          <div className="min-w-0">
            <div className="truncate font-display text-lg text-ink uppercase">{String(selected.web_name)}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
              <PosBadge pos={String(selected.position)} /> · <TeamCell team={String(selected.team)} /> · £{selected.price}m
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DivergingRow({ label, a, b }: { label: string; a: number | null; b: number | null }) {
  const aw = a != null && (b == null || a >= b)
  const bw = b != null && (a == null || b >= a)
  return (
    <div className="grid grid-cols-[40px_1fr_112px_1fr_40px] items-center gap-2">
      <div className="text-right font-display text-base tabular-nums" style={{ color: aw ? A_COLOR : 'var(--ink-3)' }}>{a ?? '—'}</div>
      <div className="flex h-[7px] justify-end overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full" style={{ width: `${a ?? 0}%`, background: `linear-gradient(90deg, ${A_COLOR}66, ${A_COLOR})` }} />
      </div>
      <div className="text-center text-[10px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{label}</div>
      <div className="flex h-[7px] overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full" style={{ width: `${b ?? 0}%`, background: `linear-gradient(90deg, ${B_COLOR}, ${B_COLOR}66)` }} />
      </div>
      <div className="font-display text-base tabular-nums" style={{ color: bw ? B_COLOR : 'var(--ink-3)' }}>{b ?? '—'}</div>
    </div>
  )
}

export default function Compare() {
  const { data, error: coreError } = useCore()
  const [params, setParams] = useSearchParams()
  const ratings = useMemo(() => (data?.ratings ?? []).filter((r) => num(r, 'season_overall_score') != null) as RatingRow[], [data])

  // Resolve by permanent code (unique); fall back to name for older links.
  const find = (key: string | null) =>
    key ? ratings.find((r) => String(num(r, 'code')) === key) ?? ratings.find((r) => norm(r.web_name) === norm(key)) : undefined
  const a = find(params.get('a'))
  const b = find(params.get('b'))
  const setSide = (side: 'a' | 'b', key: string) => {
    const next = new URLSearchParams(params)
    next.set(side, key)
    setParams(next, { replace: true })
  }

  if (!data) {
    return (
      <PageShell>
        <PageHeader title="Compare" subtitle="Put any two players head-to-head" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title="Compare" subtitle="Put any two players head-to-head — every rating faces off, brighter side wins" />
      <div className="rounded-2xl border border-line bg-surface-1/50 p-5 md:p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <Picker ratings={ratings} color={A_COLOR} label="Player A" selected={a} onPick={(n) => setSide('a', n)} />
          <div className="hidden self-center pt-6 text-xs font-bold tracking-[0.2em] text-ink-3 sm:block">VS</div>
          <Picker ratings={ratings} color={B_COLOR} label="Player B" selected={b} onPick={(n) => setSide('b', n)} />
        </div>

        {a && b ? (
          <div className="mt-8 flex flex-col gap-3">
            <DivergingRow label="Overall" a={overall100(a)} b={overall100(b)} />
            <div className="my-1 h-px bg-line" />
            {METRICS.map((m) => (
              <DivergingRow key={m.label} label={m.label} a={val100(a, m)} b={val100(b, m)} />
            ))}
          </div>
        ) : (
          <div className="mt-6">
            <EmptyState icon={<Icon name="users" size={40} />}>Pick two players above to see them go head-to-head.</EmptyState>
          </div>
        )}
      </div>
    </PageShell>
  )
}
