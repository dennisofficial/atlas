import { describe, expect, it } from 'bun:test'

import { toAccountId } from '../../credentials/account'
import {
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  normalizedProviderFailureSchema,
} from '../provider-failure'

import { anthropicMonthly, classify, MONTHLY_SPEND_TEXT } from './provider-failure-fixture'

const { Credential, Route } = EProviderFailureScope
const { Never, Transient } = EProviderRetry
const Kind = EProviderFailureKind

describe('the Anthropic monthly-spend allowlist', () => {
  it('reads the observed live text as hard quota even on a 429 rate_limit_error', () => {
    expect(anthropicMonthly()).toMatchObject({ kind: Kind.Quota, scope: Credential, retry: Never })
  })

  it('accepts status 400 and the other limit-state verbs', () => {
    for (const providerMessage of [
      'Your monthly spending limit has been reached.',
      'Monthly spend limit exceeded',
      'This request will exceed your monthly spend limit',
    ]) {
      expect(anthropicMonthly({ statusCode: 400, providerMessage }).kind).toBe(Kind.Quota)
    }
  })

  it('does not apply to another provider', () => {
    for (const providerId of ['openai', 'openrouter', 'inference', undefined]) {
      expect(anthropicMonthly({ providerId })).toMatchObject({
        kind: Kind.RateLimited,
        retry: Transient,
      })
    }
  })

  it.each([
    'Rate limit exceeded: 40000 input tokens per minute.',
    'Your monthly usage is high.',
    'You have a limit on monthly spend.',
    'Quota exhausted',
    'Monthly spend limit is configured at $100.',
    'This is not your monthly spend limit exceeded message.',
  ])('keeps the misleading text %j transient', (providerMessage) => {
    expect(anthropicMonthly({ providerMessage })).toMatchObject({
      kind: Kind.RateLimited,
      retry: Transient,
    })
  })

  it('requires the rate_limit_error type and a 429 or 400', () => {
    expect(anthropicMonthly({ providerType: 'api_error' }).kind).toBe(Kind.RateLimited)
    expect(anthropicMonthly({ providerType: undefined }).kind).toBe(Kind.RateLimited)
    expect(anthropicMonthly({ statusCode: 500 }).kind).toBe(Kind.Overloaded)
    expect(anthropicMonthly({ statusCode: undefined }).kind).not.toBe(Kind.Quota)
  })

  it('does not match a plain local error carrying the same words', () => {
    expect(classify({ message: MONTHLY_SPEND_TEXT, providerId: 'anthropic' })).toMatchObject({
      kind: Kind.Other,
      retry: Never,
    })
  })
})

describe('precedence between conflicting evidence', () => {
  it('lets a missing-header message override an invalid-key identifier', () => {
    expect(
      classify({
        statusCode: 401,
        providerCode: 'invalid_api_key',
        providerMessage: 'missing authorization header',
        authorizationDelivered: true,
      }).kind,
    ).toBe(Kind.Delivery)
  })

  it('lets cancellation beat delivery and quota evidence', () => {
    expect(
      classify({ cancelled: true, delivery: true, providerCode: 'insufficient_quota' }).kind,
    ).toBe(Kind.Cancelled)
  })

  it('lets delivery beat a quota identifier', () => {
    expect(
      classify({ delivery: true, statusCode: 429, providerCode: 'insufficient_quota' }).kind,
    ).toBe(Kind.Delivery)
  })

  it('lets a quota identifier beat 429', () => {
    expect(
      classify({
        statusCode: 429,
        providerCode: 'insufficient_quota',
        authorizationDelivered: true,
      }).kind,
    ).toBe(Kind.Quota)
  })

  it('never reads auth or quota evidence as confirmed when the credential was provably not delivered', () => {
    expect(
      classify({ statusCode: 401, providerCode: 'invalid_api_key', authorizationDelivered: false })
        .kind,
    ).toBe(Kind.Delivery)
    expect(classify({ statusCode: 402, authorizationDelivered: false }).kind).toBe(Kind.Delivery)
  })

  it('treats a bare 401 or 402 of unknown origin as delivery, not a confirmed bad credential', () => {
    expect(classify({ statusCode: 401 })).toMatchObject({ kind: Kind.Delivery, retry: Never })
    expect(classify({ statusCode: 402 })).toMatchObject({ kind: Kind.Delivery, retry: Never })
  })

  it('keeps a 403 on the route even when the credential was delivered', () => {
    expect(classify({ statusCode: 403, authorizationDelivered: true })).toMatchObject({
      kind: Kind.ModelDenied,
      scope: Route,
    })
  })

  it('keeps the context identifier ahead of a generic 400', () => {
    expect(
      classify({
        statusCode: 400,
        providerType: 'invalid_request_error',
        providerCode: 'context_length_exceeded',
      }).kind,
    ).toBe(Kind.ContextOverflow)
  })
})

