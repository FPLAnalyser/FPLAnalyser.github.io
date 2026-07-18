import { Icon } from './Icon'
import { ratingToNum } from '../lib/util'

/**
 * Star rating: accepts a 0–5 number or a pipeline string like "⭐⭐⭐½".
 * Grey track with a gold clipped fill, matching the legacy renderStars().
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
  const n = ratingToNum(value)
  if (n == null) return <span className="text-sm text-ink-3">N/A</span>

  const row = (color: string) => (
    <span className="flex" style={{ color }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Icon key={i} name="star" size={size} />
      ))}
    </span>
  )

  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={`${n} out of 5 stars`}>
      <span className="relative inline-block">
        <span style={{ color: 'var(--surface-3)' }}>
          <span className="flex">
            {Array.from({ length: 5 }, (_, i) => (
              <Icon key={i} name="star" size={size} />
            ))}
          </span>
        </span>
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${(n / 5) * 100}%` }}
        >
          {row('var(--star-c)')}
        </span>
      </span>
      {showNum && <span className="font-num text-xs tabular-nums text-ink-2">{n.toFixed(1)}</span>}
    </span>
  )
}
