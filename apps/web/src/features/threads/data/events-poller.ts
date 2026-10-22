import type { WireEvent } from '@dltech/atlas-wire/web'

export const POLL_MS = 1000

export type ThreadEvents = { events: WireEvent[]; loaded: boolean; error: Error | null }

export const INITIAL_THREAD_EVENTS: ThreadEvents = { events: [], loaded: false, error: null }

export type PollSchedule = (task: { delayMs: number; run: () => void }) => () => void

export const timeoutSchedule: PollSchedule = ({ delayMs, run }) => {
  const timer = setTimeout(run, delayMs)
  return () => clearTimeout(timer)
}

export function createEventsPoller(args: {
  threadId: string
  fetchHead: (threadId: string) => Promise<{ head: number }>
  fetchEvents: (threadId: string) => Promise<WireEvent[]>
  onUpdate: (update: (current: ThreadEvents) => ThreadEvents) => void
  schedule?: PollSchedule
}) {
  const schedule = args.schedule ?? timeoutSchedule
  let cancelled = false
  let lastHead: number | null = null
  let cancelNext: (() => void) | undefined

  const poll = async () => {
    if (cancelled) return
    try {
      const { head } = await args.fetchHead(args.threadId)
      if (cancelled) return
      if (head === lastHead) {
        args.onUpdate((current) => (current.error === null ? current : { ...current, error: null }))
      } else {
        const events = await args.fetchEvents(args.threadId)
        if (cancelled) return
        lastHead = head
        args.onUpdate(() => ({ events, loaded: true, error: null }))
      }
    } catch (failure) {
      if (cancelled) return
      const error = failure instanceof Error ? failure : new Error(String(failure))
      args.onUpdate((current) => ({ ...current, error }))
    }
    cancelNext = schedule({ delayMs: POLL_MS, run: () => void poll() })
  }

  return {
    start: () => void poll(),
    stop: () => {
      cancelled = true
      cancelNext?.()
    },
  }
}
