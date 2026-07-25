import { type ReactNode } from 'react'
import { PlayerPhoto } from './PlayerPhoto'

/* ════════════════════════════════════════════════════════════════════════
   The pitch: mown stripes, a soft top-down light, and real markings drawn
   as vector geometry (boxes, six-yard boxes, spots, both Ds, centre circle,
   corner arcs). Shared by Squad Builder and My Team, and crisp at any size
   in a shared PNG.
   ════════════════════════════════════════════════════════════════════════ */

export function Pitch({ children, className, maxWidth }: { children: ReactNode; className?: string; maxWidth?: number }) {
  return (
    <div
      // A pitch has a shape: hold a portrait aspect so the centre circle stays
      // a circle and the boxes keep their proportions. Content sets the
      // minimum height; the ratio takes over once there's room.
      className={`relative flex flex-col justify-around overflow-hidden rounded-2xl px-3 py-4 md:px-4 md:py-5 ${className ?? ''}`}
      style={{
        maxWidth,
        margin: maxWidth ? '0 auto' : undefined,
        aspectRatio: '68 / 92',
        background: [
          'repeating-linear-gradient(180deg, rgba(255,255,255,.045) 0 7.14%, rgba(0,0,0,.05) 7.14% 14.28%)',
          'radial-gradient(120% 70% at 50% 0%, rgba(255,255,255,.10), transparent 62%)',
          'linear-gradient(180deg,#1b7a3a 0%,#15682f 45%,#125c29 100%)',
        ].join(','),
      }}
    >
      <svg
        viewBox="0 0 300 406"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <g fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.6">
          <rect x="6" y="6" width="288" height="394" rx="2" />
          <line x1="6" y1="203" x2="294" y2="203" />
          <ellipse cx="150" cy="203" rx="46" ry="46" />
          <rect x="60" y="6" width="180" height="62" />
          <rect x="112" y="6" width="76" height="26" />
          <path d="M108 68 A 46 46 0 0 0 192 68" />
          <rect x="60" y="338" width="180" height="62" />
          <rect x="112" y="374" width="76" height="26" />
          <path d="M108 338 A 46 46 0 0 1 192 338" />
          <path d="M6 16 A 10 10 0 0 0 16 6" />
          <path d="M284 6 A 10 10 0 0 0 294 16" />
          <path d="M6 390 A 10 10 0 0 1 16 400" />
          <path d="M294 390 A 10 10 0 0 0 284 400" />
        </g>
        <g fill="rgba(255,255,255,.5)">
          <circle cx="150" cy="203" r="2.4" />
          <circle cx="150" cy="46" r="2.4" />
          <circle cx="150" cy="360" r="2.4" />
        </g>
      </svg>
      <div className="relative flex flex-1 flex-col justify-around gap-2">{children}</div>
    </div>
  )
}

/** Compact pitch card — rating, photo, name, price and the next four
 * fixtures. Sized so a full XI fits the pitch without scrolling. */
export function PitchCard({ rating, name, team, price, code, element, fixtures, onClick, footer }: {
  rating: number | null
  name: string
  team: string
  price: number | null
  code: number | null
  element: number | null
  fixtures?: ReactNode
  onClick?: () => void
  footer?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="w-[74px] rounded-lg border border-accent/40 p-1.5 text-center transition-transform hover:-translate-y-0.5 sm:w-[84px]"
      style={{ background: 'linear-gradient(165deg,rgba(33,29,22,.96),rgba(13,11,8,.96))' }}
    >
      <div className="metallic-num font-num text-[15px] leading-none font-extrabold tabular-nums">{rating ?? '—'}</div>
      <PlayerPhoto
        code={code} element={element}
        className="mx-auto my-1 w-8 rounded object-cover object-top" style={{ height: 38 }}
        placeholder={<span className="mx-auto my-1 block w-8 rounded bg-white/5" style={{ height: 38 }} />}
      />
      <div className="truncate text-[10.5px] font-bold text-white">{name}</div>
      <div className="truncate text-[9px] text-white/55">{team}{price != null ? ` · £${price}m` : ''}</div>
      {fixtures && <div className="mt-1 flex justify-center gap-[2px]">{fixtures}</div>}
      {footer}
    </button>
  )
}
