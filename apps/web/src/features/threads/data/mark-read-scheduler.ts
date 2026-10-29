import { timeoutSchedule, type Schedule } from './thread-signals'

export const MARK_READ_DEBOUNCE_MS = 1000

export type MarkReadScheduler = {
  push: (head: number) => void
  stop: () => void
}

export function createMarkReadScheduler(args: {
  send: (seq: number) => Promise<unknown>
  schedule?: Schedule
  delayMs?: number
}): MarkReadScheduler {
  const schedule = args.schedule ?? timeoutSchedule
  const delayMs = args.delayMs ?? MARK_READ_DEBOUNCE_MS
  let pending: number | undefined
  let sent = -1
  let cancel: (() => void) | undefined

  const flush = () => {
    cancel = undefined
    if (pending === undefined || pending <= sent) return
    sent = pending
    pending = undefined
    args.send(sent).catch(() => undefined)
  }

  return {
    push: (head) => {
      if (head <= sent) return
      pending = Math.max(pending ?? head, head)
      if (cancel === undefined) cancel = schedule({ delayMs, run: flush })
    },
    stop: () => {
      cancel?.()
      cancel = undefined
      pending = undefined
    },
  }
}
