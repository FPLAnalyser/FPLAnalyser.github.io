import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type Accent = 'aurum' | 'frost' | 'verdant'
export type Mode = 'light' | 'dark'

const ALL_ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'aurum', label: 'Aurum', swatch: '#d9b45c' },
  { id: 'frost', label: 'Frost', swatch: '#7fb0ff' },
  { id: 'verdant', label: 'Verdant', swatch: '#3ea87a' },
]

/** The accents a visitor can actually pick.
 *
 *  Gold is the brand: it is what every share image, the wordmark and the
 *  screenshots are in, so letting a visitor turn the site blue makes the
 *  product look unlike the thing that brought them to it. Frost and Verdant
 *  stay defined — the CSS token layer in index.css still carries them and
 *  nothing has been deleted — they are simply not offered.
 *
 *  Widen this array to bring them back; the picker reappears on its own. */
export const ACCENTS = ALL_ACCENTS.filter((a) => a.id === 'aurum')

const ACCENT_IDS = ACCENTS.map((a) => a.id)

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

/** Resolve the initial mode: the visitor's stored choice, else dark.
 *
 *  The OS preference is deliberately ignored. It is the usual default and it
 *  is the wrong one here: the site is designed in dark, every share image and
 *  screenshot that brings somebody to it is in dark, and a first impression
 *  that does not look like the thing they clicked is a worse outcome than
 *  overriding a system setting they can undo in one tap.
 *
 *  Once they do tap, the stored choice wins forever — this only decides what
 *  a first-time visitor sees.
 *
 *  Kept in step with the pre-paint script in index.html; changing one without
 *  the other produces a flash of the wrong theme on every cold load. */
function initialMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* private mode */
  }
  return 'dark'
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
  // Checked against the *visible* accents, not every accent that exists: a
  // returning visitor who picked Frost before it was withdrawn would otherwise
  // stay on it with no control left to change it back.
  const [accent, setAccentState] = useState<Accent>(() => readStored(ACCENT_KEY, ACCENT_IDS, DEFAULT_ACCENT))
  const [mode, setModeState] = useState<Mode>(initialMode)

  // Reflect state onto <html> so the CSS token layer applies, and persist it.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.accent = accent
    root.dataset.mode = mode
    // Keep the browser UI chrome (address bar) in step with the surface.
    const theme = mode === 'dark' ? '#0a0b0e' : '#f6f4ef'
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
