export type IconName =
  | 'flame' | 'snow' | 'star' | 'target' | 'shield' | 'bolt' | 'hand' | 'ball'
  | 'coin' | 'calendar' | 'trend-up' | 'trend-down' | 'alert' | 'eye' | 'info'
  | 'check' | 'search' | 'users' | 'pitch' | 'trophy' | 'crown' | 'clock' | 'x'
  | 'sun' | 'moon'

interface IconProps {
  name: IconName
  size?: number
  className?: string
  /** Render as a filled glyph (fill: currentColor) rather than an outline. */
  solid?: boolean
}

/** References the inline SVG sprite in index.html. */
export function Icon({ name, size = 16, className, solid }: IconProps) {
  const cls = ['icon', solid ? 'icon-solid' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <svg className={cls} width={size} height={size} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}
