import { useState, type ReactNode } from 'react'
import { canUse, isPremium, PREMIUM_PITCH, type PremiumFeature } from '../lib/premium'
import { Icon } from './Icon'

// Paywall UI scaffold. While monetisation is off (premium.ts → PREMIUM_ENABLED
// = false) `canUse` is always true, so gates pass through and this never shows.
// When you switch it on, wrap premium features in <PremiumGate> and hook up
// `startPurchase` to the store SDK.

export function PremiumGate({ feature, children }: { feature: PremiumFeature; children: ReactNode }) {
  const [showPaywall, setShowPaywall] = useState(false)
  if (canUse(feature)) return <>{children}</>
  return (
    <>
      <button onClick={() => setShowPaywall(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent-soft/40 px-4 py-6 text-sm font-semibold text-accent">
        <Icon name="crown" size={16} /> {PREMIUM_PITCH[feature]} — Unlock Premium
      </button>
      <Paywall open={showPaywall} onClose={() => setShowPaywall(false)} highlight={feature} />
    </>
  )
}

export function Paywall({ open, onClose, highlight }: { open: boolean; onClose: () => void; highlight?: PremiumFeature }) {
  const [busy, setBusy] = useState(false)
  if (!open) return null

  const startPurchase = async () => {
    setBusy(true)
    // TODO: wire to RevenueCat / StoreKit / Play Billing (see docs/MONETISATION.md).
    setBusy(false)
    onClose()
  }

  const features = Object.entries(PREMIUM_PITCH) as [PremiumFeature, string][]
  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-[380px] rounded-2xl border border-line bg-surface-1 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 text-accent"><Icon name="crown" size={20} /><span className="font-display text-lg font-bold text-ink">FPL Analyser Premium</span></div>
        <p className="mb-4 text-sm text-ink-2">Everything free, plus the tools that win your mini-league.</p>
        <ul className="mb-5 flex flex-col gap-2">
          {features.map(([k, label]) => (
            <li key={k} className={`flex items-center gap-2 text-sm ${k === highlight ? 'font-semibold text-ink' : 'text-ink-2'}`}>
              <span className="text-good"><Icon name="check" size={15} /></span>{label}
            </li>
          ))}
        </ul>
        <button onClick={startPurchase} disabled={busy} className="min-h-11 w-full rounded-xl bg-accent font-semibold text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-60">
          {busy ? '…' : 'Go Premium · £14.99 / season'}
        </button>
        <button onClick={onClose} className="mt-2 w-full text-center text-sm font-medium text-ink-3">Maybe later</button>
        {isPremium() && <p className="mt-2 text-center text-[11px] text-ink-3">Premium is currently free for everyone.</p>}
      </div>
    </div>
  )
}
