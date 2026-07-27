import { BRAND, X_HANDLE, IG_HANDLE, X_MARK_PATH } from '../lib/social'
import { BrandMark } from './BrandMark'

// Brand watermark baked into every shared/downloaded image — each share is a
// tiny bit of marketing. Update SHARE_URL to the App Store / custom domain once
// live.
export const SHARE_URL = 'fpl-analyser'

/** The X mark and the Instagram glyph, drawn inline so the rasteriser has no
 *  external file to fetch and nothing to fail on. */
function XMark({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d={X_MARK_PATH} />
    </svg>
  )
}

function InstagramMark({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true" className="shrink-0">
      <rect x="2.2" y="2.2" width="19.6" height="19.6" rx="5.6" />
      <circle cx="12" cy="12" r="4.9" />
      <circle cx="17.6" cy="6.4" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Brand on the left, both accounts on the right. Both, always: whoever
 *  reposts the picture may be on either network, and the image has to answer
 *  "who made this and where do I find more" on its own. */
export function ShareFooter() {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-b-2xl bg-[#0c0b09] px-3 py-3">
      <span className="flex items-center gap-2">
        <BrandMark size={26} />
        <span className="capture-line font-brand text-[17px] font-semibold tracking-[0.06em] text-white">
          FPL <span style={{ color: '#c9a227' }}>Analyser</span>
        </span>
      </span>
      {/* capture-line, because the rasteriser sets text lower in a tight line
          box than the browser does — without it the handle sits below its
          icon instead of beside it. */}
      <span className="capture-line flex items-center gap-1.5 text-[15px] font-bold text-white">
        <XMark size={17} /> {X_HANDLE}
      </span>
      <span className="capture-line flex items-center gap-1.5 text-[15px] font-bold text-white">
        <InstagramMark size={17} /> {IG_HANDLE}
      </span>
    </div>
  )
}

export { BRAND }
