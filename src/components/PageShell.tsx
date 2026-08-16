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
  return (
    <div className="mx-auto w-full max-w-[1500px] px-2.5 pt-2 pb-6 sm:px-4 md:px-6 md:pt-3 md:pb-8">
      {/* WHOSE NUMBERS IS THIS PAGE SHOWING — above the page, at every width.
          Two homes were tried and both were wrong. In the section banner it sat
          on a photograph with nothing behind it, so the one control that says
          "these are not the site's numbers" was the hardest thing on the page
          to see. In the header it cost 208px of a row that had none to give:
          at 1440 it clipped My Team and pushed Review off the nav entirely, and
          at 320 it ran the page 27px past the viewport.
          Here it has its own line, the same place on every route, and it draws
          nothing at all until a club has been re-rated. */}
      <div className="mb-1.5 flex justify-end md:mb-2">
        <RatingsSwitch />
      </div>
      {children}
    </div>
  )
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
