import { useEffect, useState } from 'react'
import { isNative, tapHaptic } from '../lib/native'
import { requestNotifPermission, scheduleDeadlineReminders } from '../lib/notifications'
import { Icon } from './Icon'

// First-run onboarding — NATIVE APP ONLY (the desktop site is never touched).
// Two quick steps that drive activation: connect your team (Team ID = account),
// then opt into deadline alerts with context (never the cold OS prompt).
const DONE_KEY = 'fpl_onboarded_v1'
const TEAM_ID_KEY = 'fpl_team_id'

export function AppOnboarding() {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState<0 | 1>(0)
  const [teamId, setTeamId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isNative()) return
    try { if (!localStorage.getItem(DONE_KEY)) setShow(true) } catch { /* ignore */ }
  }, [])

  if (!show) return null

  const finish = () => {
    try { localStorage.setItem(DONE_KEY, '1') } catch { /* ignore */ }
    setShow(false)
  }
  const saveTeam = () => {
    const id = teamId.trim()
    if (/^\d+$/.test(id)) { try { localStorage.setItem(TEAM_ID_KEY, id) } catch { /* ignore */ } }
    tapHaptic('light')
    setStep(1)
  }
  const enableAlerts = async () => {
    setBusy(true)
    tapHaptic('medium')
    const ok = await requestNotifPermission()
    if (ok) await scheduleDeadlineReminders(true)
    setBusy(false)
    finish()
  }

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-bg px-6 py-10" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 2.5rem)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 2.5rem)' }}>
      <div className="mb-8 text-center">
        <div className="font-display text-3xl font-extrabold text-ink">FPL <span className="text-accent">Analyser</span></div>
        <div className="mt-1 text-[11px] font-semibold tracking-[0.22em] text-ink-3 uppercase">Data · Insight · Points</div>
      </div>

      {step === 0 ? (
        <div className="flex flex-1 flex-col">
          <h1 className="text-2xl font-bold text-ink">Connect your team</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Your Team ID unlocks your squad ratings and a weekly report — it’s the only thing we need, no signup.
            Find it in the URL on the official FPL site: fantasy.premierleague.com/entry/<strong>1234567</strong>.
          </p>
          <input
            type="text"
            inputMode="numeric"
            value={teamId}
            placeholder="Enter your FPL Team ID…"
            className="mt-5 min-h-12 w-full rounded-xl border border-line-mid bg-surface-1 px-4 text-base text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            onChange={(e) => setTeamId(e.target.value)}
          />
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <button onClick={saveTeam} className="min-h-12 rounded-xl bg-accent font-semibold text-accent-contrast transition-colors hover:bg-accent-strong">
              {teamId.trim() ? 'Continue' : 'I’ll add it later'}
            </button>
            <button onClick={() => setStep(1)} className="text-sm font-medium text-ink-3">Skip for now</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"><Icon name="clock" size={28} /></div>
          <h1 className="text-2xl font-bold text-ink">Never miss a deadline</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Get a reminder two hours before every gameweek deadline so you always set your team in time. No spam — just
            the alerts that save you points.
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-ink-2">
            <li className="flex items-center gap-2"><Icon name="check" size={15} /> Deadline reminders</li>
            <li className="flex items-center gap-2 text-ink-3"><Icon name="clock" size={15} /> Price & injury alerts — coming soon</li>
          </ul>
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <button onClick={enableAlerts} disabled={busy} className="min-h-12 rounded-xl bg-accent font-semibold text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-60">
              {busy ? 'Setting up…' : 'Enable deadline alerts'}
            </button>
            <button onClick={finish} className="text-sm font-medium text-ink-3">Not now</button>
          </div>
        </div>
      )}
    </div>
  )
}
