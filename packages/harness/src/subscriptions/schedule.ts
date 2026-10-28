import type { Schedule } from './delivery-buffer'

// setTimeout fires immediately when the delay exceeds a signed 32-bit integer of milliseconds.
// https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const MAX_TIMER_MS = 2_147_483_647

export const timerSchedule: Schedule = ({ ms, run }) => {
  let handle: ReturnType<typeof setTimeout> | undefined
  let cancelled = false

  const arm = (remaining: number): void => {
    handle = setTimeout(
      () => {
        if (cancelled) return
        if (remaining > MAX_TIMER_MS) arm(remaining - MAX_TIMER_MS)
        else run()
      },
      Math.min(remaining, MAX_TIMER_MS),
    )
    handle.unref()
  }

  arm(Math.max(0, ms))
  return () => {
    cancelled = true
    if (handle !== undefined) clearTimeout(handle)
  }
}
