import { availFor, type Availability, type AvailPlayer } from '../lib/availability'

/* ════════════════════════════════════════════════════════════════════════
   What a player is FOR, in the space of a few characters: who takes the
   penalties, who stands over the dead balls, and whether he's running hot
   or cold.

   On penalties FPL publishes a strict ORDER, never a tie — there isn't a
   single club in the league with two players listed at the same rank. So
   the badge shows a queue position rather than a share: "2nd" is what
   explains why Gyökeres looks like a penalty threat and isn't one this
   week. When the man in front is flagged out, the second name is actually
   on them, and the badge says so.
   ════════════════════════════════════════════════════════════════════════ */

export interface Duties {
  pen: number | null
  /** Who's ahead of him in the queue, when he isn't first. */
  penAhead: string | null
  /** True when everyone ahead of him is unavailable this week. */
  penActing: boolean
  corner: number | null
  fk: number | null
  streak: 'hot' | 'cold' | null
}

const OUT = new Set(['i', 's', 'u', 'n'])   // injured / suspended / unavailable / not in squad

/** Read the duties for one player out of the live layer. `nameOf` resolves an
 *  element id to a name so the badge can say who's ahead. */
export function dutiesOf(
  avail: Availability,
  element: number | null | undefined,
  code: number | null | undefined,
  streak: string | null | undefined,
  nameOf: (el: number) => string,
): Duties {
  const p = availFor(avail, element, code)
  const pen = p?.pen_order ?? null
  let penAhead: string | null = null
  let penActing = false
  if (p && pen != null && pen > 1) {
    // Everyone at this club listed ahead of him, nearest first.
    const ahead: AvailPlayer[] = []
    for (const q of avail.byElement.values()) {
      if (q.team === p.team && q.pen_order != null && q.pen_order < pen) ahead.push(q)
    }
    ahead.sort((a, b) => (b.pen_order ?? 0) - (a.pen_order ?? 0))
    if (ahead.length) {
      penAhead = nameOf(ahead[0].element)
      penActing = ahead.every((q) => OUT.has(String(q.status ?? 'a')))
    }
  }
  return {
    pen,
    penAhead,
    penActing,
    corner: p?.corner_order ?? null,
    fk: p?.fk_order ?? null,
    streak: streak?.includes('Hot') ? 'hot' : streak?.includes('Cold') ? 'cold' : null,
  }
}

/* The tint carries the meaning, the ink carries the legibility. Gold or blue
   TEXT at 10px fails the contrast bar on a light ground — the same trap the
   site-wide pass just cleared — so the hue lives in the background and the
   glyph stays in full ink, which reads at better than 12:1 in both themes. */
const CHIP = 'grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-[5px] px-1 text-[10px] leading-none font-extrabold text-ink'

/** The badge row that sits beside a player's name. Renders nothing at all when
 *  he has no duty and no streak, so an ordinary row stays quiet. */
export function DutyBadges({ d, className = '' }: { d: Duties; className?: string }) {
  const setPiece = (d.corner != null && d.corner <= 2) || (d.fk != null && d.fk <= 2)
  const spTitle = [d.corner != null && d.corner <= 2 ? 'corners' : null, d.fk != null && d.fk <= 2 ? 'free kicks' : null]
    .filter(Boolean).join(' & ')
  if (d.pen == null && !setPiece && !d.streak) return null
  return (
    <span className={`flex shrink-0 items-center gap-1 ${className}`}>
      {d.penActing ? (
        <span className={`${CHIP} bg-good/30`} title={`On penalties this week — ${d.penAhead} is out`}>P</span>
      ) : d.pen === 1 ? (
        <span className={`${CHIP} bg-accent/30`} title="Penalties — first choice">P</span>
      ) : d.pen === 2 ? (
        // Third in line and below is noise — he only takes one if two men are
        // missing, and by then the badge on the second name has gone green.
        <span className={`${CHIP} bg-accent/16`} title={d.penAhead ? `Penalties — second, behind ${d.penAhead}` : 'Penalties — second in line'}>P²</span>
      ) : null}
      {setPiece && <span className={`${CHIP} bg-info/26`} title={`Set pieces — ${spTitle}`}>SP</span>}
      {d.streak === 'hot' && <span className={`${CHIP} bg-hot/22`} title="Hot streak — scoring above his season rate">🔥</span>}
      {d.streak === 'cold' && <span className={`${CHIP} bg-cold/22`} title="Cold streak — scoring below his season rate">🧊</span>}
    </span>
  )
}

/** A visible key for the badges above.
 *
 *  The chips carry `title` tooltips, but a native tooltip needs a mouse, a
 *  second of patience and the knowledge that there is something to hover over.
 *  None of those hold on a phone, which is where most of this is read — so the
 *  meanings are also stated once, in the open, above the list they appear in. */
export function DutyLegend({ className = '' }: { className?: string }) {
  const items: [string, string, string][] = [
    ['P', 'bg-accent/30', 'first-choice penalties'],
    ['P²', 'bg-accent/16', 'second in line'],
    ['P', 'bg-good/30', 'on them this week — the man ahead is out'],
    ['SP', 'bg-info/26', 'corners or free kicks'],
    ['🔥', 'bg-hot/22', 'scoring above his rate'],
    ['🧊', 'bg-cold/22', 'scoring below it'],
  ]
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-ink-3 ${className}`}>
      {items.map(([glyph, tint, meaning], i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className={`grid h-[15px] min-w-[15px] place-items-center rounded-[4px] px-1 text-[9px] leading-none font-extrabold text-ink ${tint}`}>{glyph}</span>
          {meaning}
        </span>
      ))}
    </div>
  )
}
