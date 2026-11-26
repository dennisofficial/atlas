import type { EConnectionTimer } from './connection-machine'
import type { StreamScheduler } from './stream-ports'

export type ConnectionTimers = {
  schedule(request: { timer: EConnectionTimer; ms: number }): void
  cancel(timer: EConnectionTimer): void
}

export const createConnectionTimers = (args: {
  scheduler: StreamScheduler
  onFire: (timer: EConnectionTimer) => void
}): ConnectionTimers => {
  const { scheduler } = args
  const timers = new Map<EConnectionTimer, unknown>()

  const cancel = (timer: EConnectionTimer): void => {
    if (!timers.has(timer)) return
    scheduler.clearTimeout(timers.get(timer))
    timers.delete(timer)
  }

  const schedule = (request: { timer: EConnectionTimer; ms: number }): void => {
    cancel(request.timer)
    timers.set(
      request.timer,
      scheduler.setTimeout(() => {
        timers.delete(request.timer)
        args.onFire(request.timer)
      }, request.ms),
    )
  }

  return { schedule, cancel }
}
