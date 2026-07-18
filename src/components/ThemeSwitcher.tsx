import { useState, useRef, useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ACCENTS, useTheme } from '../lib/theme'
import { Icon } from './Icon'

/** Compact theme control: light/dark toggle + an accent-colour picker. */
export function ThemeSwitcher() {
  const { accent, mode, setAccent, toggleMode } = useTheme()
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [open])

  const current = ACCENTS.find((a) => a.id === accent)!

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggleMode}
        aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-2 transition-colors hover:text-ink"
      >
        <Icon name={mode === 'dark' ? 'moon' : 'sun'} size={16} />
      </button>

      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Choose accent colour"
          aria-expanded={open}
          title={`Theme: ${current.label}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md transition-colors hover:bg-surface-2"
        >
          <span
            className="size-4 rounded-full ring-1 ring-line-mid ring-offset-2 ring-offset-transparent"
            style={{ background: current.swatch }}
          />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? undefined : { opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              className="absolute right-0 top-full z-[150] mt-2 w-44 rounded-lg border border-line-mid bg-surface-2 p-1.5 shadow-float"
            >
              <div className="px-2 py-1 text-[10px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Accent</div>
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setAccent(a.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-surface-3 ${
                    a.id === accent ? 'text-ink' : 'text-ink-2'
                  }`}
                >
                  <span className="size-3.5 rounded-full ring-1 ring-line-mid" style={{ background: a.swatch }} />
                  {a.label}
                  {a.id === accent && (
                    <span className="ml-auto text-accent">
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
