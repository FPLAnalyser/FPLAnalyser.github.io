import { useRef, useState, type ReactNode } from 'react'
import { isNative, tapHaptic } from '../lib/native'

/**
 * Native pull-to-refresh. On the web it's a passthrough (browsers own their own
 * overscroll); inside the Capacitor app, dragging down at the top of the page
 * past a threshold purges the cached data and reloads — and since native fetches
 * the published site_data first, the reload comes back with fresh ratings.
 */
const THRESHOLD = 72

export function PullToRefresh({ children }: { children: ReactNode }) {
  const native = isNative()
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const armed = useRef(false)

  if (!native) return <>{children}</>

  const onStart = (e: React.TouchEvent) => {
    if (refreshing) return
    // Only arm when the page is scrolled to the very top.
    if (window.scrollY <= 0) { startY.current = e.touches[0].clientY; armed.current = true }
    else { startY.current = null; armed.current = false }
  }
  const onMove = (e: React.TouchEvent) => {
    if (!armed.current || startY.current == null || refreshing) return
    const dy = e.touches[0].clientY - startY.current
    if (dy > 0) setPull(Math.min(dy * 0.5, 110))
  }
  const onEnd = async () => {
    if (!armed.current || refreshing) { setPull(0); return }
    armed.current = false
    startY.current = null
    if (pull < THRESHOLD) { setPull(0); return }
    setRefreshing(true)
    setPull(THRESHOLD)
    tapHaptic('medium')
    try {
      if (window.caches) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch { /* best effort */ }
    location.reload()
  }

  const shown = refreshing ? THRESHOLD : pull
  const ready = pull >= THRESHOLD

  return (
    <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
      <div
        className="flex items-center justify-center overflow-hidden text-ink-3"
        style={{ height: shown, transition: refreshing || shown === 0 ? 'height 0.2s ease' : 'none' }}
        aria-hidden={shown === 0}
      >
        <span className="flex items-center gap-2 text-xs font-medium">
          <span
            className={`inline-block size-4 rounded-full border-2 border-line-mid border-t-accent ${refreshing ? 'animate-spin' : ''}`}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          />
          {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
        </span>
      </div>
      {children}
    </div>
  )
}
