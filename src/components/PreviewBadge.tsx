/** A corner marker saying this build is not the live site.
 *
 *  Set at build time by .github/workflows/preview.yml, which passes the branch
 *  name as VITE_PREVIEW. Every other build — production, a local `npm run dev`,
 *  a fork — leaves it unset and renders nothing, so this costs the live site an
 *  undefined check and no markup.
 *
 *  Deliberately a small pinned pill rather than a full-width strip. The
 *  pre-season banner was a strip and it was the first thing every reader met on
 *  every route for a caveat the page already made; the lesson generalises. This
 *  needs to be unmissable to someone looking for it and ignorable to someone
 *  reading the page, which is a corner, not a header. */
const BRANCH = (import.meta.env.VITE_PREVIEW as string | undefined)?.trim()

export function PreviewBadge() {
  if (!BRANCH) return null
  return (
    <div
      className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] left-2 z-50
                 rounded-full border border-accent bg-accent-soft px-2.5 py-1
                 text-[10px] font-semibold tracking-[.09em] text-accent uppercase
                 backdrop-blur-sm md:bottom-3"
      title={`Preview build of ${BRANCH} — not the live site, and not counted in analytics`}
    >
      Preview · {BRANCH}
    </div>
  )
}
