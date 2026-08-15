import { type CSSProperties, type ReactNode } from 'react'
import { PlayerPhoto } from './PlayerPhoto'
import { SEV_COLOUR, type AvailBadgeInfo } from '../lib/availability'

/* ════════════════════════════════════════════════════════════════════════
   The pitch: mown stripes, a soft top-down light, and real markings drawn
   as vector geometry (boxes, six-yard boxes, spots, both Ds, centre circle,
   corner arcs). Shared by Squad Builder and My Team, and crisp at any size
   in a shared PNG.
   ════════════════════════════════════════════════════════════════════════ */

export function Pitch({ children, footer, className, maxWidth, boosted, overlay, overlayLeft, plain }: {
  children: ReactNode; footer?: ReactNode; className?: string; maxWidth?: number
  /** No grass. The comparison boards are a DIFF drawn on a pitch, and a
   *  strong green under thirty cards is the loudest thing on a screen whose
   *  whole message is which two of them are different. Same markings, same
   *  shape, laid on the page's own surface instead. */
  plain?: boolean
  /** Bench Boost is on, so the bench is scoring — it gets the gold edge and
   *  says BOOST, the same signal the live board gives it. */
  boosted?: boolean
  /** Controls that belong to the board rather than to the page — they float
   *  in the corners of the grass instead of taking a row above it. The share
   *  export builds its own Pitch and passes nothing, so none of this lands in
   *  the picture. */
  overlay?: ReactNode
  /** The same, in the other corner. */
  overlayLeft?: ReactNode
}) {
  return (
    <div
      data-pitch=""
      // A pitch has a shape: a portrait aspect keeps the centre circle round
      // and the boxes in proportion. But the ratio is a FLOOR, not a fixed
      // height — a phone-width pitch holds taller rows than 68:92 allows, and
      // a fixed `aspect-ratio` plus `overflow-hidden` silently ate the
      // forwards. One grid cell, two children stacked in it: a spacer that
      // enforces the ratio and the content that can outgrow it.
      className={`relative grid overflow-hidden rounded-2xl px-1.5 py-3 sm:px-3 sm:py-4 md:px-4 md:py-5 ${className ?? ''}`}
      style={{
        maxWidth,
        margin: maxWidth ? '0 auto' : undefined,
        background: plain
          ? 'linear-gradient(180deg,#101114 0%,#0b0c0f 60%,#08090b 100%)'
          : [
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
        <g fill="none" stroke={plain ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.5)'} strokeWidth="1.6">
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
      {/* The corner of the grass. Above the goalkeeper's row and outside the
          six-yard box on every width the pitch is drawn at, so it never sits
          on a card. */}
      {overlay && <div className="absolute top-2 right-2 z-20 sm:top-3 sm:right-3">{overlay}</div>}
      {overlayLeft && <div className="absolute top-2 left-2 z-20 sm:top-3 sm:left-3">{overlayLeft}</div>}
      <div className="relative col-start-1 row-start-1 flex flex-col">
        <div className="flex flex-1 flex-col justify-around gap-2">{children}</div>
        {footer && (
          // The bench: a band across the foot of the pitch, the way it sits on
          // a teamsheet — still inside the frame, clearly not on the field.
          <div
            className={`mt-2 rounded-xl border px-1 py-2 backdrop-blur-[1px] sm:px-3 ${boosted ? 'border-[#c9a227]' : 'border-white/12 bg-black/35'}`}
            style={boosted ? { background: 'linear-gradient(180deg, rgba(201,162,39,.22), rgba(0,0,0,.45))', boxShadow: '0 0 0 1px rgba(247,227,166,.25)' } : undefined}
          >
            <div className={`mb-1.5 text-[10px] font-extrabold tracking-[0.18em] uppercase ${boosted ? 'text-[#F7E3A6]' : 'text-white/55'}`}>{boosted ? 'Boost' : 'Bench'}</div>
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
export const CARD_W = 'min-w-0 flex-1 basis-0 max-w-[108px] sm:max-w-[118px] lg:max-w-[136px]'

/** Name type size on a pitch card, below the `sm` breakpoint only.
 *
 *  The site's floor is 10px, and this is the one place that earns an
 *  exception: a five-across defence on a phone leaves each card about 64px of
 *  text at 390px, and "Calvert-Lewin" needs 68px at 10px. Truncating the name
 *  is worse than half a point of type, so long names step down instead.
 *
 *  Thresholds are measured rather than guessed, and an armband counts for four
 *  characters because the C/V badge takes ~18px out of the same row — which is
 *  why a six-letter captain can run out of room while an eleven-letter
 *  midfielder does not. Above `sm` the cards are wide enough that everything
 *  sits at 10.5px regardless. */
export function nameSize(name: string, hasArmband = false): string {
  const n = name.length + (hasArmband ? 4 : 0)
  return n >= 13 ? 'text-[9px]' : n >= 9 ? 'text-[9.5px]' : 'text-[10px]'
}

/** Rating tiers. The band a player falls in is what the card's material says,
 *  so a shelf of them sorts itself before you read a single name. `ice` is not
 *  a rating band — it marks Team of the Week, which is a different object from
 *  your own squad and shouldn't read like one.
 *
 *  MEDALS, AND ALL OF THEM. This ran elite / gold / steel / graphite, with
 *  nothing at all between 70 and the floor: a 65 and a 30 were the same dark
 *  card. Meanwhile the player's own detail card called 60–79 silver and
 *  everything below bronze, so one player carried two different metals
 *  depending on which page you were on. One scale now, in the language the
 *  site already speaks in on every podium it draws — and bronze exists again,
 *  which is where a 65 belongs. Graphite is what is left below the medals. */
export type Tier = 'elite' | 'gold' | 'silver' | 'bronze' | 'graphite' | 'ice'
export const tierOf = (rating: number | null): Tier =>
  rating == null ? 'graphite'
    : rating >= 90 ? 'elite'
      : rating >= 80 ? 'gold'
        : rating >= 70 ? 'silver'
          : rating >= 60 ? 'bronze'
            : 'graphite'

/** The card's material, per tier — the padded gradient EDGE (the foil) and
 *  the stock behind the content. This is the thicker edge from the mockup:
 *  2px of metal all the way round, 2.5px + glow for elite, rather than a
 *  1px border that disappears at pitch scale. */
const TIER_SKIN: Record<Tier, { edge: string; stock: string; glow?: string; pad?: number }> = {
  elite: {
    edge: 'conic-gradient(from 210deg,#8A6E36,#F6EDD6,#FFFBF0,#D8BE86,#6E5A2E,#F6EDD6,#8A6E36)',
    stock: 'linear-gradient(168deg,#1f2023,#0f1013 56%,#08090c)',
    glow: '0 0 0 1px rgba(255,251,240,.18), 0 0 18px -2px rgba(201,162,39,.5)',
    pad: 2.5,
  },
  gold: {
    edge: 'linear-gradient(160deg,#5f4d26,#c9a227,#ead188,#50411f)',
    stock: 'linear-gradient(168deg,#1f2023,#0f1013 56%,#08090c)',
  },
  silver: {
    edge: 'linear-gradient(160deg,#5C636B,#C9CFD6,#e8ecf1,#4a5057)',
    stock: 'linear-gradient(168deg,#1a1d21,#12151a 56%,#0a0c0e)',
  },
  // The copper the detail card already uses, as an edge rather than a border.
  bronze: {
    edge: 'linear-gradient(160deg,#51351f,#c8965a,#e0b385,#6b4526)',
    stock: 'linear-gradient(168deg,#1f1b17,#141110 56%,#0b0a09)',
  },
  graphite: {
    edge: 'linear-gradient(160deg,#2f3033,#55524a,#2f3033)',
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
export function PitchCard({ rating, cornerText, name, team, price, code, element, fixtures, onClick, footer, tier, flag, armband }: {
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
  /** Armband, when the card is showing a picked lineup: C, V or 3× . */
  armband?: 'C' | 'V' | '3×' | null
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
      <span className="block px-0.5 pt-1 pb-2 sm:px-1.5 sm:pt-1.5 sm:pb-2.5">
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
        <span className={`capture-line flex w-full items-center justify-center gap-1 leading-tight font-bold text-white sm:text-[10.5px] ${nameSize(name, !!armband)}`}>
          {armband && (
            <span
              className={`grid h-[14px] min-w-[14px] shrink-0 place-items-center rounded-full px-1 text-[10px] leading-none font-black ${
                armband === 'V' ? 'bg-white/85 text-black' : 'bg-accent text-accent-contrast'
              }`}
            >{armband}</span>
          )}
          {/* capture-line on the truncating span itself, not just its row:
              the export draws glyphs lower in the box than the browser does,
              and `truncate`'s overflow:hidden was shaving the bottom off every
              name. The rule that lets them show has to sit on the element
              doing the clipping. */}
          <span className="capture-line truncate">{name}</span>
        </span>
        {/* Club and price step aside on a phone: the fixtures are what you're
            actually checking, and they imply the club anyway. */}
        <span className="capture-line hidden truncate text-[8px] text-white/55 sm:block sm:text-[9px]">{team}{price != null ? ` · £${price}m` : ''}</span>
        {fixtures && <span className="mt-1 block">{fixtures}</span>}
        {footer}
      </span>
    </FoilShell>
  )
}

/** The bench as a spine: the label turned on its side into a coloured edge,
 *  so it costs width rather than height — the bench adds no vertical chrome
 *  to the board at all. The edge fills solid gold under Bench Boost, which
 *  is a loud signal for very little ink. */
export function BenchSpine({ boosted, maxWidth, children }: { boosted?: boolean; maxWidth?: number; children: ReactNode }) {
  return (
    <div className="mx-auto mt-2.5" style={{ maxWidth }}>
      <div
        className={`flex items-stretch gap-2.5 overflow-hidden rounded-xl border py-2 pr-2.5 transition-colors ${boosted ? 'border-accent' : 'border-line-strong'}`}
        style={{
          background: boosted
            ? 'linear-gradient(180deg, color-mix(in oklab, var(--accent) 18%, #14161a), #0f1319)'
            : 'linear-gradient(180deg,#151b23,#10151b)',
        }}
      >
        <span
          className="-my-2 grid w-[26px] shrink-0 place-items-center"
          style={{ background: boosted ? 'linear-gradient(180deg,#F7E3A6,#B98B2C)' : 'linear-gradient(180deg,#39424E,#232B35)' }}
        >
          <span
            className={`text-[10px] font-extrabold tracking-[0.24em] uppercase ${boosted ? 'text-[#17130A]' : 'text-white/55'}`}
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {boosted ? 'Boost' : 'Subs'}
          </span>
        </span>
        <div className="flex min-w-0 flex-1 justify-center gap-1 sm:gap-2.5">{children}</div>
      </div>
    </div>
  )
}
