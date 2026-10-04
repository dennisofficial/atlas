import { describe, expect, it } from 'bun:test'

import {
  DEFAULT_RETRY_POLICY,
  ERetryReason,
  isAuthFailure,
  planRetry,
  retryReasonOf,
  type RetryPolicy,
} from '../retry'

const POLICY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 30_000 }

const MAXIMUM_JITTER = 1

describe('naming why a model call is worth trying again', () => {
  it('reads a rate limit off the status', () => {
    expect(retryReasonOf({ status: 429 })).toBe(ERetryReason.RateLimited)
  })

  it('reads the overloaded status Anthropic returns under load', () => {
    expect(retryReasonOf({ status: 529 })).toBe(ERetryReason.Overloaded)
  })

  it.each([500, 502, 503, 504])('reads %i as a server fault', (status) => {
    expect(retryReasonOf({ status })).toBe(ERetryReason.ServerError)
  })

  it('reads a failure with no status at all as a dropped connection', () => {
    expect(retryReasonOf({})).toBe(ERetryReason.Network)
  })

  it.each([400, 401, 403, 404, 413, 422])('refuses to retry %i, which will fail again', (status) => {
    expect(retryReasonOf({ status })).toBeNull()
  })
})

describe('reading a failure that no retry will fix', () => {
  it('reads 401, 402 and 403 as auth failures, since the credential is dead either way', () => {
    expect(isAuthFailure({ status: 401 })).toBe(true)
    expect(isAuthFailure({ status: 402 })).toBe(true)
    expect(isAuthFailure({ status: 403 })).toBe(true)
  })

  it('reads a retryable failure as worth retrying rather than an auth switch', () => {
    expect(isAuthFailure({ status: 429 })).toBe(false)
    expect(isAuthFailure({ status: 529 })).toBe(false)
    expect(isAuthFailure({ status: 500 })).toBe(false)
    expect(isAuthFailure({})).toBe(false)
  })

  it('reads other client faults as not auth, since a 404 or 422 is the request, not the key', () => {
    expect(isAuthFailure({ status: 404 })).toBe(false)
    expect(isAuthFailure({ status: 422 })).toBe(false)
  })
})

describe('planning the wait before trying again', () => {
  it('does not retry a failure that is the caller s fault', () => {
    const decision = planRetry({ failure: { status: 401 }, attempts: 1, policy: POLICY, jitter: MAXIMUM_JITTER })

    expect(decision.retry).toBe(false)
  })

  it('backs off exponentially from the base delay', () => {
    const delays = [1, 2, 3, 4].map((attempts) => {
      const decision = planRetry({ failure: { status: 529 }, attempts, policy: POLICY, jitter: MAXIMUM_JITTER })
      return decision.retry ? decision.delayMs : null
    })

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000])
  })

  it('never waits longer than the ceiling, however far the backoff has doubled', () => {
    const patient: RetryPolicy = { ...POLICY, maxAttempts: 30 }

    const decision = planRetry({ failure: { status: 529 }, attempts: 20, policy: patient, jitter: MAXIMUM_JITTER })

    expect(decision.retry && decision.delayMs).toBe(patient.maxDelayMs)
  })

  it('stops once the attempts are spent', () => {
    const decision = planRetry({
      failure: { status: 529 },
      attempts: POLICY.maxAttempts,
      policy: POLICY,
      jitter: MAXIMUM_JITTER,
    })

    expect(decision.retry).toBe(false)
  })

  it('still has one retry left on the attempt before the last', () => {
    const decision = planRetry({
      failure: { status: 529 },
      attempts: POLICY.maxAttempts - 1,
      policy: POLICY,
      jitter: MAXIMUM_JITTER,
    })

    expect(decision.retry).toBe(true)
  })

  it('spreads the wait over the top half of the window', () => {
    const floor = planRetry({ failure: { status: 529 }, attempts: 3, policy: POLICY, jitter: 0 })
    const ceiling = planRetry({ failure: { status: 529 }, attempts: 3, policy: POLICY, jitter: 1 })

    expect(floor.retry && floor.delayMs).toBe(2_000)
    expect(ceiling.retry && ceiling.delayMs).toBe(4_000)
  })

  it('carries the reason so the operator is told what is being waited on', () => {
    const decision = planRetry({ failure: { status: 429 }, attempts: 1, policy: POLICY, jitter: MAXIMUM_JITTER })

    expect(decision.retry && decision.reason).toBe(ERetryReason.RateLimited)
  })

  it('obeys a retry-after the server sent rather than its own backoff', () => {
    const decision = planRetry({
      failure: { status: 429, retryAfterMs: 12_000 },
      attempts: 1,
      policy: POLICY,
      jitter: 0,
    })

    expect(decision.retry && decision.delayMs).toBe(12_000)
  })

  it('clamps an absurd retry-after to the ceiling rather than hanging the turn', () => {
    const decision = planRetry({
      failure: { status: 429, retryAfterMs: 10 * 60 * 1_000 },
      attempts: 1,
      policy: POLICY,
      jitter: 0,
    })

    expect(decision.retry && decision.delayMs).toBe(POLICY.maxDelayMs)
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

describe('the default policy every caller inherits', () => {
  it('waits one, two, four, then eight seconds at the far end of the jitter window', () => {
    const delays = [1, 2, 3, 4].map((attempts) => {
      const decision = planRetry({
        failure: { status: 429 },
        attempts,
        policy: DEFAULT_RETRY_POLICY,
        jitter: MAXIMUM_JITTER,
      })
      return decision.retry ? decision.delayMs : null
    })

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000])
  })

  it('stops after the fifth failure', () => {
    const decision = planRetry({
      failure: { status: 429 },
      attempts: DEFAULT_RETRY_POLICY.maxAttempts,
      policy: DEFAULT_RETRY_POLICY,
      jitter: MAXIMUM_JITTER,
    })

    expect(decision.retry).toBe(false)
  })

  it('honors a one-minute provider cooldown rather than the backoff ceiling', () => {
    const decision = planRetry({
      failure: { status: 429, retryAfterMs: 60_000 },
      attempts: 1,
      policy: DEFAULT_RETRY_POLICY,
      jitter: MAXIMUM_JITTER,
    })

    expect(decision.retry && decision.delayMs).toBe(60_000)
  })

  it('caps a provider cooldown at one minute', () => {
    const decision = planRetry({
      failure: { status: 429, retryAfterMs: 600_000 },
      attempts: 1,
      policy: DEFAULT_RETRY_POLICY,
      jitter: MAXIMUM_JITTER,
    })

    expect(decision.retry && decision.delayMs).toBe(60_000)
  })

  it('honours a retry-after that is shorter than the backoff', () => {
    const decision = planRetry({
      failure: { status: 429, retryAfterMs: 250 },
      attempts: 3,
      policy: DEFAULT_RETRY_POLICY,
      jitter: MAXIMUM_JITTER,
    })

    expect(decision.retry && decision.delayMs).toBe(250)
  })
})
