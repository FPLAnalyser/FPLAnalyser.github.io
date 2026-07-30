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

import { shareImageNative, isNative } from './native'

export type Delivery =
  /** Handed to the OS share sheet, or to the native app's. */
  | 'shared'
  /** No share sheet, or it refused, so the file was pushed as a download. */
  | 'saved'
  /** The reader opened the sheet and closed it again. Say nothing. */
  | 'cancelled'
  /** Nothing automatic worked. The caller must PUT THE PICTURE ON SCREEN so it
   *  can be long-pressed — the only route left on a locked-down iPhone, and the
   *  one people already know. Never leave this one silent. */
  | 'needs-longpress'

/** True only for the reader closing the sheet.
 *
 *  `AbortError` is the specification's answer, and some browsers have
 *  historically sent a bare "Abort due to cancellation of share" instead, so
 *  the message is checked too.
 *
 *  `NotAllowedError` is deliberately NOT here, and putting it here broke the
 *  squad export on iOS Safari: from `share()` it means "not triggered by user
 *  activation", which is what happens when a second or two of rasterising eats
 *  the gesture that started it. Treating that as a cancel meant saying nothing
 *  AND returning before the download fallback — so the button did nothing at
 *  all, which is the worst outcome available. */
function isDismissal(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  if (name === 'AbortError') return true
  if (name === 'NotAllowedError') return false
  return /abort|cancel/i.test(String((e as { message?: string } | null)?.message ?? ''))
}

/** Does this browser honour `<a download>`?
 *
 *  iOS Safari does not: it navigates to the blob instead, which on a share
 *  sheet failure would take the reader away from the page and lose their
 *  squad. Feature-detected rather than sniffed for the browser. */
function canDownload(): boolean {
  return 'download' in document.createElement('a') && !/iP(hone|ad|od)/.test(navigator.userAgent)
}

/** Share the image if the device can, save it if it can, and otherwise say so
 *  clearly enough that the caller can show the picture instead.
 *
 *  The one rule: never return without something having happened. A button that
 *  does nothing is worse than a button that fails out loud. */
export async function deliverImage(blob: Blob, filename: string, title: string): Promise<Delivery> {
  // Native: straight to the OS sheet through Capacitor.
  //
  // Guarded by the synchronous `isNative()` rather than just awaiting the
  // helper, because on the web that await would be the first thing between the
  // reader's tap and `navigator.share()`. iOS hands out a *transient* user
  // activation and spends it freely; the fewer turns of the event loop between
  // the tap and the share, the better.
  if (isNative() && (await shareImageNative(blob, filename, title))) return 'shared'

  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (isDismissal(e)) return 'cancelled'
      // A real share failure still leaves us holding a good picture, so carry
      // on rather than losing the render.
    }
  }

  if (!canDownload()) return 'needs-longpress'

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  return 'saved'
}
