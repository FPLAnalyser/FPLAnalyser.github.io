/** Namespace localStorage on preview builds.
 *
 *  The preview site is published to a path on the mirror's host, which makes it
 *  the SAME ORIGIN as the mirror — and the mirror is production for anyone whose
 *  network blocks the custom domain, which in practice means the owner's own
 *  work laptop. Same origin means one localStorage, so a half-built feature on a
 *  branch would write straight into the `fpl_planner` of the person using the
 *  mirror as their real site, and a saved squad would come back mangled with no
 *  clue why.
 *
 *  So every key a preview touches gets a per-branch prefix. Production is
 *  untouched: VITE_PREVIEW is unset there, this module returns immediately, and
 *  the whole thing costs one string check at startup.
 *
 *  Imported FIRST in main.tsx, before anything that reads storage — ES modules
 *  evaluate in import order, so the patch has to be at the top of that list to
 *  beat theme and season setup to the first read. */
const BRANCH = (import.meta.env.VITE_PREVIEW as string | undefined)?.trim()

if (BRANCH) {
  // Branch names contain slashes; keep the key readable and collision-free.
  const NS = `preview:${BRANCH.replace(/[^a-zA-Z0-9._-]+/g, '-')}:`
  try {
    const ls = window.localStorage
    // Storage.PROTOTYPE, not the instance. A Storage object is exotic: defining
    // a property on it does not shadow the method, it STORES an entry — so an
    // instance-level patch silently does nothing except leave three junk keys
    // called getItem/setItem/removeItem behind, and every write lands
    // un-namespaced on top of the real thing. Measured, not guessed.
    const proto = Storage.prototype
    const rawGet = proto.getItem
    const rawSet = proto.setItem
    const rawRemove = proto.removeItem

    // Only the app's own keys are namespaced, and only on localStorage —
    // sessionStorage and anything a browser extension or Capacitor plugin owns
    // passes through untouched, because renaming a key we do not own is how you
    // break something invisible.
    const mine = (k: string) => k.startsWith('fpl_') || k.startsWith('theme') || k.startsWith('accent')
    const key = (self: Storage, k: string) => (self === ls && mine(k) ? NS + k : k)

    proto.getItem = function (k: string) { return rawGet.call(this, key(this, k)) }
    proto.setItem = function (k: string, v: string) { return rawSet.call(this, key(this, k), v) }
    proto.removeItem = function (k: string) { return rawRemove.call(this, key(this, k)) }
  } catch {
    /* private mode, or a browser that will not let us redefine these — the
       preview still works, it just shares state. Not worth failing a build for. */
  }
}

export {}
