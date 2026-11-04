import { decideHeldAction, type EHeldAction, type InboxEntry } from '@dltech/atlas-core'

import { idleReleaseDue } from './held-idle'
import { INBOX_KIND_STOP } from './inbox-intake'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'

const INBOX_PAGE_LIMIT = 100

const readFullInbox = async (deps: HeldSessionDeps): Promise<InboxEntry[]> => {
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

export const readHeldAction = async (args: {
  deps: HeldSessionDeps
  draining: boolean
  turnRunning: boolean
  resumePending: boolean
  lastActivityAt: number
  runtime: SessionRuntime | undefined
  released: boolean
}): Promise<{ entries: InboxEntry[]; action: EHeldAction }> => {
  const { deps } = args
  const entries = await readFullInbox(deps)
  const messagePending = entries.some((entry) => entry.kind !== INBOX_KIND_STOP)
  const action = decideHeldAction({
    draining: args.draining,
    turn: args.turnRunning ? 'running' : 'idle',
    stopPending: entries.some((entry) => entry.kind === INBOX_KIND_STOP),
    messagePending: messagePending || args.resumePending,
    idleDue: idleReleaseDue({
      deps,
      turnRunning: args.turnRunning,
      lastActivityAt: args.lastActivityAt,
      runtime: args.runtime,
      released: args.released,
      pendingInput: messagePending,
    }),
  })
  return { entries, action }
}
