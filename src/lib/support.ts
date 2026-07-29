/* Tip jar.
 *
 * Set VITE_SUPPORT_URL at build time (a Ko-fi or Buy Me a Coffee page) and the
 * link appears; leave it unset and nothing renders, so the site never ships a
 * dead "support us" link.
 *
 * DELIBERATELY A LINK, NOT A WIDGET. Embedding Ko-fi's or BMC's script would
 * put a third-party tracker on every page, which drags in PECR consent and a
 * cookie banner — for a button. A plain outbound link sends nothing until
 * somebody chooses to click it, so the privacy notice stays as short as it is.
 */

const URL_ = (import.meta.env.VITE_SUPPORT_URL as string | undefined)?.trim()

export const SUPPORT_URL: string | null = URL_ && /^https:\/\//.test(URL_) ? URL_ : null

/** Shown next to the link. Kept plain — a tip jar that begs reads as a paywall
 *  in waiting, which is the opposite of the point while the site is free. */
export const SUPPORT_LABEL = 'Buy me a coffee'
