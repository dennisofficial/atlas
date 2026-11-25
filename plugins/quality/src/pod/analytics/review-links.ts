import { randomUUID } from 'node:crypto'

export type QualityNotified = { policyId: string; scopeId: string }

export const newReviewId = (): string => randomUUID()

export const wasNotified = (args: {
  notified: readonly QualityNotified[]
  policyId: string
  scopeId: string
}): boolean =>
  args.notified.some((held) => held.policyId === args.policyId && held.scopeId === args.scopeId)
