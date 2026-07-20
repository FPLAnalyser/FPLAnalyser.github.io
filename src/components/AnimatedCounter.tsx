import { useEffect, useRef, useState } from 'react'

type CountFormat = 'int' | '1dp' | '2dp'

function fmt(n: number, format: CountFormat): string {
  switch (format) {
    case '1dp': return n.toFixed(1)
    case '2dp': return n.toFixed(2)
    default: return Math.round(n).toLocaleString('en-GB')
  }
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

interface Props {
  value: number
  format?: CountFormat
  prefix?: string
  suffix?: string
  className?: string
  style?: React.CSSProperties
  duration?: number
}

/**
 * Counts up to `value` when scrolled into view. Uses native IntersectionObserver
 * + matchMedia (no animation-library dependency in the render path) and ALWAYS
 * renders the real value if anything about the effect misbehaves — the number
 * must never be stuck at 0.
 */
export function AnimatedCounter({ value, format = 'int', prefix = '', suffix = '', className, style, duration = 650 }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setDisplay(value)
      return
    }

    let raf = 0
    let done = false
    const animate = () => {
      const start = performance.now()
      setDisplay(0)
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1)
        setDisplay(value * easeOutCubic(t))
        if (t < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    const el = ref.current
    if (!el) {
      setDisplay(value)
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !done) {
        done = true
        io.disconnect()
        animate()
      }
    }, { threshold: 0.4 })
    io.observe(el)

    // Fail-safe: if the observer never fires, show the real value anyway.
    const fallback = setTimeout(() => { if (!done) { done = true; io.disconnect(); setDisplay(value) } }, 1200)

    return () => { io.disconnect(); cancelAnimationFrame(raf); clearTimeout(fallback) }
  }, [value, duration])

  return (
    <span ref={ref} className={className} style={style}>
      {prefix}
      {isNaN(value) ? '—' : fmt(display, format)}
      {suffix}
    </span>
  )
}
