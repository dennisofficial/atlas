import { describe, expect, it } from 'bun:test'

import { eventBodySchema } from '../schema'
import {
  ERunFailureKind,
  ERunRemedy,
  remediesOf,
  runFailureKindOf,
  runFailureKindOfProviderKind,
  runFailureSchema,
  type RunFailure,
} from '../run-failure'
import { EProviderFailureKind } from '../../models/provider-failure'
import { providerLabelOf, runFailureCopy } from '../run-failure-copy'

describe('runFailureKindOf', () => {
  it.each([
    [{ statusCode: 401 }, ERunFailureKind.Delivery],
    [{ statusCode: 401, authorizationDelivered: true }, ERunFailureKind.Auth],
    [{ statusCode: 403 }, ERunFailureKind.ModelDenied],
    [{ providerType: 'permission_error' }, ERunFailureKind.ModelDenied],
    [{ statusCode: 404 }, ERunFailureKind.ModelDenied],
    [{ statusCode: 413 }, ERunFailureKind.ContextOverflow],
    [{ providerCode: 'context_length_exceeded' }, ERunFailureKind.ContextOverflow],
    [{ statusCode: 401, authorizationDelivered: false }, ERunFailureKind.Delivery],
    [
      {
        statusCode: 401,
        providerCode: 'invalid_api_key',
        providerMessage: 'Missing Authorization header',
      },
      ERunFailureKind.Delivery,
    ],
    [
      {
        providerId: 'anthropic',
        statusCode: 429,
        providerType: 'rate_limit_error',
        providerMessage: "This request would exceed your account's monthly spend limit.",
      },
      ERunFailureKind.Quota,
    ],
    [
      {
        providerId: 'openai',
        statusCode: 429,
        providerType: 'rate_limit_error',
        providerMessage: "This request would exceed your account's monthly spend limit.",
      },
      ERunFailureKind.RateLimited,
    ],
    [{ providerCode: 'invalid_api_key' }, ERunFailureKind.Auth],
    [{ providerType: 'authentication_error' }, ERunFailureKind.Auth],
    [{ statusCode: 402 }, ERunFailureKind.Delivery],
    [{ statusCode: 402, authorizationDelivered: true }, ERunFailureKind.Quota],
    [{ providerCode: 'billing_hard_limit_reached' }, ERunFailureKind.Quota],
    [{ statusCode: 429 }, ERunFailureKind.RateLimited],
    [{ statusCode: 429, providerCode: 'insufficient_quota' }, ERunFailureKind.Quota],
    [{ statusCode: 503 }, ERunFailureKind.Overloaded],
    [{ statusCode: 529 }, ERunFailureKind.Overloaded],
    [{ providerType: 'overloaded_error' }, ERunFailureKind.Overloaded],
    [{ dropped: true }, ERunFailureKind.Network],
    [{ statusCode: 400 }, ERunFailureKind.Other],
    [{}, ERunFailureKind.Other],
  ])('classifies %j as %s', (input, kind) => {
    expect(runFailureKindOf(input)).toBe(kind)
  })
})

describe('mapping provider kinds to run failure kinds', () => {
  it('covers every provider failure kind', () => {
    for (const kind of Object.values(EProviderFailureKind)) {
      expect(Object.values(ERunFailureKind)).toContain(runFailureKindOfProviderKind(kind))
    }
  })

  it('folds invalid-request and cancelled into Other', () => {
    expect(runFailureKindOfProviderKind(EProviderFailureKind.InvalidRequest)).toBe(
      ERunFailureKind.Other,
    )
    expect(runFailureKindOfProviderKind(EProviderFailureKind.Cancelled)).toBe(ERunFailureKind.Other)
  })
})

