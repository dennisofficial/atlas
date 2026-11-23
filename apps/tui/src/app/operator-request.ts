import type { V2Event } from '@dltech/atlas-core'
import { requestEntriesAt } from '@dltech/atlas-plugin-operator/client'

export type PendingOperatorRequest = { callId: string; prompt: string }

export const pendingOperatorRequestOf = (args: {
  events: readonly V2Event[]
}): PendingOperatorRequest | null => {
  let found: PendingOperatorRequest | null = null

  for (const entry of requestEntriesAt({ events: args.events }).values()) {
    if (entry.state !== 'pending') continue
    found = { callId: entry.callId, prompt: entry.prompt }
  }

  return found
}
