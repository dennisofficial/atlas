import type { EventLogPort, ThreadId, ThreadReadCursorPort } from '@dltech/atlas-core'
import {
  ELocalActivityState,
  type LocalActivityReading,
  type LocalPodStatusReader,
} from './local-observer'

export type LocalThreadFacts = {
  head: number
  lastAssistantSeq: number | null
  readSeq?: number | null
}

export type LocalThreadSummary = LocalThreadFacts &
  (
    | (Extract<LocalActivityReading, { activityState: ELocalActivityState.Available }> & {
        lastAssistantSeq: number
        readSeq: number | null
      })
    | Extract<LocalActivityReading, { activityState: ELocalActivityState.Unavailable }>
  )

export function createLocalThreadSummary(args: {
  log: Pick<EventLogPort, 'refresh' | 'readOwn' | 'head'>
  cursor: Pick<ThreadReadCursorPort, 'readSeq'>
  activity: LocalPodStatusReader
}) {
  return {
    async read({
      threadId,
      head,
    }: {
      threadId: ThreadId
      head: number
    }): Promise<LocalThreadSummary> {
      let preparationFailed = false
      await args.activity.prepare({ threadId }).catch(() => {
        preparationFailed = true
      })
      const facts: LocalThreadFacts = { head, lastAssistantSeq: null }
      await Promise.all([
        (async () => {
          await args.log.refresh({ threadId })
          await Promise.all([
            args.log
              .head({ threadId })
              .then((value) => {
                facts.head = value
              })
              .catch(() => undefined),
            args.log
              .readOwn({ threadId })
              .then((events) => {
                facts.lastAssistantSeq = events.reduce(
                  (max, event) =>
                    event.threadId === threadId && event.type === 'assistant-said'
                      ? Math.max(max, event.seq)
                      : max,
                  0,
                )
              })
              .catch(() => undefined),
          ])
        })().catch(() => undefined),
        args.cursor
          .readSeq({ threadId })
          .then((value) => {
            facts.readSeq = value ?? null
          })
          .catch(() => undefined),
      ])
      const unknown: LocalActivityReading = {
        activityState: ELocalActivityState.Unavailable,
        reason: 'Activity unavailable',
      }
      if (preparationFailed || facts.lastAssistantSeq === null || facts.readSeq === undefined)
        return { ...facts, ...unknown }
      const activity = await args.activity.read({ threadId, ...facts }).catch(() => unknown)
      if (activity.activityState === ELocalActivityState.Available) {
        return {
          ...facts,
          ...activity,
          lastAssistantSeq: facts.lastAssistantSeq,
          readSeq: facts.readSeq,
        }
      }
      return { ...facts, ...activity }
    },
  }
}
