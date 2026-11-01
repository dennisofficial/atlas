import { describe, expect, it } from 'bun:test'

import {
  classifyProviderFailure,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  type NormalizedProviderFailure,
  type ProviderFailureEvidence,
} from '../provider-failure'
import {
  DEFAULT_RETRY_POLICY,
  ERetryReason,
  planRetry,
  retryReasonOf,
  type RetryPolicy,
} from '../retry'

const POLICY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 30_000 }

const MAXIMUM_JITTER = 1
const NOW_MS = Date.parse('2026-10-31T12:00:00.000Z')

const failureOf = (evidence: Partial<ProviderFailureEvidence> = {}): NormalizedProviderFailure =>
  classifyProviderFailure({ evidence: { message: 'boom', ...evidence } })

const plan = (args: {
  failure: NormalizedProviderFailure
  attempts?: number
  policy?: RetryPolicy
  jitter?: number
  nowMs?: number
}) =>
  planRetry({
    failure: args.failure,
    attempts: args.attempts ?? 1,
    policy: args.policy ?? POLICY,
    jitter: args.jitter ?? MAXIMUM_JITTER,
    nowMs: args.nowMs ?? NOW_MS,
  })

const delaysOf = (args: { failure: NormalizedProviderFailure; policy?: RetryPolicy }) =>
  [1, 2, 3, 4].map((attempts) => {
    const decision = plan({ ...args, attempts })
    return decision.retry ? decision.delayMs : null
  })

describe('naming why a model call is worth trying again', () => {
  it('reads a rate limit', () => {
    expect(retryReasonOf(failureOf({ statusCode: 429 }))).toBe(ERetryReason.RateLimited)
  })

  it('reads the overloaded status Anthropic returns under load', () => {
    expect(retryReasonOf(failureOf({ statusCode: 529 }))).toBe(ERetryReason.Overloaded)
  })

  it.each([500, 502, 503, 504])('reads %i as a server fault', (statusCode) => {
    expect(retryReasonOf(failureOf({ statusCode }))).toBe(ERetryReason.ServerError)
  })

  it('reads a named overloaded error with no status as overloaded', () => {
    expect(retryReasonOf(failureOf({ providerType: 'overloaded_error' }))).toBe(
      ERetryReason.Overloaded,
    )
  })

  it('reads a dropped connection and a stall as a network fault', () => {
    expect(retryReasonOf(failureOf({ transport: true }))).toBe(ERetryReason.Network)
    expect(retryReasonOf(failureOf({ stalled: true }))).toBe(ERetryReason.Network)
  })

  it.each([400, 401, 403, 404, 413, 422])(
    'refuses to retry %i, which will fail again',
    (statusCode) => {
      expect(retryReasonOf(failureOf({ statusCode }))).toBeNull()
    },
  )

  it('refuses every failure classified Never', () => {
    for (const evidence of [
      { delivery: true },
      { cancelled: true },
      { statusCode: 429, providerCode: 'insufficient_quota' },
      {},
    ]) {
      expect(retryReasonOf(failureOf(evidence))).toBeNull()
    }
  })
})

describe('trusting a provider that flags a failure retryable', () => {
  it.each([400, 408, 409])('retries a %i the provider flagged retryable', (statusCode) => {
    expect(retryReasonOf(failureOf({ statusCode, sdkRetryable: true }))).toBe(
      ERetryReason.ServerError,
    )
  })

  it('does not retry a 400 the provider did not flag', () => {
    expect(retryReasonOf(failureOf({ statusCode: 400 }))).toBeNull()
    expect(retryReasonOf(failureOf({ statusCode: 400, sdkRetryable: false }))).toBeNull()
  })

  it.each([401, 402, 403, 404, 413, 422])(
    'refuses a %i even when flagged retryable',
    (statusCode) => {
      expect(
        retryReasonOf(failureOf({ statusCode, sdkRetryable: true, authorizationDelivered: true })),
      ).toBeNull()
    },
  )

  it('keeps the rate limit, overloaded and server fault reasons ahead of the flag', () => {
    expect(retryReasonOf(failureOf({ statusCode: 429, sdkRetryable: true }))).toBe(
      ERetryReason.RateLimited,
    )
    expect(retryReasonOf(failureOf({ statusCode: 529, sdkRetryable: true }))).toBe(
      ERetryReason.Overloaded,
    )
    expect(retryReasonOf(failureOf({ statusCode: 503, sdkRetryable: true }))).toBe(
      ERetryReason.ServerError,
    )
  })

  it('does not let a false flag veto a server fault', () => {
    expect(retryReasonOf(failureOf({ statusCode: 503, sdkRetryable: false }))).toBe(
      ERetryReason.ServerError,
    )
  })

  it('cannot revive a Never failure by rewriting the flag on a hand-built value', () => {
    const never: NormalizedProviderFailure = {
      kind: EProviderFailureKind.Quota,
      scope: EProviderFailureScope.Credential,
      retry: EProviderRetry.Never,
      message: 'x',
      statusCode: 429,
    }
    expect(retryReasonOf(never)).toBeNull()
    expect(plan({ failure: never }).retry).toBe(false)
  })

  it('spends exactly the default five attempts on a flagged 400 with a retry-after not-before', () => {
    const failure = failureOf({
      statusCode: 400,
      sdkRetryable: true,
      retryAt: new Date(NOW_MS + 3_000).toISOString(),
    })
    const decisions = [1, 2, 3, 4, 5].map((attempts) =>
      plan({ failure, attempts, policy: DEFAULT_RETRY_POLICY }),
    )

    expect(decisions.map((decision) => decision.retry)).toEqual([true, true, true, true, false])
    expect(decisions[0]?.retry && decisions[0].delayMs).toBe(3_000)
  })
})

