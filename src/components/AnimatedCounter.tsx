import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'framer-motion'

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
 * Counts up from 0 to `value` when scrolled into view (fx.js animateCounters
 * equivalent). Renders the final value immediately under reduced motion.
 */
export function AnimatedCounter({ value, format = 'int', prefix = '', suffix = '', className, style, duration = 650 }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced ? value : 0)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }
    if (!inView) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      setDisplay(value * easeOutCubic(t))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, value, reduced, duration])

  return (
    <span ref={ref} className={className} style={style}>
      {prefix}
      {isNaN(value) ? '—' : fmt(display, format)}
      {suffix}
    </span>
  )
}
