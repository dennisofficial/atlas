import { createHash } from 'node:crypto'

import type { CallId } from '@dltech/atlas-core'

export type QualityNotified = { policyId: string; scopeId: string }

export const reviewIdOf = ({ callId }: { callId: CallId }): string =>
  createHash('sha256').update(callId).digest('hex').slice(0, 32)

export const wasNotified = (args: {
  notified: readonly QualityNotified[]
  policyId: string
  scopeId: string
}): boolean =>
  args.notified.some((held) => held.policyId === args.policyId && held.scopeId === args.scopeId)
