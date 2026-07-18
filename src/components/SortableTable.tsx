import { useMemo, useState, type ReactNode } from 'react'
import { InfoTip } from './InfoTip'

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

export function SortableTable<T>({ rows, columns, initialSort, initialDir = 'desc', rowKey, onRowClick, featured }: Props<T>) {
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
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-mid">
            {columns.map((col, i) => {
              const isSticky = col.sticky ?? i === 0
              const active = sortCol === col.key
              return (
                <th
                  key={col.key}
                  onClick={() => onHeaderClick(col)}
                  className={`px-4 py-3.5 text-[11px] font-semibold tracking-[0.1em] whitespace-nowrap text-ink-3 uppercase ${alignClass[col.align ?? (i === 0 ? 'left' : 'right')]} ${
                    col.sortValue ? 'cursor-pointer select-none hover:text-ink-2' : ''
                  } ${isSticky ? 'sticky left-0 z-10 bg-surface-1' : ''}`}
                >
                  <span
                    className={`inline-flex min-h-6 items-center gap-1 ${
                      (col.align ?? (i === 0 ? 'left' : 'right')) === 'right' ? 'flex-row-reverse' : ''
                    }`}
                  >
                    {col.header}
                    {col.tip && <InfoTip text={col.tip} />}
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
                className={`border-b border-line last:border-0 ${isLeader ? 'bg-accent-soft' : ''} ${
                  onRowClick ? 'cursor-pointer transition-colors hover:bg-surface-2/70' : ''
                }`}
              >
                {columns.map((col, i) => {
                  const isSticky = col.sticky ?? i === 0
                  return (
                    <td
                      key={col.key}
                      className={`px-4 py-4 ${alignClass[col.align ?? (i === 0 ? 'left' : 'right')]} ${
                        isSticky ? 'sticky left-0 z-10 bg-bg-0' : ''
                      } ${isLeader && i === 0 ? 'shadow-[inset_2px_0_0_var(--accent)]' : ''}`}
                    >
                      {col.cell(row)}
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