describe('trusting an SDK retryable flag', () => {
  it('accepts it for a non-permanent provider fault', () => {
    expect(classify({ statusCode: 408, sdkRetryable: true })).toMatchObject({ retry: Transient })
    expect(
      classify({ statusCode: 400, sdkRetryable: true, providerType: 'api_error' }),
    ).toMatchObject({
      retry: Transient,
    })
  })

  it('accepts it for a statusless failure as a dropped connection', () => {
    expect(classify({ sdkRetryable: true })).toMatchObject({ kind: Kind.Network, retry: Transient })
  })

  it('does not accept it on a generic invalid-request identifier', () => {
    expect(
      classify({ statusCode: 400, sdkRetryable: true, providerType: 'invalid_request_error' }),
    ).toMatchObject({
      kind: Kind.InvalidRequest,
      retry: Never,
    })
  })

  it.each([
    { statusCode: 401, authorizationDelivered: true },
    { statusCode: 403 },
    { statusCode: 404 },
    { statusCode: 413 },
    { statusCode: 422 },
    { statusCode: 402, authorizationDelivered: true },
    { providerCode: 'insufficient_quota', statusCode: 429 },
    { delivery: true },
    { cancelled: true },
    {
      statusCode: 429,
      providerId: 'anthropic',
      providerType: 'rate_limit_error',
      providerMessage: MONTHLY_SPEND_TEXT,
    },
  ])('cannot revive a permanent failure %j', (evidence) => {
    expect(classify({ ...evidence, sdkRetryable: true }).retry).toBe(Never)
  })
})

describe('reset and retry hints', () => {
  it('never produces resetAt, even for hard quota and when evidence supplies one', () => {
    expect(anthropicMonthly().resetAt).toBeUndefined()
    expect(anthropicMonthly({ resetAt: '2026-11-01T00:00:00.000Z' })).not.toHaveProperty('resetAt')
  })

  it('does not scrape a date out of provider prose', () => {
    const failure = anthropicMonthly({
      providerMessage: `${MONTHLY_SPEND_TEXT} Resets on 2026-11-01.`,
    })
    expect(failure.kind).toBe(Kind.Quota)
    expect(failure).not.toHaveProperty('resetAt')
    expect(failure).not.toHaveProperty('retryAt')
  })

  it('keeps a valid future retryAt intact', () => {
    expect(classify({ statusCode: 429, retryAt: '2026-10-31T12:00:00.000Z' }).retryAt).toBe(
      '2026-10-31T12:00:00.000Z',
    )
  })

  it('drops an unparseable retryAt', () => {
    expect(classify({ statusCode: 429, retryAt: 'soon' })).not.toHaveProperty('retryAt')
  })

  it('does not make quota transient because a retryAt arrived', () => {
    expect(anthropicMonthly({ retryAt: '2026-10-31T12:00:00Z' })).toMatchObject({
      kind: Kind.Quota,
      retry: Never,
    })
  })
})

describe('normalizing identifiers and fields', () => {
  it('lowercases and trims identifiers once', () => {
    expect(
      classify({
        statusCode: 429,
        providerCode: ' Insufficient_Quota ',
        providerType: 'RATE_LIMIT_ERROR',
        authorizationDelivered: true,
      }),
    ).toMatchObject({
      kind: Kind.Quota,
      providerCode: 'insufficient_quota',
      providerType: 'rate_limit_error',
    })
  })

  it('bounds the message to 500 characters', () => {
    expect(classify({ message: 'x'.repeat(2_000) }).message).toHaveLength(500)
  })

  it('bounds identifiers to 80 characters', () => {
    expect(classify({ providerCode: 'a'.repeat(200) }).providerCode).toHaveLength(80)
  })

  it('carries identity through and omits what was not supplied', () => {
    const accountId = toAccountId('acct-1')
    const failure = classify({ statusCode: 503, providerId: 'inference', modelId: 'm', accountId })
    expect(failure).toMatchObject({
      statusCode: 503,
      providerId: 'inference',
      modelId: 'm',
      accountId,
    })
    expect(classify({})).not.toHaveProperty('accountId')
    expect(classify({})).not.toHaveProperty('statusCode')
  })
})

describe('the normalized failure schema', () => {
  it('round-trips a classified failure', () => {
    const failure = anthropicMonthly({ accountId: toAccountId('acct-1'), modelId: 'claude' })
    expect(normalizedProviderFailureSchema.parse(failure)).toEqual(failure)
  })

  it('rejects an unknown kind', () => {
    expect(
      normalizedProviderFailureSchema.safeParse({ ...classify({}), kind: 'from-the-future' })
        .success,
    ).toBe(false)
  })
})
