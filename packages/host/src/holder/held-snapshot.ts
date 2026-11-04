import { decideHeldAction, type EHeldAction, type InboxEntry } from '@dltech/atlas-core'

import { idleReleaseDue } from './held-idle'
import { INBOX_KIND_STOP } from './inbox-intake'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'

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
  const entries = await deps.plane.readInbox({ sessionId: deps.sessionId, afterId: 0, limit: 100 })
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
