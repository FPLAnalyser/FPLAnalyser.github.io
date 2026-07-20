import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

// A dynamic-import failure after a redeploy (old cached shell → chunk 404) is
// recoverable by fetching a fresh index.html once.
function isChunkLoadError(e: Error): boolean {
  return /Loading chunk|Failed to fetch dynamically imported|Importing a module script failed|dynamically imported module/i.test(
    `${e.name} ${e.message}`,
  )
}

/**
 * Catches any render/runtime error in a route so it becomes a VISIBLE message
 * with a reload button — never a silently blank page. The error is also pushed
 * to window.__errlog so the #/debug page shows exactly what threw, on any
 * browser. Chunk-load errors (stale cached shell after a deploy) trigger a
 * one-time automatic hard reload to pull the current build.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    try {
      const w = window as Window & { __errlog?: string[] }
      if (!w.__errlog) w.__errlog = []
      w.__errlog.push(`${new Date().toISOString().slice(11, 19)} [render] ${error.name}: ${error.message}`)
    } catch {
      /* ignore */
    }
    // Stale-deploy recovery: reload once to fetch the current index.html/chunks.
    if (isChunkLoadError(error)) {
      try {
        const KEY = 'fpl_chunk_reload'
        if (!sessionStorage.getItem(KEY)) {
          sessionStorage.setItem(KEY, '1')
          window.location.reload()
        }
      } catch {
        /* ignore */
      }
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const chunk = isChunkLoadError(error)
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6">
        <div className="rounded-xl border border-bad/30 bg-bad/5 px-6 py-8 text-center">
          <div className="mb-1 text-lg font-semibold text-ink">{chunk ? 'A newer version is available' : 'This page hit an error'}</div>
          <div className="mb-4 text-sm text-ink-2">
            {chunk
              ? 'Your browser is holding an old copy of the app. Reload to get the current version.'
              : 'Something went wrong rendering this page. Reloading usually clears it.'}
          </div>
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem('fpl_chunk_reload')
              } catch {
                /* ignore */
              }
              window.location.reload()
            }}
            className="min-h-11 rounded-lg bg-accent px-5 font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
          >
            Reload the app
          </button>
          <div className="mt-4 text-xs break-all text-ink-3">
            <a className="underline" href="#/debug">
              Open diagnostics
            </a>{' '}
            · {error.name}: {error.message}
          </div>
        </div>
      </div>
    )
  }
}
