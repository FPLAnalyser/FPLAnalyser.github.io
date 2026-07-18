import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { norm } from '../lib/util'

interface Props<T> {
  items: T[]
  getLabel: (item: T) => string
  renderItem?: (item: T) => ReactNode
  onSelect: (item: T) => void
  placeholder?: string
  limit?: number
  initialValue?: string
  /** Clear the input after a selection (for multi-select pickers). */
  clearOnSelect?: boolean
}

/** Accent-insensitive live-search input with a results dropdown (mouse + touch). */
export function SearchBox<T>({ items, getLabel, renderItem, onSelect, placeholder = 'Search…', limit = 8, initialValue = '', clearOnSelect = false }: Props<T>) {
  const [q, setQ] = useState(initialValue)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => setQ(initialValue), [initialValue])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const matches = useMemo(() => {
    const nq = norm(q.trim())
    if (!nq) return []
    return items.filter((it) => norm(getLabel(it)).includes(nq)).slice(0, limit)
  }, [q, items, getLabel, limit])

  const pick = (item: T) => {
    onSelect(item)
    setQ(clearOnSelect ? '' : getLabel(item))
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative max-w-md">
      <div className="flex items-center gap-2 rounded-lg border border-line-mid bg-surface-1 px-3">
        <span className="text-ink-3">
          <Icon name="search" size={16} />
        </span>
        <input
          type="text"
          value={q}
          placeholder={placeholder}
          autoComplete="off"
          className="min-h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || !matches.length) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-lg border border-line-mid bg-surface-2 shadow-float">
          {matches.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => pick(it)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                i === active ? 'bg-surface-3 text-ink' : 'text-ink-2'
              }`}
            >
              {renderItem ? renderItem(it) : getLabel(it)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
