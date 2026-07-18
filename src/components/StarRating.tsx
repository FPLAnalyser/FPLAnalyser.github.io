import { ratingToNum } from '../lib/util'

/** Convert a 0–5 rating (number or pipeline star string) to a 0–100 score. */
export function ratingTo100(value: number | string | null | undefined): number | null {
  const n = ratingToNum(value)
  return n == null ? null : Math.round(n * 20)
}

type Tier = 'elite' | 'strong' | 'fair' | 'weak'
function tierOf(r: number): Tier {
  if (r >= 80) return 'elite'
  if (r >= 65) return 'strong'
  if (r >= 50) return 'fair'
  return 'weak'
}
const TIER_CLASS: Record<Tier, string> = {
  elite: 'text-accent bg-accent-soft',
  strong: 'text-good bg-good/10',
  fair: 'text-ink-2 bg-surface-3',
  weak: 'text-bad bg-bad/10', // anything under 50 flags red
}

/**
 * Numeric 0–100 rating badge (replaces the old star display). Keeps the legacy
 * prop shape (value / size / showNum) so every existing call site works: `size`
 * ≤ 10 renders the compact variant used in dense tables and pitch cards.
 */
export function StarRating({
  value,
  size = 13,
  showNum = true,
}: {
  value: number | string | null | undefined
  size?: number
  showNum?: boolean
}) {
  const r = ratingTo100(value)
  const compact = size <= 10 || !showNum
  if (r == null) {
    return <span className={`text-ink-3 ${compact ? 'text-[11px]' : 'text-xs'}`}>—</span>
  }
  const tier = tierOf(r)
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-num font-semibold tabular-nums ${TIER_CLASS[tier]} ${
        compact ? 'min-w-6 px-1 py-0.5 text-[11px]' : 'min-w-8 px-1.5 py-0.5 text-xs'
      }`}
      role="img"
      aria-label={`Rating ${r} out of 100`}
    >
      {r}
    </span>
  )
}

/** Larger standalone rating for hero/feature contexts. */
export function RatingBadge({ value, className }: { value: number | string | null | undefined; className?: string }) {
  const r = ratingTo100(value)
  if (r == null) return <span className="text-ink-3">—</span>
  const tier = tierOf(r)
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-lg px-2.5 py-1 font-num font-bold tabular-nums ${TIER_CLASS[tier]} ${className ?? ''}`}>
      <span className="text-2xl">{r}</span>
      <span className="text-[10px] font-semibold opacity-60">/100</span>
    </span>
  )
}