describe('runFailureCopy', () => {
  const failure = (kind: ERunFailureKind): RunFailure => ({ kind, message: 'boom' })

  it('names the provider and account for an auth failure', () => {
    const copy = runFailureCopy({
      failure: failure(ERunFailureKind.Auth),
      providerLabel: 'Inference.net',
      accountLabel: 'work',
    })
    expect(copy.title).toBe('Inference.net rejected the API key')
    expect(copy.detail).toBe(
      'Inference.net rejected the API key for work. Update it in Settings → Providers, then retry.',
    )
    expect(copy.remedies[0]).toBe(ERunRemedy.FixCredential)
  })

  it('does not claim the key is invalid when a credential was never delivered', () => {
    const copy = runFailureCopy({
      failure: failure(ERunFailureKind.Delivery),
      providerLabel: 'OpenRouter',
      accountLabel: 'work',
    })
    expect(copy.title).not.toContain('rejected')
    expect(copy.detail).toContain('does not mean the stored key is invalid')
    expect(copy.remedies).toEqual([ERunRemedy.FixCredential, ERunRemedy.Retry])
  })

  it('names a model denial without blaming the key', () => {
    const copy = runFailureCopy({
      failure: failure(ERunFailureKind.ModelDenied),
      providerLabel: 'OpenAI',
    })
    expect(copy.detail).toContain('denied access to this model')
    expect(copy.remedies).toEqual([ERunRemedy.Retry, ERunRemedy.SwitchModel])
  })

  it('falls back gracefully without labels', () => {
    const copy = runFailureCopy({ failure: failure(ERunFailureKind.Auth) })
    expect(copy.detail).toContain('this account')
  })

  it('derives the provider label from the provider id', () => {
    expect(providerLabelOf('inference')).toBe('Inference.net')
    expect(providerLabelOf('nope')).toBeUndefined()
  })

  it.each(Object.values(ERunFailureKind))('has copy and remedies for %s', (kind) => {
    const copy = runFailureCopy({ failure: failure(kind) })
    expect(copy.title.length).toBeGreaterThan(0)
    expect(copy.detail.length).toBeGreaterThan(0)
    expect(copy.remedies).toEqual(remediesOf(kind))
    expect(copy.remedies.length).toBeGreaterThan(0)
  })

  it.each([
    [ERunFailureKind.Auth, [ERunRemedy.FixCredential, ERunRemedy.Retry, ERunRemedy.SwitchModel]],
    [ERunFailureKind.Quota, [ERunRemedy.FixCredential, ERunRemedy.Retry, ERunRemedy.SwitchModel]],
    [
      ERunFailureKind.MissingCredential,
      [ERunRemedy.FixCredential, ERunRemedy.Retry, ERunRemedy.SwitchModel],
    ],
    [ERunFailureKind.Delivery, [ERunRemedy.FixCredential, ERunRemedy.Retry]],
    [ERunFailureKind.ModelDenied, [ERunRemedy.Retry, ERunRemedy.SwitchModel]],
    [ERunFailureKind.RateLimited, [ERunRemedy.Retry, ERunRemedy.SwitchModel]],
    [ERunFailureKind.Overloaded, [ERunRemedy.Retry, ERunRemedy.SwitchModel]],
    [ERunFailureKind.Network, [ERunRemedy.Retry]],
    [ERunFailureKind.Stalled, [ERunRemedy.Retry]],
    [ERunFailureKind.ContextOverflow, [ERunRemedy.Compact, ERunRemedy.SwitchModel]],
    [ERunFailureKind.ExchangeFault, [ERunRemedy.Retry]],
    [ERunFailureKind.LoopGuard, [ERunRemedy.Retry]],
    [ERunFailureKind.ToolSettlement, [ERunRemedy.Retry]],
    [ERunFailureKind.FinishFault, [ERunRemedy.Retry]],
    [ERunFailureKind.Crashed, [ERunRemedy.Retry]],
    [ERunFailureKind.Other, [ERunRemedy.Retry]],
    [ERunFailureKind.AgentFailed, [ERunRemedy.OpenAgent]],
  ])('orders remedies for %s', (kind, remedies) => {
    expect(remediesOf(kind)).toEqual(remedies)
  })

  it('uses the message for other failures', () => {
    const copy = runFailureCopy({ failure: failure(ERunFailureKind.Other) })
    expect(copy).toEqual({
      title: 'The run failed',
      detail: 'boom',
      remedies: [ERunRemedy.Retry],
    })
  })
})

describe('run-failed schema', () => {
  it('round-trips through the event body schema', () => {
    const body = {
      type: 'run-failed' as const,
      failure: {
        kind: ERunFailureKind.Auth,
        message: 'Invalid API key',
        statusCode: 401,
        providerCode: 'invalid_api_key',
        providerId: 'inference',
        modelId: 'm',
        accountId: 'acct-1',
      },
    }
    expect(eventBodySchema.parse(body)).toEqual(body)
    expect(runFailureSchema.safeParse({ kind: ERunFailureKind.Auth }).success).toBe(false)
  })
})

describe('run-failed hints', () => {
  it('round-trips retryAt and resetAt and the new kinds', () => {
    const body = {
      type: 'run-failed' as const,
      failure: {
        kind: ERunFailureKind.Quota,
        message: 'spend limit',
        retryAt: '2026-10-31T12:00:00.000Z',
        resetAt: '2026-11-01T00:00:00.000Z',
      },
    }
    expect(eventBodySchema.parse(body)).toEqual(body)
    for (const kind of [ERunFailureKind.Delivery, ERunFailureKind.ModelDenied]) {
      const parsed = runFailureSchema.parse({ kind, message: 'x' })
      expect(parsed.kind).toBe(kind)
    }
  })

  it('parses a historical failure without hints', () => {
    const parsed = runFailureSchema.parse({ kind: ERunFailureKind.MissingCredential, message: 'x' })
    expect(parsed).toEqual({ kind: ERunFailureKind.MissingCredential, message: 'x' })
  })
})

describe('run-failure-dismissed schema', () => {
  it('round-trips and rejects a bad seq', () => {
    const body = { type: 'run-failure-dismissed' as const, failureSeq: 7 }
    expect(eventBodySchema.parse(body)).toEqual(body)
    expect(
      eventBodySchema.safeParse({ type: 'run-failure-dismissed', failureSeq: -1 }).success,
    ).toBe(false)
  })

  it('round-trips a child agent ref on a failure', () => {
    const body = {
      type: 'run-failed' as const,
      failure: {
        kind: ERunFailureKind.AgentFailed,
        message: 'x',
        agent: { agentId: 'a1', agentType: 'explore', intent: 'look' },
      },
    }
    expect(eventBodySchema.parse(body)).toEqual(body)
  })
})

describe('unknown failure kinds', () => {
  it('parses an unknown run-failed kind as Other and keeps the event', () => {
    const parsed = eventBodySchema.parse({
      type: 'run-failed',
      failure: { kind: 'from-the-future', message: 'x' },
    })
    expect(parsed).toEqual({
      type: 'run-failed',
      failure: { kind: ERunFailureKind.Other, message: 'x' },
    })
  })

  it('parses an unknown agent-ended failureKind as Other and keeps the event', () => {
    const parsed = eventBodySchema.parse({
      type: 'agent-ended',
      agentId: 'a1',
      agentType: 'explore',
      intent: 'look',
      status: 'failed',
      failureKind: 'from-the-future',
      prose: '',
      turns: 0,
      toolCalls: 0,
    })
    expect(parsed).toMatchObject({ type: 'agent-ended', failureKind: ERunFailureKind.Other })
  })
})