describe('planning the wait before trying again', () => {
  it('does not retry a failure that is the caller s fault', () => {
    expect(
      plan({ failure: failureOf({ statusCode: 401, authorizationDelivered: true }) }).retry,
    ).toBe(false)
  })

  it('backs off exponentially from the base delay', () => {
    expect(delaysOf({ failure: failureOf({ statusCode: 529 }) })).toEqual([
      1_000, 2_000, 4_000, 8_000,
    ])
  })

  it('never waits longer than the ceiling, however far the backoff has doubled', () => {
    const patient: RetryPolicy = { ...POLICY, maxAttempts: 30 }
    const decision = plan({
      failure: failureOf({ statusCode: 529 }),
      attempts: 20,
      policy: patient,
    })

    expect(decision.retry && decision.delayMs).toBe(patient.maxDelayMs)
  })

  it('stops once the attempts are spent', () => {
    expect(
      plan({ failure: failureOf({ statusCode: 529 }), attempts: POLICY.maxAttempts }).retry,
    ).toBe(false)
  })

  it('still has one retry left on the attempt before the last', () => {
    expect(
      plan({ failure: failureOf({ statusCode: 529 }), attempts: POLICY.maxAttempts - 1 }).retry,
    ).toBe(true)
  })

  it('spreads the wait over the top half of the window', () => {
    const failure = failureOf({ statusCode: 529 })
    const floor = plan({ failure, attempts: 3, jitter: 0 })
    const ceiling = plan({ failure, attempts: 3, jitter: 1 })

    expect(floor.retry && floor.delayMs).toBe(2_000)
    expect(ceiling.retry && ceiling.delayMs).toBe(4_000)
  })

  it('carries the reason so the operator is told what is being waited on', () => {
    const decision = plan({ failure: failureOf({ statusCode: 429 }) })

    expect(decision.retry && decision.reason).toBe(ERetryReason.RateLimited)
  })

  it('keeps the default backoff separate from the provider cooldown ceiling', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      maxRetryAfterMs: 60_000,
    })
  })
})

describe('honouring a provider not-before time', () => {
  const retryingAt = (offsetMs: number) =>
    failureOf({ statusCode: 429, retryAt: new Date(NOW_MS + offsetMs).toISOString() })

  it('waits for a retryAt longer than the backoff rather than retrying early', () => {
    const decision = plan({ failure: retryingAt(12_000), jitter: 0 })

    expect(decision.retry && decision.delayMs).toBe(12_000)
  })

  it('keeps the backoff when it is longer than the retryAt wait', () => {
    const decision = plan({ failure: retryingAt(250), attempts: 3, jitter: 1 })

    expect(decision.retry && decision.delayMs).toBe(4_000)
  })

  it('adds no extra delay for a retryAt already in the past', () => {
    const decision = plan({ failure: retryingAt(-30_000), jitter: 0 })

    expect(decision.retry && decision.delayMs).toBe(500)
  })

  it('stops rather than truncating a retryAt beyond the longest permitted wait', () => {
    const failure = retryingAt(10 * 60 * 1_000)

    expect(plan({ failure, policy: DEFAULT_RETRY_POLICY }).retry).toBe(false)
    expect(plan({ failure, policy: POLICY }).retry).toBe(false)
  })

  it('waits exactly a one-minute cooldown but stops one millisecond past it', () => {
    const exact = plan({ failure: retryingAt(60_000), policy: DEFAULT_RETRY_POLICY })
    const past = plan({ failure: retryingAt(60_001), policy: DEFAULT_RETRY_POLICY })

    expect(exact.retry && exact.delayMs).toBe(60_000)
    expect(past.retry).toBe(false)
  })

  it('measures the wait against the supplied clock', () => {
    const failure = retryingAt(12_000)
    const later = plan({ failure, nowMs: NOW_MS + 11_000, jitter: 0 })

    expect(later.retry && later.delayMs).toBe(1_000)
  })
})

describe('the default policy every caller inherits', () => {
  it('waits one, two, four, then eight seconds at the far end of the jitter window', () => {
    expect(
      delaysOf({ failure: failureOf({ statusCode: 429 }), policy: DEFAULT_RETRY_POLICY }),
    ).toEqual([1_000, 2_000, 4_000, 8_000])
  })

  it('stops after the fifth failure', () => {
    expect(
      plan({
        failure: failureOf({ statusCode: 429 }),
        attempts: DEFAULT_RETRY_POLICY.maxAttempts,
        policy: DEFAULT_RETRY_POLICY,
      }).retry,
    ).toBe(false)
  })

  it('refuses a confirmed monthly-spend 429 on the first rejection', () => {
    const failure = failureOf({
      statusCode: 429,
      providerId: 'anthropic',
      providerType: 'rate_limit_error',
      providerMessage: "This request would exceed your account's monthly spend limit.",
      authorizationDelivered: true,
    })

    expect(plan({ failure, policy: DEFAULT_RETRY_POLICY }).retry).toBe(false)
  })
})
