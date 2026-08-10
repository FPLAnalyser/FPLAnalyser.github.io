import type { ReactNode } from 'react'

export interface TabDef {
  id: string
  label: string
  icon?: ReactNode
}

/**
 * Horizontal, scrollable tab bar with a CSS-only active underline. The
 * `layoutId` prop is accepted for call-site compatibility but no longer drives
 * an animation — the indicator must render without any animation engine, which
 * fails silently on some Safari/WebKit builds and left routes blank.
 */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[]
  active: string
  onChange: (id: string) => void
  layoutId?: string
}) {
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
            /* The active label takes the ink colour, not the accent: white on
               dark, near-black on light. Gold text on a dark surface is dimmer
               than the inactive labels beside it, so the selected tab was the
               hardest one to read. The gold underline still marks it — the
               colour moves to the indicator, where it costs no legibility. */
            className={`relative flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm whitespace-nowrap transition-colors ${
              isActive ? 'font-semibold text-ink' : 'font-medium text-ink-2 hover:text-ink'
            }`}
          >
            {tab.icon}
            {tab.label}
            {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
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
                ? 'border-accent bg-accent-selected text-accent'
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
