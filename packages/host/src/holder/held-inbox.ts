import {
  actionableInboxIds,
  EInputConsumed,
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  INBOX_KIND_STOP,
  inboxEventOf,
  isMessageInputKind,
  pendingInputsOf,
  pendingMessagesOf,
  pendingNoticesOf,
  type PodResizeNotice,
  type PodResizeStarted,
  type ThreadId,
  type V2Event,
  type InboxEntry,
  type PrepareFailure,
} from '@dltech/atlas-core'

import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { isCommandKind } from './command-intake'
import type { HeldSessionDeps } from './held-session-deps'

const INBOX_PAGE_LIMIT = 100
export const INBOX_INTAKE_MAX_PAGES = 10

export const readInboxPages = async (args: {
  plane: ControlPlane
  sessionId: string
  forThread: ThreadId | null
  maxPages?: number
}): Promise<InboxEntry[]> => {
  const entries: InboxEntry[] = []
  let afterId = 0
  for (let pages = 0; pages < (args.maxPages ?? Infinity); pages += 1) {
    const page = await args.plane.readInbox({
      sessionId: args.sessionId,
      afterId,
      limit: INBOX_PAGE_LIMIT,
      forThread: args.forThread,
    })
    entries.push(...page)
    const last = page[page.length - 1]
    if (last === undefined || page.length < INBOX_PAGE_LIMIT) break
    afterId = last.inboxId
  }
  return entries
}

export const fetchInboxEntries = async (args: {
  plane: ControlPlane
  sessionId: string
  forThread: ThreadId | null
  maxPages?: number
  log?: LogPort | undefined
}): Promise<InboxEntry[]> => {
  try {
    return await readInboxPages({
      ...args,
      ...(args.maxPages === undefined ? {} : { maxPages: args.maxPages }),
    })
  } catch (error) {
    args.log?.error({
      source: 'holder.intake',
      message: 'reading the inbox failed',
      ...logFieldsOf({ error }),
    })
    throw error
  }
}

export const readFullInbox = (deps: HeldSessionDeps): Promise<InboxEntry[]> =>
  readInboxPages({ plane: deps.plane, sessionId: deps.sessionId, forThread: null })

export const readThreadInbox = (args: {
  plane: ControlPlane
  sessionId: string
  threadId: ThreadId
}): Promise<InboxEntry[]> =>
  readInboxPages({ plane: args.plane, sessionId: args.sessionId, forThread: args.threadId })

export const logPendingInputIdsOf = (events: readonly V2Event[]): number[] => {
  const pending = pendingInputsOf(events)
  return [...pendingMessagesOf(pending), ...pendingNoticesOf(pending)].map((entry) => entry.inboxId)
}

export const logPendingNoticeIdsOf = (events: readonly V2Event[]): number[] =>
  pendingNoticesOf(pendingInputsOf(events)).map((entry) => entry.inboxId)

export const podResizedNoticeIdsOf = (events: readonly V2Event[]): ReadonlySet<number> =>
  new Set(
    events.flatMap((event) =>
      event.type === 'input-posted' && event.event?.type === 'pod-resized' ? [event.inboxId] : [],
    ),
  )

export const isNoticeEntry = (entry: InboxEntry): boolean =>
  entry.kind === INBOX_KIND_EVENT || entry.kind === INBOX_KIND_RECORD

export const waitingInputIdsOf = (args: {
  ids: readonly number[]
  failure: PrepareFailure | undefined
}): number[] => args.ids.filter((id) => args.failure === undefined || id > args.failure.inboxHead)

export const actionableEntries = (args: {
  entries: readonly InboxEntry[]
  failure: PrepareFailure | undefined
}): InboxEntry[] => {
  const ids = new Set(actionableInboxIds(args))
  return args.entries.filter((entry) => ids.has(entry.inboxId))
}

export const isStop = (entry: InboxEntry): boolean => entry.kind === INBOX_KIND_STOP

export const podResizeStartedOf = (entry: InboxEntry): PodResizeStarted | undefined => {
  if (entry.kind !== INBOX_KIND_RECORD) return undefined
  const read = inboxEventOf(entry.payload)
  return read.ok && read.event.type === 'pod-resize-started' ? read.event : undefined
}

export const isPodResizeStarted = (entry: InboxEntry): boolean =>
  podResizeStartedOf(entry) !== undefined

export const isResizeEntry = (entry: InboxEntry): boolean =>
  isPodResizeStarted(entry) || carriesPodResized(entry)

export const isInterrupt = (entry: InboxEntry): boolean => isStop(entry) || isResizeEntry(entry)

export const podResizedOf = (entry: InboxEntry): PodResizeNotice | undefined => {
  if (entry.kind !== INBOX_KIND_RECORD) return undefined
  const read = inboxEventOf(entry.payload)
  return read.ok && read.event.type === 'pod-resized' ? read.event : undefined
}

export const carriesPodResized = (entry: InboxEntry): boolean => podResizedOf(entry) !== undefined

const onThread = (args: { entry: InboxEntry; threadId: ThreadId }): boolean =>
  args.entry.threadId === null || args.entry.threadId === args.threadId

export const queuedPromptAtOf = (args: {
  entries: readonly InboxEntry[]
  events: readonly V2Event[]
  threadId: ThreadId
}): string | undefined => {
  const posted = new Map<number, string>()
  for (const entry of args.entries) {
    if (!isMessageInputKind(entry.kind)) continue
    if (!onThread({ entry, threadId: args.threadId })) continue
    posted.set(entry.inboxId, entry.postedAt)
  }
  for (const input of pendingMessagesOf(pendingInputsOf(args.events))) {
    posted.set(input.inboxId, input.at)
  }
  const oldest = [...posted.entries()].sort(([left], [right]) => left - right)[0]
  return oldest?.[1]
}

export const stopSettledPromptOf = (events: readonly V2Event[]): boolean => {
  let lastPrompt = -1
  let lastStop = -1
  for (const event of events) {
    if (event.type === 'user-said' || event.type === 'nudge' || event.type === 'resume-marked')
      lastPrompt = event.seq
    else if (event.type === 'input-consumed' && event.consumed === EInputConsumed.Stop) {
      lastStop = event.seq
    }
  }
  return lastPrompt >= 0 && lastStop > lastPrompt
}

export const understandsCommand = (deps: HeldSessionDeps, entry: InboxEntry): boolean =>
  !isCommandKind(entry.kind) || deps.commands?.byInboxKind.has(entry.kind) === true
