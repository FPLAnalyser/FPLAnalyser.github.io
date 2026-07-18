import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

export interface TabDef {
  id: string
  label: string
  icon?: ReactNode
}

/** Horizontal, scrollable tab bar with an animated active underline. */
export function Tabs({
  tabs,
  active,
  onChange,
  layoutId = 'tab-underline',
}: {
  tabs: TabDef[]
  active: string
  onChange: (id: string) => void
  layoutId?: string
}) {
  const reduced = useReducedMotion()
  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`relative flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap transition-colors ${
              isActive ? 'text-accent' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {tab.icon}
            {tab.label}
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Pill-style filter buttons (position filters etc.). */
export function PillGroup({
  options,
  active,
  onChange,
}: {
  options: { id: string; label: string }[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = opt.id === active
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
              isActive
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
