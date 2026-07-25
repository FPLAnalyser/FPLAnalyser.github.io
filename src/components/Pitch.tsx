import { type ReactNode } from 'react'

/* ════════════════════════════════════════════════════════════════════════
   The pitch: mown stripes, a soft top-down light, and real markings drawn
   as vector geometry (boxes, six-yard boxes, spots, both Ds, centre circle,
   corner arcs). Shared by Squad Builder and My Team, and crisp at any size
   in a shared PNG.
   ════════════════════════════════════════════════════════════════════════ */

export function Pitch({ children, className, maxWidth }: { children: ReactNode; className?: string; maxWidth?: number }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl px-3 py-4 md:px-4 md:py-5 ${className ?? ''}`}
      style={{
        maxWidth,
        margin: maxWidth ? '0 auto' : undefined,
        background: [
          'repeating-linear-gradient(180deg, rgba(255,255,255,.045) 0 7.14%, rgba(0,0,0,.05) 7.14% 14.28%)',
          'radial-gradient(120% 70% at 50% 0%, rgba(255,255,255,.10), transparent 62%)',
          'linear-gradient(180deg,#1b7a3a 0%,#15682f 45%,#125c29 100%)',
        ].join(','),
      }}
    >
      <svg
        viewBox="0 0 300 420"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <g fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.6">
          <rect x="6" y="6" width="288" height="408" rx="2" />
          <line x1="6" y1="210" x2="294" y2="210" />
          <circle cx="150" cy="210" r="46" />
          <rect x="60" y="6" width="180" height="62" />
          <rect x="112" y="6" width="76" height="26" />
          <path d="M108 68 A 46 46 0 0 0 192 68" />
          <rect x="60" y="352" width="180" height="62" />
          <rect x="112" y="388" width="76" height="26" />
          <path d="M108 352 A 46 46 0 0 1 192 352" />
          <path d="M6 16 A 10 10 0 0 0 16 6" />
          <path d="M284 6 A 10 10 0 0 0 294 16" />
          <path d="M6 404 A 10 10 0 0 1 16 414" />
          <path d="M294 404 A 10 10 0 0 0 284 414" />
        </g>
        <g fill="rgba(255,255,255,.5)">
          <circle cx="150" cy="210" r="2.4" />
          <circle cx="150" cy="46" r="2.4" />
          <circle cx="150" cy="374" r="2.4" />
        </g>
      </svg>
      <div className="relative">{children}</div>
    </div>
  )
}
