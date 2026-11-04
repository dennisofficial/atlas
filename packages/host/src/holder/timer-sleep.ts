import type { RetryDeps } from '@dltech/atlas-agent'

import type { HostTimers } from './ports'

const timerSleep =
  (timers: HostTimers) =>
  (args: { ms: number; signal: AbortSignal }): Promise<void> =>
    new Promise<void>((resolve) => {
      if (args.signal.aborted) {
        resolve()
        return
      }
      const settle = () => {
        timers.clearTimeout(timer)
        args.signal.removeEventListener('abort', settle)
        resolve()
      }
      const timer = timers.setTimeout(settle, args.ms)
      args.signal.addEventListener('abort', settle, { once: true })
    })

export const retryDepsFromTimers = (timers: HostTimers): RetryDeps => ({
  now: () => timers.now(),
  sleep: timerSleep(timers),
  jitter: () => timers.random(),
})
