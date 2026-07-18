export type IconName =
  | 'flame' | 'snow' | 'star' | 'target' | 'shield' | 'bolt' | 'hand' | 'ball'
  | 'coin' | 'calendar' | 'trend-up' | 'trend-down' | 'alert' | 'eye' | 'info'
  | 'check' | 'search' | 'users' | 'pitch' | 'trophy' | 'crown' | 'clock' | 'x'
  | 'sun' | 'moon'

interface IconProps {
  name: IconName
  size?: number
  className?: string
}

/** References the inline SVG sprite in index.html. */
export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} width={size} height={size} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}
