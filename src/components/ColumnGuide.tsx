import { useState } from 'react'
import { Icon } from './Icon'
import type { Column } from './SortableTable'

/**
 * "What's in this table" — one info button on the share row that names every
 * column and says what it measures.
 *
 * The per-header ⓘ tips are the site's explanation of itself, and below `lg`
 * they come off: a 14px icon in a header sets that column's width, and width
 * is the whole reason the boards fit a phone at all. Without them a reader on
 * a phone met `Big` and `Chain` with nothing to tell them those are big
 * chances created and xGChain per 90.
 *
 * So the tips are not deleted, they are collected. One button, one panel, every
 * definition in the order the columns appear — which also reads better than
 * eleven separate taps on a desktop, where the per-header tips still work.
 *
 * `data-no-capture` on the trigger and the panel: this is chrome, and it does
 * not belong in the share image.
 */
export function ColumnGuide<T>({ columns, label = 'Columns' }: { columns: Column<T>[]; label?: string }) {
  const [open, setOpen] = useState(false)
  // Only the data points. A name needs no gloss, and the rank is a property of
  // the sort rather than something measured about the player.
  const explained = columns.filter((c) => c.tip && c.key !== 'rank')
  if (!explained.length) return null

  return (
    // The panel floats off the trigger rather than joining the toolbar's flex
    // flow: that row is nowrap above 360px, so a full-width child in it would
    // fight the Share button for the line. It opens rightward from the
    // trigger's left edge — anchored the other way it measured left:-241 on a
    // 390px screen, because the trigger leads the row rather than ending it,
    // so keep this button at the left of whatever row it is put in.
    <span className="relative inline-flex">
      <button
        data-no-capture
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors ${
          open ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
        }`}
      >
        <Icon name="info" size={13} /> <span className="hidden min-[360px]:inline">{label}</span>
      </button>
      {open && (
        <div
          data-no-capture
          className="absolute top-9 left-0 z-30 max-h-[60vh] w-[min(88vw,560px)] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-xl border border-line-mid bg-surface-1 p-3 shadow-float lg:p-4"
        >
          <div className="mb-2 text-[10px] font-bold tracking-[0.14em] text-ink-3 uppercase">What's in this table</div>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {explained.map((c) => (
              <div key={c.key} className="min-w-0">
                <dt className="text-[11.5px] font-bold text-ink">{c.header}</dt>
                <dd className="text-[11.5px] leading-relaxed text-ink-2">{c.tip}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </span>
  )
}
