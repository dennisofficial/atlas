import {
  actionableInboxIds,
  INBOX_KIND_STOP,
  type InboxEntry,
  type PrepareFailure,
} from '@dltech/atlas-core'

import { INBOX_KIND_REPAIR_DIAGRAM } from '@dltech/atlas-protocol'

import type { HeldSessionDeps } from './held-session-deps'

const INBOX_PAGE_LIMIT = 100

export const readFullInbox = async (deps: HeldSessionDeps): Promise<InboxEntry[]> => {
  const entries: InboxEntry[] = []
  let afterId = 0
  for (;;) {
    const page = await deps.plane.readInbox({
      sessionId: deps.sessionId,
      afterId,
      limit: INBOX_PAGE_LIMIT,
    })
    entries.push(...page)
    const last = page[page.length - 1]
    if (last === undefined || page.length < INBOX_PAGE_LIMIT) return entries
    afterId = last.inboxId
  }
}

export const actionableEntries = (args: {
  entries: readonly InboxEntry[]
  failure: PrepareFailure | undefined
}): InboxEntry[] => {
  const ids = new Set(actionableInboxIds(args))
  return args.entries.filter((entry) => ids.has(entry.inboxId))
}

export const isStop = (entry: InboxEntry): boolean => entry.kind === INBOX_KIND_STOP

export const isRepair = (entry: InboxEntry): boolean => entry.kind === INBOX_KIND_REPAIR_DIAGRAM

export const wakesTurn = (entry: InboxEntry): boolean => !isStop(entry) && !isRepair(entry)
