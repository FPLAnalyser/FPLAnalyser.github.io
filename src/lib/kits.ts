import type { Mode } from './theme'

/* Club kit colours, and the rules for painting an xG bar in them.
 *
 * The point of colouring the bar by kit rather than by "favoured / not" is that
 * you recognise the game without reading it. That only works if a striped club
 * looks striped, so the patterns below are chosen for what survives in a 12px
 * bar — not for fidelity to the shirt. A detail that would read as noise at that
 * size is deliberately left out: Arsenal's white sleeves and Man City's fade to
 * white at the hem are both real and both absent, because the segment stands for
 * the body of the shirt, not the whole thing.
 *
 * Away kits are only listed where the 26/27 shirt has actually been seen. Where
 * one hasn't, the club wears its home colours and the UI can say so — a made-up
 * away colour is worse than an honest stand-in, because nobody can tell it's
 * made up. */

/** How a segment is painted. Each one reads at 12px; nothing else does. */
export type Pattern =
  | 'solid'      // flat
  | 'stripes'    // bold diagonal, base and second in equal measure
  | 'pinstripe'  // wide base, thin second
  | 'tricolour'  // base plus two diagonal accents
  | 'yoke'       // second across the top third
  | 'trim'       // second as a band top and bottom — a plain shirt with contrast edges
  | 'panel'      // second as a wedge at the trailing edge

export interface Kit {
  base: string
  second: string
  /** Only for shirts carrying two accents — Palace's sash, Leeds' hoops. */
  third?: string
  pattern: Pattern
}

interface ClubKits {
  home: Kit
  /** Absent until the real 26/27 away shirt has been seen. */
  away?: Kit
}

const K: Record<string, ClubKits> = {
  ARS: { home: { base: '#e2231a', second: '#ffffff', pattern: 'solid' },
         away: { base: '#1e2a52', second: '#f2c744', pattern: 'trim' } },
  AVL: { home: { base: '#670e36', second: '#95bfe5', pattern: 'trim' } },
  BOU: { home: { base: '#d71920', second: '#000000', pattern: 'stripes' },
         // 26/27 away: violet, with a lighter lilac geometric print over most
         // of it. The print itself is noise at 12px, but the shirt does not
         // read flat, so `pinstripe` carries the lighter tone without trying
         // to draw the shapes.
         away: { base: '#4e4287', second: '#a79dd0', pattern: 'pinstripe' } },
  BRE: { home: { base: '#e30613', second: '#ffffff', pattern: 'stripes' },
         away: { base: '#15161a', second: '#e8e4d8', pattern: 'pinstripe' } },
  BHA: { home: { base: '#0b5cc4', second: '#ffffff', pattern: 'pinstripe' },
         away: { base: '#f4f4f2', second: '#1a63d0', pattern: 'pinstripe' } },
  CHE: { home: { base: '#0a3fae', second: '#f2d24b', pattern: 'trim' },
         away: { base: '#131313', second: '#f5d130', pattern: 'trim' } },
  COV: { home: { base: '#3aa3e0', second: '#ffffff', pattern: 'stripes' },
         // One colour, no wedge. `second` is their sky, which the shirt carries
         // on the badge and the trim — it is never painted here, but the clash
         // rule falls back to it, so it has to be a colour they'd actually wear.
         away: { base: '#efe7d6', second: '#3aa3e0', pattern: 'solid' } },
  CRY: { home: { base: '#f3f4f6', second: '#c4122e', third: '#1b458f', pattern: 'tricolour' },
         away: { base: '#141519', second: '#c4122e', pattern: 'trim' } },
  EVE: { home: { base: '#003399', second: '#ffffff', pattern: 'solid' },
         away: { base: '#f6f6f4', second: '#14224a', third: '#e0a83c', pattern: 'tricolour' } },
  FUL: { home: { base: '#f5f5f5', second: '#141414', pattern: 'trim' } },
  HUL: { home: { base: '#f5a12d', second: '#000000', pattern: 'stripes' },
         away: { base: '#f5f5f2', second: '#f5a12d', pattern: 'yoke' } },
  IPS: { home: { base: '#1f4fc4', second: '#ffffff', pattern: 'solid' },
         away: { base: '#f0e7cd', second: '#1a1a1a', pattern: 'pinstripe' } },
  LEE: { home: { base: '#f5f5f5', second: '#1d4ed8', third: '#f5c518', pattern: 'tricolour' },
         away: { base: '#f5c518', second: '#14224a', pattern: 'trim' } },
  LIV: { home: { base: '#c8102e', second: '#ffffff', pattern: 'solid' },
         away: { base: '#f7f7f7', second: '#c8102e', pattern: 'trim' } },
  MCI: { home: { base: '#6cabdd', second: '#ffffff', pattern: 'solid' },
         // 26/27 away: black with gold collar, cuffs and hem — the same shape
         // as Arsenal's and Chelsea's travelling kits, so the same pattern.
         // The bee print on the body is invisible at this size and left out.
         away: { base: '#15171b', second: '#e6c063', pattern: 'trim' } },
  MUN: { home: { base: '#d71920', second: '#000000', pattern: 'solid' },
         away: { base: '#2b5fd0', second: '#d71920', pattern: 'trim' } },
  NEW: { home: { base: '#241f20', second: '#ffffff', pattern: 'stripes' },
         away: { base: '#2b3a5c', second: '#35a3a3', pattern: 'trim' } },
  NFO: { home: { base: '#dd0000', second: '#ffffff', pattern: 'solid' } },
  SUN: { home: { base: '#eb172b', second: '#ffffff', pattern: 'stripes' },
         away: { base: '#e79aac', second: '#141414', pattern: 'yoke' } },
  TOT: { home: { base: '#f5f5f5', second: '#132257', pattern: 'solid' },
         // Deep blue-purple carrying the shirt, orange as an accent rather than
         // half of it — bold stripes made this read as an orange kit, which it
         // isn't.
         away: { base: '#2c2559', second: '#ea6a2b', pattern: 'pinstripe' } },
}

