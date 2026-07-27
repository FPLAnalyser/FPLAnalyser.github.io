import { type CSSProperties, type ReactNode } from 'react'
import { PlayerPhoto } from './PlayerPhoto'
import { SEV_COLOUR, type AvailBadgeInfo } from '../lib/availability'

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
      {/* Ratio floor — a MINIMUM height, not a fixed one. A phone needs the
          full portrait shape to fit four rows of cards; a wide pitch does
          not, and holding 92:68 there just paints empty grass. */}
      <div aria-hidden="true" className="col-start-1 row-start-1 w-full pt-[135%] sm:pt-[104%] lg:pt-[96%]" />
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
export const CARD_W = 'min-w-0 flex-1 basis-0 max-w-[108px] sm:max-w-[118px]'

/** Rating tiers. The band a player falls in is what the card's material says,
 *  so a shelf of them sorts itself before you read a single name. `ice` is not
 *  a rating band — it marks Team of the Week, which is a different object from
 *  your own squad and shouldn't read like one. */
export type Tier = 'elite' | 'gold' | 'steel' | 'graphite' | 'ice'
export const tierOf = (rating: number | null): Tier =>
  rating == null ? 'graphite' : rating >= 90 ? 'elite' : rating >= 80 ? 'gold' : rating >= 70 ? 'steel' : 'graphite'

/** The card's material, per tier — the padded gradient EDGE (the foil) and
 *  the stock behind the content. This is the thicker edge from the mockup:
 *  2px of metal all the way round, 2.5px + glow for elite, rather than a
 *  1px border that disappears at pitch scale. */
const TIER_SKIN: Record<Tier, { edge: string; stock: string; glow?: string; pad?: number }> = {
  elite: {
    edge: 'conic-gradient(from 210deg,#8A6E36,#F6EDD6,#FFFBF0,#D8BE86,#6E5A2E,#F6EDD6,#8A6E36)',
    stock: 'linear-gradient(168deg,#241f16,#141009 56%,#0c0906)',
    glow: '0 0 0 1px rgba(255,251,240,.18), 0 0 18px -2px rgba(201,162,39,.5)',
    pad: 2.5,
  },
  gold: {
    edge: 'linear-gradient(160deg,#5f4d26,#c9a227,#ead188,#50411f)',
    stock: 'linear-gradient(168deg,#241f16,#141009 56%,#0c0906)',
  },
  steel: {
    edge: 'linear-gradient(160deg,#5C636B,#C9CFD6,#e8ecf1,#4a5057)',
    stock: 'linear-gradient(168deg,#1a1d21,#12151a 56%,#0a0c0e)',
  },
  graphite: {
    edge: 'linear-gradient(160deg,#33302a,#55524a,#33302a)',
    stock: 'linear-gradient(168deg,#1c1b19,#131211 56%,#0b0b0a)',
  },
  ice: {
    edge: 'conic-gradient(from 210deg,#1d4f6b,#7fd4f5,#e8fbff,#4a9fc4,#153c52,#7fd4f5,#1d4f6b)',
    stock: 'linear-gradient(168deg,#132430,#0b171f 56%,#060d12)',
    glow: '0 0 0 1px rgba(232,251,255,.16), 0 0 18px -2px rgba(127,212,245,.4)',
    pad: 2.5,
  },
}

/** The foil shell shared by every card variant: gradient edge outside, stock
 *  inside. Children render on the stock. */
export function FoilShell({ tier, className, style, onClick, children, innerClassName }: {
  tier: Tier
  className?: string
  style?: CSSProperties
  onClick?: () => void
  children: ReactNode
  innerClassName?: string
}) {
  const skin = TIER_SKIN[tier]
  return (
    <button
      onClick={onClick}
      className={`tier-${tier} relative overflow-hidden rounded-[9px] text-center transition-transform hover:-translate-y-0.5 ${className ?? ''}`}
      style={{ padding: skin.pad ?? 2, background: skin.edge, boxShadow: skin.glow, ...style }}
    >
      <span className={`block rounded-[7px] ${innerClassName ?? ''}`} style={{ background: skin.stock }}>
        {children}
      </span>
    </button>
  )
}

/** Compact pitch card — rating, photo, name and the next fixtures. Sized so a
 * full XI fits the pitch without scrolling. */
export function PitchCard({ rating, cornerText, name, team, price, code, element, fixtures, onClick, footer, tier, flag }: {
  rating: number | null
  /** Override for the corner figure (price, projected points…) — the TIER
   *  still comes from the rating, so the card's metal keeps meaning quality. */
  cornerText?: string | null
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
  /** Availability chip: INJ / SUS / chance-% — from the live layer. */
  flag?: AvailBadgeInfo | null
}) {
  const t = tier ?? tierOf(rating)
  return (
    <FoilShell tier={t} onClick={onClick} className="w-full">
      {flag && <span className="absolute inset-x-0 top-0 z-10 h-1" style={{ background: SEV_COLOUR[flag.sev].bar }} />}
      {flag && (
        <span
          title={flag.title}
          className="absolute top-[5px] left-1 z-10 rounded px-1 py-0.5 text-[7.5px] leading-none font-extrabold tracking-wide"
          style={{ background: SEV_COLOUR[flag.sev].chip, color: SEV_COLOUR[flag.sev].ink }}
        >
          {flag.label}
        </span>
      )}
      <span className="block px-1 pt-1 pb-2 sm:px-1.5 sm:pt-1.5 sm:pb-2.5">
        <span className="tier-num font-num block text-[13px] leading-none font-extrabold tabular-nums sm:text-[15px]">{cornerText ?? rating ?? '—'}</span>
        {/* The headshot sits straight on the card — no plate behind it. These
            are transparent cut-outs, so a filled box shows through the player
            and reads as a mistake. The monogram is the fallback for when there
            is no photo at all. */}
        <span className="photo-slot relative mx-auto my-1 block w-8 sm:w-9" style={{ height: 36 }}>
          <span className="photo-mono absolute inset-0 place-items-center text-[11px] font-extrabold text-white/35">
            {initialsOf(name)}
          </span>
          <PlayerPhoto
            code={code} element={element}
            className="relative h-full w-full object-contain object-top"
            placeholder={<span className="grid h-full w-full place-items-center text-[11px] font-extrabold text-white/35">{initialsOf(name)}</span>}
          />
        </span>
        <span className="capture-line block truncate text-[9.5px] leading-tight font-bold text-white sm:text-[10.5px]">{name}</span>
        {/* Club and price step aside on a phone: the fixtures are what you're
            actually checking, and they imply the club anyway. */}
        <span className="hidden truncate text-[8px] text-white/55 sm:block sm:text-[9px]">{team}{price != null ? ` · £${price}m` : ''}</span>
        {fixtures && <span className="mt-1 block">{fixtures}</span>}
        {footer}
      </span>
    </FoilShell>
  )
}
