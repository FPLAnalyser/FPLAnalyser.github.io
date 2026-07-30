/* ════════════════════════════════════════════════════════════════════════
   Handing a finished picture to the person who asked for it.

   Three places used to do this, in three slightly different ways, and all
   three carried the same bug: `navigator.share()` REJECTS when the reader
   dismisses the share sheet. That is not a failure — it is somebody deciding
   not to send a picture, which is a thing people do — and it arrived in a
   `catch` that said "could not render the image on this device". So closing
   the sheet on a phone produced an error message about rendering, next to an
   image that had rendered perfectly.

   One copy, and it distinguishes the three outcomes properly.
   ════════════════════════════════════════════════════════════════════════ */

import { shareImageNative } from './native'

export type Delivery =
  /** Handed to the OS share sheet, or to the native app's. */
  | 'shared'
  /** No share sheet here, so it went to the downloads folder instead. */
  | 'saved'
  /** The reader opened the sheet and closed it again. Say nothing. */
  | 'cancelled'

/** True for the rejection a share sheet throws when it is dismissed.
 *
 *  `AbortError` is the specification's answer. Some browsers have historically
 *  sent a bare "Abort due to cancellation of share" instead, so the message is
 *  checked too rather than trusting the name alone. */
function isDismissal(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  if (name === 'AbortError' || name === 'NotAllowedError') return true
  return /abort|cancel/i.test(String((e as { message?: string } | null)?.message ?? ''))
}

/** Share the image if the device can, save it if it cannot.
 *
 *  Throws only when something has genuinely gone wrong — a caller can treat a
 *  throw as "tell them it failed" without having to work out whether the
 *  reader simply changed their mind. */
export async function deliverImage(blob: Blob, filename: string, title: string): Promise<Delivery> {
  // Native: straight to the OS sheet through Capacitor.
  if (await shareImageNative(blob, filename, title)) return 'shared'

  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (isDismissal(e)) return 'cancelled'
      // A real share failure still leaves us holding a good picture, so fall
      // through and save it rather than losing the render.
    }
  }

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  return 'saved'
}
