import { isNoticeDelivery, isTurnTaking, type Event, type ThreadId } from '@dltech/atlas-core'
import { ETurnEntry, EWake, type SpanFields } from '@dltech/atlas-observability'

import type { AgentRecordPort } from '../record/agent-record.port'

const promptAwaiting = (events: readonly Event[]): Event | undefined => {
  const last = events.filter((event) => isTurnTaking(event) && !isNoticeDelivery(event)).at(-1)
  return last?.type === 'user-said' ? last : undefined
}

export const promptQueuedMsOf = (args: {
  events: readonly Event[]
  now: number
}): number | undefined => {
  const prompt = promptAwaiting(args.events)
  if (prompt === undefined) return undefined
  const saidAt = Date.parse(prompt.at)
  if (Number.isNaN(saidAt)) return undefined
  return Math.max(0, args.now - saidAt)
}

export const queuedMsSince = (args: { since: string | null; now: number }): number | undefined => {
  if (args.since === null) return undefined
  const postedAt = Date.parse(args.since)
  if (Number.isNaN(postedAt)) return undefined
  return Math.max(0, args.now - postedAt)
}

export type WakeTracker = {
  wakeOf: (args: { threadId: ThreadId }) => EWake
}

export const createWakeTracker = (): WakeTracker => {
  const started = new Set<ThreadId>()
  return {
    wakeOf: ({ threadId }) => {
      if (started.has(threadId)) return EWake.Warm
      started.add(threadId)
      return EWake.Cold
    },
  }
}

const processWakes = createWakeTracker()

export const turnWaitOf = async (args: {
  record: AgentRecordPort
  threadId: ThreadId
  entry: ETurnEntry
  now: number
  wakes?: WakeTracker
}): Promise<SpanFields> => {
  if (args.entry !== ETurnEntry.Start) return {}
  const wake = (args.wakes ?? processWakes).wakeOf({ threadId: args.threadId })
  const events = await args.record.ownEvents({ threadId: args.threadId }).catch(() => [])
  const queuedMs =
    queuedMsSince({ since: args.record.queuedSince?.() ?? null, now: args.now }) ??
    promptQueuedMsOf({ events, now: args.now })
  return { wake, ...(queuedMs === undefined ? {} : { queuedMs }) }
}
