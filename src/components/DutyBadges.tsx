import { availFor, notPlaying, penaltyDuty, type Availability, type AvailPlayer } from '../lib/availability'

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

/** What the badge is entitled to claim about him this week.
 *
 *  `first`   — first choice, and playing. The plain case.
 *  `acting`  — not first choice, but the men ahead are out, so they're his.
 *  `dormant` — first choice, and HE is out. The duty is his and he will not be
 *              taking one; somebody else has them meanwhile.
 *  `queued`  — second in line behind a fit first choice. Not on them. */
export type PenState = 'first' | 'acting' | 'dormant' | 'queued'

export interface Duties {
  pen: number | null
  penState: PenState | null
  /** The other name in the story: who he's covering for, who has them while
   *  he's out, or who is ahead of him — whichever the state calls for. */
  penOther: string | null
  corner: number | null
  fk: number | null
  streak: 'hot' | 'cold' | null
}

/** Read the duties for one player out of the live layer. `nameOf` resolves an
 *  element id to a name so the badge can say who's ahead.
 *
 *  The state comes from `penaltyDuty`, which is the site's one answer to "who
 *  takes this club's penalties" — the badge, the fixture card and the squad
 *  rating all ask it now, so they cannot disagree. Rank alone is not enough:
 *  FPL leaves an injured man listed at order 1 for as long as the injury
 *  lasts, so the badge used to promise first-choice penalties beside a player
 *  who was three months from kicking a ball. */
export function dutiesOf(
  avail: Availability,
  element: number | null | undefined,
  code: number | null | undefined,
  streak: string | null | undefined,
  nameOf: (el: number) => string,
): Duties {
  const p = availFor(avail, element, code)
  const pen = p?.pen_order ?? null
  let penState: PenState | null = null
  let penOther: string | null = null
  if (p && pen != null) {
    const duty = p.team != null ? penaltyDuty(avail, p.team) : null
    const mine = duty?.taker.element === p.element
    if (mine) {
      penState = duty?.deputisingFor ? 'acting' : 'first'
      penOther = duty?.deputisingFor ? nameOf(duty.deputisingFor.element) : null
    } else if (notPlaying(p.status)) {
      // He isn't taking them because he isn't playing — say who is.
      penState = 'dormant'
      penOther = duty ? nameOf(duty.taker.element) : null
    } else if (pen === 2) {
      penState = 'queued'
      const ahead: AvailPlayer[] = []
      for (const q of avail.byElement.values()) {
        if (q.team === p.team && q.pen_order != null && q.pen_order < pen) ahead.push(q)
      }
      ahead.sort((a, b) => (b.pen_order ?? 0) - (a.pen_order ?? 0))
      penOther = ahead.length ? nameOf(ahead[0].element) : null
    }
  }
  return {
    pen,
    penState,
    penOther,
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
  if (d.penState == null && !setPiece && !d.streak) return null
  return (
    <span className={`flex shrink-0 items-center gap-1 ${className}`}>
      {d.penState === 'acting' ? (
        <span className={`${CHIP} bg-good/30`} title={`On penalties this week — ${d.penOther} is out`}>P</span>
      ) : d.penState === 'first' ? (
        <span className={`${CHIP} bg-accent/30`} title="Penalties — first choice">P</span>
      ) : d.penState === 'dormant' ? (
        // Struck through, because the duty is real and he is not performing
        // it. Hiding the badge would be the other mistake: he is still the
        // club's first choice and takes them again the week he is fit, which
        // is exactly what you want to know when planning a transfer back in.
        <span
          className={`${CHIP} bg-ink-3/20 text-ink-3 line-through`}
          title={d.penOther ? `Penalties — his, but he's out; ${d.penOther} is taking them` : "Penalties — his, but he's out"}
        >P</span>
      ) : d.penState === 'queued' ? (
        // Third in line and below is noise — he only takes one if two men are
        // missing, and by then the badge on the second name has gone green.
        <span className={`${CHIP} bg-accent/16`} title={d.penOther ? `Penalties — second, behind ${d.penOther}` : 'Penalties — second in line'}>P²</span>
      ) : null}
      {setPiece && <span className={`${CHIP} bg-info/26`} title={`Set pieces — ${spTitle}`}>SP</span>}
      {d.streak === 'hot' && <span className={`${CHIP} bg-hot/22`} title="Hot streak — scoring above his season rate">🔥</span>}
      {d.streak === 'cold' && <span className={`${CHIP} bg-cold/22`} title="Cold streak — scoring below his season rate">❄️</span>}
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
    ['P', 'bg-ink-3/20 text-ink-3 line-through', 'his, but he’s out'],
    ['SP', 'bg-info/26', 'corners or free kicks'],
    ['🔥', 'bg-hot/22', 'scoring above his rate'],
    ['❄️', 'bg-cold/22', 'scoring below it'],
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