/** Clubs whose 26/27 away shirt we have. Everyone else stands in at home. */
export const hasAwayKit = (team: string): boolean => Boolean(K[team]?.away)

const rgb = (h: string): [number, number, number] => {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

/** Weighted RGB distance — crude, but it answers the only question asked of it:
 *  would a person glancing at a 12px bar tell these two shirts apart. */
function dist(a: string, b: string): number {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const rm = (ar + br) / 2
  return Math.sqrt((2 + rm / 256) * (ar - br) ** 2 + 4 * (ag - bg) ** 2 + (2 + (255 - rm) / 256) * (ab - bb) ** 2)
}

/** Below this, two colours read as one at 12px.
 *
 *  Used for two questions that are really the same question: do these two
 *  shirts clash, and does this shirt clash with the card it is painted on. */
const SAME = 120

/** The card each mode paints the bar onto — `surface-1` from the stylesheet.
 *  A bar that vanishes does so against the card, not against the page. */
const CARD = { dark: '#16130e', light: '#ffffff' } as const
/** Dark mode's `ink-1`, which a black shirt is lifted toward. There is no
 *  light-mode equivalent: a shirt that vanishes into the white card gets a
 *  rim rather than a tint, because darkening a white shirt makes it grey. */
const DARK_INK = '#f4efe3'

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const h = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${h(ar, br)}${h(ag, bg)}${h(ab, bb)}`
}

export interface ResolvedFixture {
  home: Kit
  away: Kit
  /** Set when the clash rule changed the away side, phrased for a tooltip. */
  clash: string | null
  /** False when the away club's real 26/27 shirt hasn't been sourced yet. */
  awaySourced: boolean
}

/** Who wears what, for one fixture.
 *
 *  The home side wears home. The away side wears away — unless that would read
 *  as the same colour as the home shirt, in which case it falls back to its own
 *  home colours, and if those clash too, to its second colour. Which is roughly
 *  what a kit manager does, and it means the rule needs no per-fixture list. */
export function resolveFixture(homeTeam: string, awayTeam: string, label: (t: string) => string): ResolvedFixture {
  const h = K[homeTeam]?.home
  const a0 = K[awayTeam]
  if (!h || !a0) {
    // A club we have no colours for at all — the caller falls back to its own
    // default bar rather than being handed a made-up shirt.
    return { home: h ?? { base: 'var(--accent)', second: 'var(--accent)', pattern: 'solid' },
             away: a0?.home ?? { base: 'var(--info)', second: 'var(--info)', pattern: 'solid' },
             clash: null, awaySourced: false }
  }
  const sourced = Boolean(a0.away)
  let away = a0.away ?? a0.home
  let clash: string | null = null
  if (dist(h.base, away.base) < SAME) {
    if (dist(h.base, a0.home.base) >= SAME) {
      clash = `${label(awayTeam)} would clash with ${label(homeTeam)} — shown in their home colours`
      away = a0.home
    } else {
      clash = `Both shirts read the same — ${label(awayTeam)} shown in their second colour`
      away = { base: away.second, second: away.base, pattern: 'solid' }
    }
  }
  return { home: h, away, clash, awaySourced: sourced }
}

/** The CSS background for one segment of the bar.
 *
 *  `mode` matters for one reason: a shirt the same colour as the card it sits
 *  on has no shape. Chelsea, Palace and Brentford all travel in black, and on
 *  the dark card the body of the bar disappeared and left the trim floating as
 *  two thin lines. An outline can't fix that — it lands exactly where the trim
 *  already is — so the tone is lifted toward the card's ink instead. Pale
 *  shirts on the white card get the outline treatment instead, via
 *  `kitOutline`.
 *
 *  The test is colour distance from the card, not brightness. Brightness was
 *  the wrong question and it cost real kits: Everton's royal blue, Villa's
 *  claret, Arsenal's navy and Spurs' purple are all dark by luminance and none
 *  of them is remotely hard to see against a near-black card, but every one of
 *  them was being mixed halfway to cream and coming out the same grey. What
 *  actually needs rescuing is a shirt with no colour to tell it apart from the
 *  card — black, and only black. */
export function kitBackground(kit: Kit, mode: Mode): string {
  const b = mode === 'dark' && dist(kit.base, CARD.dark) < SAME ? mix(kit.base, DARK_INK, 0.26) : kit.base
  const s = kit.second
  const t = kit.third ?? s
  switch (kit.pattern) {
    case 'stripes':   return `repeating-linear-gradient(115deg,${b} 0 6px,${s} 6px 11px)`
    case 'pinstripe': return `repeating-linear-gradient(115deg,${b} 0 9px,${s} 9px 11px)`
    case 'tricolour': return `repeating-linear-gradient(115deg,${b} 0 9px,${s} 9px 13px,${t} 13px 17px)`
    case 'yoke':      return `linear-gradient(180deg,${s} 0 34%,${b} 34% 100%)`
    // 16.7% is 2px of the 12px bar, stated as a fraction rather than as
    // `calc(100% - 2px)`: the rasteriser can't resolve a calc in a colour stop
    // and interpolates between the two instead, so Fulham exported as a white
    // bar fading to grey rather than a white bar with black edges.
    case 'trim':      return `linear-gradient(180deg,${s} 0 16.7%,${b} 16.7% 83.3%,${s} 83.3% 100%)`
    case 'panel':     return `linear-gradient(90deg,${b} 0 76%,${s} 76% 100%)`
    default:          return b
  }
}

/** Patterns that paint the second colour along an outer edge of the segment: a
 *  band top and bottom, a yoke across the top, a wedge at the trailing side.
 *  The diagonals are deliberately not here — a dark stripe reaches the edge
 *  too, but the light stripes either side of it still say where the bar ends. */
const EDGED: ReadonlySet<Pattern> = new Set<Pattern>(['trim', 'yoke', 'panel'])

/** A rim, when the shirt would otherwise have no boundary against the card.
 *
 *  Both modes, and for the same reason. On the light card a white or cream
 *  shirt has no edge — Fulham, Leeds and Spurs at home, Liverpool, Hull and
 *  Brighton away. On the dark card the mirror image was still broken: a shirt
 *  whose BODY is black gets lifted by `kitBackground`, but a shirt with black
 *  along its edge does not, so Fulham's black trim, Leeds' navy trim and the
 *  black yoke on Sunderland's away shirt were all being drawn into a card of
 *  the same tone and disappearing. The bar looked as though it stopped short.
 *
 *  A rim fixes exactly that case and nothing else: the trim is then held
 *  between the rim and the body of the shirt, so it reads as trim again rather
 *  than as empty space. It is not applied to a black BODY on the dark card,
 *  because `kitBackground` has already lifted that and a rim on top would be
 *  a line around a shirt that no longer needs one. */
export function kitOutline(kit: Kit, mode: Mode): string | undefined {
  const edged = EDGED.has(kit.pattern)
  const gone = (c: string) => dist(c, CARD[mode]) < SAME
  if (mode === 'light') {
    return gone(kit.base) || (edged && gone(kit.second)) ? '1px solid rgba(0,0,0,.24)' : undefined
  }
  // The base is already lifted by `kitBackground` where it needed it, so on the
  // dark card only an edge in the second colour is still at risk.
  return edged && gone(kit.second) ? '1px solid rgba(244,239,227,.34)' : undefined
}
