import { useEffect, useRef, useState } from 'react'

// One-time animated intro: a floodlit-turf lockup that reveals the wordmark
// "FPL ANALYSER" letter-by-letter, draws the tagline, wipes out with a light
// streak, then unmounts to reveal the app behind it.
//
// Plays once per browser session (sessionStorage). Tap/click/Esc skips it, and
// prefers-reduced-motion users never see it — the app is already mounted below.

const SESSION_KEY = 'fpl_intro_seen'
const TITLE = 'FPL ANALYSER'
const GOLD_UP_TO = 3 // "FPL" renders in gold
const TOTAL_MS = 4200 // scene fade completes ~4.1s; unmount just after

function shouldPlay(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false
  } catch {
    /* private mode — just play */
  }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return !reduced
}

export function IntroSplash() {
  // Decide synchronously on first render so the app never flashes then covers.
  const [show, setShow] = useState(shouldPlay)
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (!show) return
    try {
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      /* ignore */
    }
    const end = window.setTimeout(() => setShow(false), TOTAL_MS)
    timers.current.push(end)
    return () => timers.current.forEach(clearTimeout)
  }, [show])

  useEffect(() => {
    if (!show) return
    const skip = () => {
      setLeaving(true)
      const t = window.setTimeout(() => setShow(false), 420)
      timers.current.push(t)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show])

  if (!show) return null

  const skip = () => {
    setLeaving(true)
    const t = window.setTimeout(() => setShow(false), 420)
    timers.current.push(t)
  }

  return (
    <div
      className={`intro-scene${leaving ? ' intro-leaving' : ''}`}
      onClick={skip}
      role="presentation"
      aria-label="FPL Analyser"
    >
      <svg className="intro-marks" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <line x1="500" y1="0" x2="500" y2="620" />
        <circle cx="500" cy="310" r="128" />
        <circle cx="500" cy="310" r="3.4" fill="rgba(233,240,228,.35)" />
        <rect x="-60" y="150" width="200" height="320" />
        <rect x="-60" y="230" width="90" height="160" />
        <rect x="860" y="150" width="200" height="320" />
        <rect x="970" y="230" width="90" height="160" />
        <path d="M140 250 A88 88 0 0 1 140 370 M860 250 A88 88 0 0 0 860 370" />
      </svg>

      <div className="intro-lock">
        <div className="intro-title" aria-hidden="true">
          {[...TITLE].map((ch, i) => (
            <span
              key={i}
              className={i < GOLD_UP_TO ? 'intro-gold' : undefined}
              style={{ animationDelay: `${0.25 + i * 0.085}s` }}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </div>
        <div className="intro-tagwrap">
          <div className="intro-rule intro-rule-l" />
          <div className="intro-tag">
            Data. <b>Insight.</b> Points.
          </div>
          <div className="intro-rule intro-rule-r" />
        </div>
      </div>

      <div className="intro-streak" aria-hidden="true" />
    </div>
  )
}
