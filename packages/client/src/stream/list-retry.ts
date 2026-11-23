import { backoffDelayMs } from './connection-machine'
import type { StreamScheduler } from './stream-ports'

export type ListRetry = {
  failed(): void
  settled(): void
  cancel(): void
}

export const createListRetry = (args: {
  scheduler: StreamScheduler
  live(): boolean
  resubscribe(): void
}): ListRetry => {
  let attempt = 0
  let timer: unknown

  const cancel = (): void => {
    if (timer === undefined) return
    args.scheduler.clearTimeout(timer)
    timer = undefined
  }

  return {
    failed: () => {
      if (timer !== undefined) return
      const ms = backoffDelayMs({ attempt, random: args.scheduler.random() })
      attempt += 1
      timer = args.scheduler.setTimeout(() => {
        timer = undefined
        if (args.live()) args.resubscribe()
      }, ms)
    },
    settled: () => {
      attempt = 0
    },
    cancel,
  }
}
