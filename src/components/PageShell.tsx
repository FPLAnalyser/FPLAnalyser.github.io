import { RatingsSwitch } from './RatingsSwitch'
import type { ReactNode } from 'react'

export function PageShell({ children }: { children: ReactNode }) {
  // Content caps well short of the nav's full width: past ~1500px the
  // components inside stop growing and the page just gains empty margins.
  // The phone gutter is deliberately tight — the pitch is the widest thing
  // on the site and every pixel of it is a legible player card.
  // Asymmetric on purpose: the banner sits right at the top of every page and
  // wants to be near the chrome, but the last card on a long page still needs
  // room to breathe above the mobile nav bar. A single py- gave the banner the
  // same generous gap as the page footer, which is the wrong trade.
  return <div className="mx-auto w-full max-w-[1500px] px-2.5 pt-2 pb-6 sm:px-4 md:px-6 md:pt-3 md:pb-8">{children}</div>
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-ink md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-2 md:text-[15px]">{subtitle}</p>}
      </div>
      {/* Same reasoning as the banner's copy: every page whose numbers move
          says which numbers they are, and it draws nothing until a club has
          been re-rated. */}
      <RatingsSwitch className="mt-1 shrink-0" />
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
