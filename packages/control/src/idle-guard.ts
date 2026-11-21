import { actionableInboxIds, type InboxEntry, type PrepareFailure } from '@dltech/atlas-core'

import { asksForHolderOf } from './claim-ops'

export type IdleReleaseGuard = { inboxHead: number; reasons: readonly string[] }

export const idleReleaseGuardOf = (args: {
  entries: readonly InboxEntry[]
  failure: Pick<PrepareFailure, 'inboxHead'> | undefined
  wantsHolder: boolean
}): IdleReleaseGuard => {
  const unconsumed = args.entries.filter((entry) => entry.consumedSeq === null)
  const claimable = actionableInboxIds({
    entries: unconsumed.filter((entry) => asksForHolderOf(entry.kind)),
    failure: args.failure,
  })
  return {
    inboxHead: Math.max(0, ...unconsumed.map((entry) => entry.inboxId)),
    reasons: [
      ...claimable.map((inboxId) => `input ${inboxId} is claimable`),
      ...(args.wantsHolder && unconsumed.length > 0
        ? ['a wake on input the holder did not consume']
        : []),
    ],
  }
}
