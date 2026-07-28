import { useEffect, useState } from 'react'

/** True at the lg breakpoint (1024px).
 *
 *  Used to decide how much of a fixture run to show. It lives here rather than
 *  in a page because two of them now ask the same question, and the answer has
 *  to be the same: a run's verdict and its markers describe exactly the
 *  fixtures on screen, so the count is a render decision, not something CSS
 *  hides after the fact.
 *
 *  The initial value is read synchronously from matchMedia so the first paint
 *  is already correct — deferring it to an effect would render the mobile
 *  count on a desktop and then swap it, which reads as a bug. */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}
