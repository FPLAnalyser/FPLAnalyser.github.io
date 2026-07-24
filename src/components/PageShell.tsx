import type { ReactNode } from 'react'

export function PageShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-6 md:py-8">{children}</div>
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-7">
      <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-ink md:text-4xl">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-ink-2 md:text-[15px]">{subtitle}</p>}
    </header>
  )
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-mid bg-surface-1/50 px-6 py-16 text-center text-ink-2">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div>{children}</div>
    </div>
  )
}
