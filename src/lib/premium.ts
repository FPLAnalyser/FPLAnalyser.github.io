// premium.ts — entitlement scaffold for a future freemium model.
//
// Deliberately OFF for now: the strategy is to grow the weekly habit for a
// season before charging, so `PREMIUM_ENABLED = false` means every feature is
// unlocked for everyone. When you're ready to monetise, flip the switch and wire
// `hasEntitlement()` to a real store (RevenueCat / StoreKit / Play Billing) —
// see docs/NOTIFICATIONS.md and docs/MONETISATION.md.

export const PREMIUM_ENABLED = false

// The features that WOULD sit behind premium once enabled (used for copy + the
// paywall; harmless while disabled).
export type PremiumFeature =
  | 'price-alerts'
  | 'unlimited-watchlist'
  | 'team-report'
  | 'rotation-planner'
  | 'ad-free'

export const PREMIUM_PITCH: Record<PremiumFeature, string> = {
  'price-alerts': 'Price-rise & fall alerts for your whole watchlist',
  'unlimited-watchlist': 'Track unlimited players',
  'team-report': 'Full team report — captain, transfers & risk',
  'rotation-planner': 'Advanced rotation & chip planning',
  'ad-free': 'No ads, ever',
}

const ENT_KEY = 'fpl_premium'

/** True when the user owns the premium entitlement (or when monetisation is off,
 *  so everything is free). Wire the store check into the flagged branch later. */
export function isPremium(): boolean {
  if (!PREMIUM_ENABLED) return true
  try { return localStorage.getItem(ENT_KEY) === '1' } catch { return false }
}

/** Gate helper: returns true when access is allowed (premium owned or disabled). */
export function canUse(_feature: PremiumFeature): boolean {
  return isPremium()
}

// Test/dev only — real entitlement will come from the store SDK.
export function setPremiumForTesting(on: boolean) {
  try { localStorage.setItem(ENT_KEY, on ? '1' : '0') } catch { /* ignore */ }
}
