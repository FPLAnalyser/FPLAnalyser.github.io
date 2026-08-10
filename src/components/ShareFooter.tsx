import { BRAND, SITE_URL, X_HANDLE, IG_HANDLE, X_MARK_PATH } from '../lib/social'

// Brand watermark baked into every shared image — each share is a tiny bit of
// marketing.
//
// There used to be a SHARE_URL constant here holding 'fpl-analyser'. Nothing
// read it, and it went stale the moment the site moved — a dead string that
// still claimed to be the address. The footer carries the wordmark and both
// handles, which is what actually gets someone back here.

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
    <div className="mt-2 flex flex-col items-center gap-1 rounded-b-2xl bg-[#0a0b0e] px-3 py-3">
      {/* The name and the address on one line, because they are one thought:
          who made this, and where it lives. The address gets the same weight
          as the wordmark — it is the only thing here that turns a picture
          into a visit. */}
      <span className="flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-0.5">
        <span className="capture-line font-brand text-[17px] font-normal tracking-[0.08em] text-white">
          FPL <span style={{ color: '#c9a227' }}>Analyser</span>
        </span>
        <span className="capture-line text-[15px] font-bold tracking-[0.02em] text-white">{SITE_URL}</span>
      </span>
      {/* capture-line, because the rasteriser sets text lower in a tight line
          box than the browser does — without it the handle sits below its
          icon instead of beside it. */}
      <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span className="capture-line flex items-center gap-1.5 text-[14px] font-bold text-white/85">
          <XMark size={15} /> {X_HANDLE}
        </span>
        <span className="capture-line flex items-center gap-1.5 text-[14px] font-bold text-white/85">
          <InstagramMark size={15} /> {IG_HANDLE}
        </span>
      </span>
    </div>
  )
}

export { BRAND }
