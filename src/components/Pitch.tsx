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

/** Initials for the monogram behind a headshot: "B.Fernandes" → BF,
 *  "Calvert-Lewin" → CL, "Raya" → RA. */
export function initialsOf(name: string): string {
  const parts = String(name).split(/[\s.\-']+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return String(name).slice(0, 2).toUpperCase()
}

/** Sizing for a pitch slot — card or empty alike, so rows line up.
 *
 *  Cards share the row's width rather than claiming a fixed one: five across a
 *  320px phone simply cannot be 84px each, and a fixed width there wraps the
 *  row and pushes the forwards out of the frame. `flex-1 basis-0` divides what
 *  there is; `max-w` stops them ballooning on a desktop. */
export const CARD_W = 'min-w-0 flex-1 basis-0 max-w-[84px]'

/** Rating tiers. The band a player falls in is what the card's material says,
 *  so a shelf of them sorts itself before you read a single name. `ice` is not
 *  a rating band — it marks Team of the Week, which is a different object from
 *  your own squad and shouldn't read like one. */
export type Tier = 'elite' | 'gold' | 'steel' | 'graphite' | 'ice'
export const tierOf = (rating: number | null): Tier =>
  rating == null ? 'graphite' : rating >= 90 ? 'elite' : rating >= 80 ? 'gold' : rating >= 70 ? 'steel' : 'graphite'

const TIER_SKIN: Record<Tier, { border: string; bg: string; glow?: string }> = {
  elite: { border: 'rgba(246,237,214,.55)', bg: 'linear-gradient(165deg,rgba(40,34,22,.97),rgba(13,11,8,.97))', glow: '0 0 18px -4px rgba(201,162,39,.55)' },
  gold: { border: 'rgba(201,162,39,.42)', bg: 'linear-gradient(165deg,rgba(33,29,22,.96),rgba(13,11,8,.96))' },
  steel: { border: 'rgba(201,207,214,.34)', bg: 'linear-gradient(165deg,rgba(26,29,33,.96),rgba(10,12,14,.96))' },
  graphite: { border: 'rgba(255,255,255,.14)', bg: 'linear-gradient(165deg,rgba(28,27,25,.96),rgba(11,11,10,.96))' },
  ice: { border: 'rgba(232,251,255,.42)', bg: 'linear-gradient(165deg,rgba(19,36,48,.97),rgba(6,13,18,.97))', glow: '0 0 18px -4px rgba(127,212,245,.5)' },
}

/** Compact pitch card — rating, photo, name and the next fixtures. Sized so a
 * full XI fits the pitch without scrolling. */
export function PitchCard({ rating, name, team, price, code, element, fixtures, onClick, footer, tier }: {
  rating: number | null
  name: string
  team: string
  price: number | null
  code: number | null
  element: number | null
  fixtures?: ReactNode
  onClick?: () => void
  footer?: ReactNode
  /** Override the band derived from the rating — Team of the Week uses `ice`. */
  tier?: Tier
}) {
  const t = tier ?? tierOf(rating)
  const skin = TIER_SKIN[t]
  return (
    <button
      onClick={onClick}
      // Width comes from the row (see CARD_W on the wrapper) — the card just
      // fills whatever slot it's given.
      className={`tier-${t} w-full rounded-lg border text-center transition-transform hover:-translate-y-0.5`}
      style={{ background: skin.bg, borderColor: skin.border, boxShadow: skin.glow }}
    >
      {/* the tier, as area rather than perimeter */}
      <div className="tier-cap" />
      <div className="px-1 pt-1 pb-2 sm:px-1.5 sm:pt-1.5 sm:pb-2.5">
        <div className="tier-num font-num text-[13px] leading-none font-extrabold tabular-nums sm:text-[15px]">{rating ?? '—'}</div>
        {/* The monogram sits *under* the headshot rather than instead of it, so
            a photo that can't be rasterised into a share PNG leaves initials
            behind rather than an empty hole. */}
        <span className="relative mx-auto my-1 block w-7 sm:w-8" style={{ height: 32 }}>
          <span className="absolute inset-0 grid place-items-center rounded bg-white/6 text-[11px] font-extrabold text-white/40">
            {initialsOf(name)}
          </span>
          <PlayerPhoto
            code={code} element={element}
            className="relative h-full w-full rounded object-cover object-top"
            placeholder={<span />}
          />
        </span>
        <div className="capture-line truncate text-[9.5px] leading-tight font-bold text-white sm:text-[10.5px]">{name}</div>
        {/* Club and price step aside on a phone: the fixtures are what you're
            actually checking, and they imply the club anyway. */}
        <div className="hidden truncate text-[8px] text-white/55 sm:block sm:text-[9px]">{team}{price != null ? ` · £${price}m` : ''}</div>
        {fixtures && <div className="mt-1">{fixtures}</div>}
        {footer}
      </div>
    </button>
  )
}
