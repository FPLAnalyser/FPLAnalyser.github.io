// notifications.ts — native local notifications (no backend needed).
//
// Deadline reminders are scheduled entirely on-device from the FPL fixture
// calendar, so they work offline and cost nothing to run. Price-change and
// injury alerts are data deltas the device can't know while backgrounded — those
// need the remote-push backend (see docs/NOTIFICATIONS.md) and are not here yet.

import { isNative } from './native'
import { fplFetch } from './api'

const SCHEDULED_KEY = 'fpl_notif_deadlines_v1'

export type NotifPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

export async function notifPermission(): Promise<NotifPermission> {
  if (!isNative()) return 'unsupported'
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const s = await LocalNotifications.checkPermissions()
    return (s.display as NotifPermission) ?? 'prompt'
  } catch {
    return 'unsupported'
  }
}

export async function requestNotifPermission(): Promise<boolean> {
  if (!isNative()) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const s = await LocalNotifications.requestPermissions()
    return s.display === 'granted'
  } catch {
    return false
  }
}

/**
 * Schedule a reminder 2 hours before every upcoming gameweek deadline (and a
 * final nudge 1 hour before GW1-style urgency). Idempotent per calendar — safe
 * to call on every launch; it only reschedules when the fixture list changes.
 */
export async function scheduleDeadlineReminders(force = false): Promise<number> {
  if (!isNative()) return 0
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') return 0

    const res = await fplFetch('https://fantasy.premierleague.com/api/bootstrap-static/')
    const boot = await res.json()
    const events: { id: number; deadline_time: string; name: string; finished: boolean }[] = boot.events || []
    const now = Date.now()
    const upcoming = events
      .filter((e) => e.deadline_time && new Date(e.deadline_time).getTime() > now + 60 * 60 * 1000 && !e.finished)
      .slice(0, 12) // iOS caps pending local notifications; a dozen deadlines is plenty

    // Skip the work when the same set is already scheduled.
    const sig = upcoming.map((e) => e.id + '@' + e.deadline_time).join('|')
    if (!force) {
      try { if (localStorage.getItem(SCHEDULED_KEY) === sig) return upcoming.length } catch { /* ignore */ }
    }

    // Clear our previously-scheduled deadline reminders, then re-add.
    try {
      const pending = await LocalNotifications.getPending()
      const ours = pending.notifications.filter((n) => n.id >= 100000 && n.id < 200000)
      if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) })
    } catch { /* ignore */ }

    const toSchedule = upcoming.map((e) => {
      const at = new Date(e.deadline_time).getTime() - 2 * 60 * 60 * 1000 // 2h before
      return {
        id: 100000 + e.id,
        title: `${e.name} deadline soon`,
        body: 'Two hours to set your team — transfers, captain and bench.',
        schedule: { at: new Date(at) },
        smallIcon: 'ic_stat_icon',
      }
    }).filter((n) => n.schedule.at.getTime() > now)

    if (toSchedule.length) await LocalNotifications.schedule({ notifications: toSchedule })
    try { localStorage.setItem(SCHEDULED_KEY, sig) } catch { /* ignore */ }
    return toSchedule.length
  } catch {
    return 0
  }
}
