import {
  actionableInboxIds,
  EInputConsumed,
  INBOX_KIND_STOP,
  pendingInputsOf,
  pendingMessagesOf,
  type V2Event,
  type InboxEntry,
  type PrepareFailure,
} from '@dltech/atlas-core'

import type { ControlPlane } from '@dltech/atlas-control'

import { isCommandKind } from './command-intake'
import type { HeldSessionDeps } from './held-session-deps'

const INBOX_PAGE_LIMIT = 100
export const INBOX_INTAKE_MAX_PAGES = 10

export const readInboxPages = async (args: {
  plane: ControlPlane
  sessionId: string
  maxPages?: number
}): Promise<InboxEntry[]> => {
  const entries: InboxEntry[] = []
  let afterId = 0
  for (let pages = 0; pages < (args.maxPages ?? Infinity); pages += 1) {
    const page = await args.plane.readInbox({
      sessionId: args.sessionId,
      afterId,
      limit: INBOX_PAGE_LIMIT,
    })
    entries.push(...page)
    const last = page[page.length - 1]
    if (last === undefined || page.length < INBOX_PAGE_LIMIT) break
    afterId = last.inboxId
  }
  return entries
}

export const readFullInbox = (deps: HeldSessionDeps): Promise<InboxEntry[]> =>
  readInboxPages({ plane: deps.plane, sessionId: deps.sessionId })

export const logPendingMessageIdsOf = (events: readonly V2Event[]): number[] =>
  pendingMessagesOf(pendingInputsOf(events)).map((entry) => entry.inboxId)

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

export const stopSettledPromptOf = (events: readonly V2Event[]): boolean => {
  let lastPrompt = -1
  let lastStop = -1
  for (const event of events) {
    if (event.type === 'user-said' || event.type === 'nudge') lastPrompt = event.seq
    else if (event.type === 'input-consumed' && event.consumed === EInputConsumed.Stop) {
      lastStop = event.seq
    }
  }
  return lastPrompt >= 0 && lastStop > lastPrompt
}

export const understandsCommand = (deps: HeldSessionDeps, entry: InboxEntry): boolean =>
  !isCommandKind(entry.kind) ||
  (deps.commands?.byInboxKind.has(entry.kind) === true &&
    deps.commandHandlers?.has(entry.kind) === true)
