import { useMemo, useState, type ReactNode } from 'react'
import { InfoTip } from './InfoTip'
import { useWide } from '../lib/useWide'

export interface Column<T> {
  key: string
  header: ReactNode
  /** Tooltip text shown next to the header. */
  tip?: ReactNode
  /** Raw value used for sorting; null/undefined always sink to the bottom. */
  sortValue?: (row: T) => number | string | null | undefined
  /** Cell contents. */
  cell: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  /** Sticky first column on mobile (defaults true for the first column). */
  sticky?: boolean
  /** Squeeze the horizontal padding and hide the tooltip on a phone.
   *  For columns whose content is one or two characters — a rank number was
   *  taking 61px of a 390px screen because the header carried an info icon
   *  and a sort arrow at full padding. */
  narrow?: boolean
  /** Drop this column below `lg`. Nine columns do not fit 368px and no amount
   *  of shrinking changes that, so each board keeps the numbers it is named
   *  for and folds or drops the rest. Measured: eight columns is the ceiling. */
  mobileHide?: boolean
  /** Drop this column below 390px only — a second, narrower threshold.
   *
   *  390 is the iPhone 13/14/15 width the mobile boards were measured and
   *  tuned against, and they fit it exactly. A Galaxy at 360 and an iPhone SE
   *  at 375 have 20–30px less, which is enough to shear the last column in
   *  half: Goalkeepers lost `Prev` down to a leading `0`, Form lost `xGI Δ`
   *  down to a sliver. Hiding one column outright on those screens is better
   *  than cutting one in half, and this keeps 390 untouched. */
  tightHide?: boolean
  /** Shorter header below `lg`, where the full one would set the column width. */
  mobileHeader?: ReactNode
  /** Different cell below `lg` — a plain number where the wide table draws a
   *  bar, thousands where it prints six figures. */
  mobileCell?: (row: T) => ReactNode
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  /** Initial sort column key; defaults to the first sortable column. */
  initialSort?: string
  initialDir?: 'asc' | 'desc'
  rowKey: (row: T, i: number) => string | number
  onRowClick?: (row: T) => void
  /** Subtly emphasise the top row of the current sort (leader accent). */
  featured?: boolean
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

export function SortableTable<T>({ rows, columns: allColumns, initialSort, initialDir = 'desc', rowKey, onRowClick, featured }: Props<T>) {
  // Below lg the board drops the columns it can live without and shortens the
  // ones it keeps. The sort state still refers to columns by key, so a column
  // that is hidden on a phone simply stops being reachable rather than
  // breaking the sort.
  const wide = useWide()
  // Narrower than the 390px the boards were tuned to — see `tightHide`.
  const tight = !useWide(390)
  const columns = useMemo(
    () => (wide ? allColumns : allColumns.filter((c) => !c.mobileHide && !(tight && c.tightHide))),
    [allColumns, wide, tight],
  )
  const firstSortable = columns.find((c) => c.sortValue)?.key
  const [sortCol, setSortCol] = useState<string | undefined>(initialSort ?? firstSortable)
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir)

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortCol)
    if (!col?.sortValue) return rows
    const getVal = col.sortValue
    const factor = dir === 'asc' ? 1 : -1
    // Nulls/N-A always sink to the bottom regardless of direction (legacy parity).
    return [...rows].sort((a, b) => {
      const va = getVal(a)
      const vb = getVal(b)
      const na = va == null || va === '' || (typeof va === 'number' && isNaN(va))
      const nb = vb == null || vb === '' || (typeof vb === 'number' && isNaN(vb))
      if (na && nb) return 0
      if (na) return 1
      if (nb) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor
      return String(va).localeCompare(String(vb)) * factor
    })
  }, [rows, columns, sortCol, dir])

  const onHeaderClick = (col: Column<T>) => {
    if (!col.sortValue) return
    if (sortCol === col.key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col.key)
      setDir('desc')
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface-1/40">
      <table className="w-full border-collapse text-[12px] lg:text-sm">
        <thead>
          <tr className="border-b border-line-mid">
            {columns.map((col, i) => {
              const isSticky = col.sticky ?? i === 0
              const active = sortCol === col.key
              return (
                <th
                  key={col.key}
                  onClick={() => onHeaderClick(col)}
                  className={`${col.narrow ? 'px-1' : 'px-1 lg:px-2.5'} py-2.5 text-[9px] font-extrabold tracking-[0.06em] whitespace-nowrap text-ink-3 uppercase lg:px-4 lg:py-3.5 lg:text-[11px] lg:tracking-[0.1em] ${alignClass[col.align ?? (i === 0 ? 'left' : 'right')]} ${
                    col.sortValue ? 'cursor-pointer select-none hover:text-ink-2' : ''
                  } ${isSticky ? 'sticky left-0 z-10 bg-surface-1' : ''}`}
                >
                  <span
                    className={`inline-flex min-h-6 items-center gap-1 ${
                      (col.align ?? (i === 0 ? 'left' : 'right')) === 'right' ? 'flex-row-reverse' : ''
                    }`}
                  >
                    {(!wide && col.mobileHeader) || col.header}
                    {col.tip && <span className={col.narrow ? 'hidden md:inline-flex' : 'hidden lg:inline-flex'}><InfoTip text={col.tip} /></span>}
                    {active && <span className="text-accent">{dir === 'asc' ? '▲' : '▼'}</span>}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, ri) => {
            const isLeader = featured && ri === 0
            return (
              <tr
                key={rowKey(row, ri)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-line last:border-0 ${isLeader ? 'bg-accent-selected' : ''} ${
                  onRowClick ? 'cursor-pointer transition-colors hover:bg-surface-2/70' : ''
                }`}
              >
                {columns.map((col, i) => {
                  const isSticky = col.sticky ?? i === 0
                  return (
                    <td
                      key={col.key}
                      className={`${col.narrow ? 'px-1' : 'px-1 lg:px-2.5'} py-2 lg:py-4 lg:px-4 ${alignClass[col.align ?? (i === 0 ? 'left' : 'right')]} ${
                        isSticky ? 'sticky left-0 z-10 bg-bg-0' : ''
                      } ${isLeader && i === 0 ? 'shadow-[inset_2px_0_0_var(--accent)]' : ''}`}
                    >
                      {!wide && col.mobileCell ? col.mobileCell(row) : col.cell(row)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
