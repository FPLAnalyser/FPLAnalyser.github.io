import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type Accent = 'aurum' | 'frost' | 'verdant'
export type Mode = 'light' | 'dark'

export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'aurum', label: 'Aurum', swatch: '#d9b45c' },
  { id: 'frost', label: 'Frost', swatch: '#7fb0ff' },
  { id: 'verdant', label: 'Verdant', swatch: '#3ea87a' },
]

const ACCENT_KEY = 'fpl_accent'
const MODE_KEY = 'fpl_mode'
const DEFAULT_ACCENT: Accent = 'aurum'

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v && (allowed as readonly string[]).includes(v)) return v as T
  } catch {
    /* private mode */
  }
  return fallback
}

/** Resolve the initial mode: stored choice, else the OS preference. */
function initialMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

interface ThemeState {
  accent: Accent
  mode: Mode
  setAccent: (a: Accent) => void
  setMode: (m: Mode) => void
  toggleMode: () => void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<Accent>(() => readStored(ACCENT_KEY, ['aurum', 'frost', 'verdant'], DEFAULT_ACCENT))
  const [mode, setModeState] = useState<Mode>(initialMode)

  // Reflect state onto <html> so the CSS token layer applies, and persist it.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.accent = accent
    root.dataset.mode = mode
    // Keep the browser UI chrome (address bar) in step with the surface.
    const theme = mode === 'dark' ? '#0c0b09' : '#f6f4ef'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme)
  }, [accent, mode])

  const setAccent = useCallback((a: Accent) => {
    setAccentState(a)
    try { localStorage.setItem(ACCENT_KEY, a) } catch { /* ignore */ }
  }, [])

  const setMode = useCallback((m: Mode) => {
    setModeState(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }, [])

  const toggleMode = useCallback(() => setMode(mode === 'dark' ? 'light' : 'dark'), [mode, setMode])

  return (
    <ThemeContext.Provider value={{ accent, mode, setAccent, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
