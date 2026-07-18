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

export function PageSkeleton() {
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
