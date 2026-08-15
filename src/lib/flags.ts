/* ════════════════════════════════════════════════════════════════════════
   WHAT IS FINISHED, AND WHAT IS STILL BEING BUILT.

   The repo's rule is that half-built work lives on a branch and gets a
   preview. That works until one branch carries several things at once and
   only some of them are ready: the finished parts should not wait on the
   unfinished ones, and the unfinished ones must not reach the live site.

   So the entry points to work in progress — a route, a nav link, a tab —
   are gated on this flag rather than deleted and re-added. The code ships
   either way; only the door does not. Preview builds set VITE_PREVIEW to the
   branch name (see .github/workflows/preview.yml); production sets nothing,
   so `npm run build` gives a site with no way in.

   Deliberately not a runtime toggle or a query string. A flag anyone can
   flip from the address bar is a soft launch, and the point of this one is
   that a page nobody has signed off cannot be reached from the live site at
   all.
   ════════════════════════════════════════════════════════════════════════ */

/** True in a preview build of a branch, false in production. */
export const PREVIEW = Boolean((import.meta.env.VITE_PREVIEW as string | undefined)?.trim())
