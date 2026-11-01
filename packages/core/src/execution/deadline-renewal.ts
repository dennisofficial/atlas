export enum EDeadlineDecision {
  Hold = 'hold',
  Extend = 'extend',
}

export type DeadlineRenewal =
  | { kind: EDeadlineDecision.Hold; capped: boolean }
  | { kind: EDeadlineDecision.Extend; until: number; capped: boolean }

export type DeadlinePolicy = {
  graceMs: number
  marginMs: number
  leadMs: number
}

/**
 * Keeps the provider deadline far enough ahead that real work never meets it and the idle grace
 * after the last work always fits before it, without ever reaching past that grace while quiet.
 */
export function deadlineRenewal(args: {
  now: number
  expiresAt: number | undefined
  working: boolean
  quietSince: number | undefined
  hardLimitAt?: number | undefined
  policy: DeadlinePolicy
}): DeadlineRenewal {
  const { now, policy } = args
  const quietOrigin = args.working ? now : (args.quietSince ?? now)
  const needed = quietOrigin + policy.graceMs + policy.marginMs
  const wanted = args.working ? needed + policy.leadMs : needed
  const limit = args.hardLimitAt ?? Number.POSITIVE_INFINITY
  const capped = needed > limit
  const until = Math.min(wanted, limit)
  if (args.expiresAt !== undefined && args.expiresAt >= Math.min(needed, limit))
    return { kind: EDeadlineDecision.Hold, capped }
  return { kind: EDeadlineDecision.Extend, until, capped }
}
