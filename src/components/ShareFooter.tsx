// Brand watermark baked into every shared/downloaded image — each share is a
// tiny bit of marketing. Update SHARE_URL to the App Store / custom domain once
// live.
export const SHARE_URL = 'fpl-analyser'

export function ShareFooter() {
  return (
    <div className="mt-2 flex items-center justify-center gap-1.5 rounded-b-2xl bg-[#0c0b09] py-2 text-[11px]">
      <span className="font-display font-bold tracking-tight text-ink">FPL <span className="text-accent">Analyser</span></span>
      <span className="text-ink-3">· rate your team</span>
    </div>
  )
}
