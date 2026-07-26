import { type ReactNode } from 'react'
import { PlayerPhoto } from './PlayerPhoto'

/* ════════════════════════════════════════════════════════════════════════
   The pitch: mown stripes, a soft top-down light, and real markings drawn
   as vector geometry (boxes, six-yard boxes, spots, both Ds, centre circle,
   corner arcs). Shared by Squad Builder and My Team, and crisp at any size
   in a shared PNG.
   ════════════════════════════════════════════════════════════════════════ */

export function Pitch({ children, footer, className, maxWidth }: { children: ReactNode; footer?: ReactNode; className?: string; maxWidth?: number }) {
  return (
    <div
      data-pitch=""
      // A pitch has a shape: a portrait aspect keeps the centre circle round
      // and the boxes in proportion. But the ratio is a FLOOR, not a fixed
      // height — a phone-width pitch holds taller rows than 68:92 allows, and
      // a fixed `aspect-ratio` plus `overflow-hidden` silently ate the
      // forwards. One grid cell, two children stacked in it: a spacer that
      // enforces the ratio and the content that can outgrow it.
      className={`relative grid overflow-hidden rounded-2xl px-2 py-3 sm:px-3 sm:py-4 md:px-4 md:py-5 ${className ?? ''}`}
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
      {/* ratio floor — zero content, height = width × 92/68 */}
      <div aria-hidden="true" className="col-start-1 row-start-1 w-full" style={{ paddingTop: 'calc(92 / 68 * 100%)' }} />
      <div className="relative col-start-1 row-start-1 flex flex-col">
        <div className="flex flex-1 flex-col justify-around gap-2">{children}</div>
        {footer && (
          // The bench: a band across the foot of the pitch, the way it sits on
          // a teamsheet — still inside the frame, clearly not on the field.
          <div className="mt-2 rounded-xl border border-white/12 bg-black/35 px-2 py-2 backdrop-blur-[1px] sm:px-3">
            <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em] text-white/55 uppercase">Bench</div>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Sizing for a pitch slot — card or empty alike, so rows line up.
 *
 *  Cards share the row's width rather than claiming a fixed one: five across a
 *  320px phone simply cannot be 84px each, and a fixed width there wraps the
 *  row and pushes the forwards out of the frame. `flex-1 basis-0` divides what
 *  there is; `max-w` stops them ballooning on a desktop. */
export const CARD_W = 'min-w-0 flex-1 basis-0 max-w-[84px]'

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
      // Width comes from the row (see CARD_W on the wrapper) — the card just
      // fills whatever slot it's given.
      className="w-full rounded-lg border border-accent/40 p-1 text-center transition-transform hover:-translate-y-0.5 sm:p-1.5"
      style={{ background: 'linear-gradient(165deg,rgba(33,29,22,.96),rgba(13,11,8,.96))' }}
    >
      <div className="metallic-num font-num text-[13px] leading-none font-extrabold tabular-nums sm:text-[15px]">{rating ?? '—'}</div>
      <PlayerPhoto
        code={code} element={element}
        className="mx-auto my-1 w-7 rounded object-cover object-top sm:w-8"
        style={{ height: 32 }}
        placeholder={<span className="mx-auto my-1 block w-7 rounded bg-white/5 sm:w-8" style={{ height: 32 }} />}
      />
      <div className="truncate text-[9.5px] leading-tight font-bold text-white sm:text-[10.5px]">{name}</div>
      <div className="truncate text-[8px] text-white/55 sm:text-[9px]">{team}{price != null ? ` · £${price}m` : ''}</div>
      {fixtures && <div className="mt-1 flex justify-center gap-[2px]">{fixtures}</div>}
      {footer}
    </button>
  )
}
