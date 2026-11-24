import type { V2Event } from '@dltech/atlas-core'
import { pendingOperatorRequestOf as sharedPendingOperatorRequestOf } from '@dltech/atlas-plugin-operator/client'

export type PendingOperatorRequest = { callId: string; prompt: string }

export const pendingOperatorRequestOf = (args: {
  events: readonly V2Event[]
}): PendingOperatorRequest | null => {
  const entry = sharedPendingOperatorRequestOf({ events: args.events })
  return entry === null ? null : { callId: entry.callId, prompt: entry.prompt }
}
