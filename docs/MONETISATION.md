# Monetisation

**Deliberately off right now.** `src/lib/premium.ts` has `PREMIUM_ENABLED =
false`, so every feature is unlocked for everyone. The plan is to grow the weekly
habit for a full season, then charge — turning it on is a one-line flip plus a
store hookup.

## Model (when you switch it on)
Freemium, **season-pass priced** (matches how FPL managers think, and undercuts
Fantasy Football Scout ~£25/season):

- **Free forever:** ratings, fixtures, squad builder, deadline alerts. Must stay
  genuinely useful or reviews suffer.
- **Premium (~£14.99 / season):** price & injury alerts for an unlimited
  watchlist, the full My Team report (captain / transfers / risk), advanced
  rotation & chip planning, ad-free.

## Wiring it up
1. Set `PREMIUM_ENABLED = true` in `src/lib/premium.ts`.
2. Add [RevenueCat](https://www.revenuecat.com/) (`@capacitor-community/purchases`
   or the RevenueCat Capacitor plugin) — it wraps StoreKit + Play Billing and
   handles receipts/restore. Create the products in App Store Connect and the
   Play Console.
3. Point `isPremium()` at the RevenueCat entitlement, and `startPurchase()` in
   `src/components/Paywall.tsx` at `Purchases.purchasePackage(...)`.
4. Wrap premium features in `<PremiumGate feature="…">` (already built) — while
   disabled it passes through, so you can place the gates now and they only bite
   once the switch is on.

## What's already scaffolded
- `src/lib/premium.ts` — entitlement flag, feature list, `canUse()` gate.
- `src/components/Paywall.tsx` — `<PremiumGate>` wrapper + the paywall sheet.

## Don't
- Don't gate the core loop (ratings, deadline alerts). Paywalling the habit kills
  retention before you've built it.
- Don't launch payments in year one. Grow first.
