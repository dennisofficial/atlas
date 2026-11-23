import {
  isNoticeDelivery,
  isTurnTaking,
  type Event,
  type EventOfType,
  type ThreadId,
} from '@dltech/atlas-core'
import { EWake, type SpanFields } from '@dltech/atlas-observability'

import type { AgentRecordPort } from '../record/agent-record.port'

const promptAwaiting = (events: readonly Event[]): EventOfType<'user-said'> | undefined => {
  const last = events.filter((event) => isTurnTaking(event) && !isNoticeDelivery(event)).at(-1)
  return last?.type === 'user-said' ? last : undefined
}

const epochOf = (at: string | null | undefined): number | undefined => {
  if (at === null || at === undefined) return undefined
  const parsed = Date.parse(at)
  return Number.isNaN(parsed) ? undefined : parsed
}

const saidPromptAtOf = async (args: {
  said: EventOfType<'user-said'>
  record: AgentRecordPort
  threadId: ThreadId
}): Promise<number | undefined> => {
  const inboxId = args.said.inboxId
  const postedAt =
    inboxId === undefined
      ? undefined
      : (await args.record.postedInputAts({ threadId: args.threadId })).get(inboxId)
  return epochOf(postedAt) ?? epochOf(args.said.at)
}

export const promptAtOf = async (args: {
  record: AgentRecordPort
  events: readonly Event[]
  threadId: ThreadId
  queuedAt?: string | undefined
}): Promise<number | undefined> => {
  const said = promptAwaiting(args.events)
  const saidAt =
    said === undefined
      ? undefined
      : await saidPromptAtOf({ said, record: args.record, threadId: args.threadId })
  return saidAt ?? epochOf(args.queuedAt) ?? epochOf(args.record.queuedSince?.() ?? null)
}

export const promptQueuedMsOf = (args: {
  now: number
  promptAt: number | undefined
}): number | undefined => {
  if (args.promptAt === undefined) return undefined
  return Math.max(0, args.now - args.promptAt)
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

export type TurnWait = {
  fields: SpanFields
  promptAt: number | undefined
}

export const turnWaitOf = async (args: {
  record: AgentRecordPort
  threadId: ThreadId
  now: number
  wakes?: WakeTracker
  queuedAt?: string | undefined
}): Promise<TurnWait> => {
  const wake = (args.wakes ?? processWakes).wakeOf({ threadId: args.threadId })
  const events = await args.record.ownEvents({ threadId: args.threadId }).catch(() => [])
  const promptAt = await promptAtOf({
    record: args.record,
    events,
    threadId: args.threadId,
    ...(args.queuedAt === undefined ? {} : { queuedAt: args.queuedAt }),
  })
  const queuedMs = promptQueuedMsOf({ now: args.now, promptAt })
  return {
    fields: { wake, ...(queuedMs === undefined ? {} : { queuedMs }) },
    promptAt,
  }
}
