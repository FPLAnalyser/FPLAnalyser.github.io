export function Skeleton({ className }: { className?: string }) {
  return <div className={className ? `skel ${className}` : 'skel'} />
}

export function SkeletonBlock() {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-1/50 p-5">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </div>
  )
}

export function PageSkeleton({ error }: { error?: unknown } = {}) {
  // A failed core load must be VISIBLE with a retry — a skeleton that shimmers
  // forever reads as "the site is broken" with no way out.
  if (error) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
        <div className="rounded-xl border border-bad/30 bg-bad/5 px-6 py-10 text-center">
          <div className="mb-1 font-semibold text-ink">The data didn't load</div>
          <div className="mb-4 text-sm text-ink-2">Your connection may have dropped mid-download.</div>
          <button
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-lg bg-accent px-5 font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
          >
            Try again
          </button>
          <div className="mt-4 text-xs text-ink-3">
            Still stuck? Open <a className="underline" href="#/debug">the diagnostics page</a> and send a screenshot.
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <Skeleton className="mb-3 h-7 w-48" />
      <Skeleton className="mb-8 h-4 w-72" />
      <div className="space-y-3 rounded-lg border border-line bg-surface-1 p-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    </div>
  )
}
