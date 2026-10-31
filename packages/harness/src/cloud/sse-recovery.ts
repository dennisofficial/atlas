import type { SsePullRequestClock } from './sse-pull-request-clock'

const RECOVERY_BASE_MS = 30_000
const RECOVERY_CAP_MS = 5 * 60_000
const JITTER_FLOOR = 0.5

export type Recovery = {
  schedule: () => void
  reset: () => void
}

export const recoveryDelayMs = ({ attempt, random }: { attempt: number; random: number }): number =>
  Math.floor(
    Math.min(RECOVERY_CAP_MS, RECOVERY_BASE_MS * 2 ** attempt) *
      (JITTER_FLOOR + (1 - JITTER_FLOOR) * random),
  )

export function createRecovery(args: {
  clock: Required<SsePullRequestClock>
  attempt: () => void
}): Recovery {
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0

  const cancel = (): void => {
    if (timer === null) return
    args.clock.clearTimeoutFn(timer)
    timer = null
  }

  const schedule = (): void => {
    if (timer !== null) return
    const delay = recoveryDelayMs({ attempt: attempts, random: args.clock.randomFn() })
    attempts += 1
    timer = args.clock.setTimeoutFn(() => {
      timer = null
      args.attempt()
    }, delay)
    timer.unref?.()
  }

  const reset = (): void => {
    cancel()
    attempts = 0
  }

  return { schedule, reset }
}
