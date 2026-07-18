import { AnimatePresence, motion } from 'framer-motion'

const SEEN_KEY = 'fpl_onboarded'

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // private mode — don't nag every load
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* private mode — fine */
  }
}

interface Props {
  open: boolean
  onClose: () => void
}

export function OnboardingModal({ open, onClose }: Props) {
  const close = () => {
    markSeen()
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Welcome to FPL Analyser"
            className="w-full max-w-lg rounded-xl border border-line-mid bg-surface-2 p-6 shadow-modal"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <div className="mb-5 flex items-center gap-4">
              <img src="icons/icon-192.png" alt="" width={56} height={56} className="rounded-lg" />
              <div>
                <div className="text-lg font-bold">FPL Analyser</div>
                <div className="text-sm text-ink-2">Data-driven analysis to give you the edge</div>
              </div>
            </div>
            <ul className="mb-5 space-y-3 text-sm leading-relaxed text-ink-2">
              <li>
                <strong className="text-ink">The Briefing</strong> — the story of the week on the home page:
                captaincy verdicts, fixture swings and form that's backed by the underlying numbers, told in
                plain language.
              </li>
              <li>
                <strong className="text-ink">My Team</strong> — enter your FPL team ID for a personalised weekly
                report: weak spots, fixture swings, price risks, captaincy, and concrete transfer suggestions at
                your budget.
              </li>
              <li>
                <strong className="text-ink">Analytics</strong> — every player rated out of 5 within their
                position, with a plain-language verdict, personas ("Poacher", "Set Piece Threat"), shot maps and
                rankings.
              </li>
              <li>
                <strong className="text-ink">Scouting</strong> — compare up to four players on per-90 percentiles
                versus their peers, with an automatic head-to-head verdict.
              </li>
            </ul>
            <div className="mb-5 rounded-md bg-accent-soft px-3 py-2 text-xs leading-relaxed text-ink-2">
              Tip: on your phone, tap the ⓘ icons to see what any rating or metric means. Add the site to your
              home screen for an app-like experience.
            </div>
            <button
              className="min-h-11 w-full rounded-md bg-accent font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
              onClick={close}
            >
              Get started
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
