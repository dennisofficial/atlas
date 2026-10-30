import { describe, expect, it } from 'bun:test'

import { eventBodySchema } from '../schema'
import {
  ERunFailureKind,
  ERunRemedy,
  remediesOf,
  runFailureKindOf,
  runFailureSchema,
  type RunFailure,
} from '../run-failure'
import { providerLabelOf, runFailureCopy } from '../run-failure-copy'

describe('runFailureKindOf', () => {
  it.each([
    [{ statusCode: 401 }, ERunFailureKind.Auth],
    [{ statusCode: 403 }, ERunFailureKind.Auth],
    [{ providerCode: 'invalid_api_key' }, ERunFailureKind.Auth],
    [{ providerType: 'authentication_error' }, ERunFailureKind.Auth],
    [{ statusCode: 402 }, ERunFailureKind.Quota],
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
    [ERunFailureKind.AgentFailed, [ERunRemedy.OpenAgent, ERunRemedy.Retry]],
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
    expect(runFailureSchema.safeParse({ kind: 'bogus', message: '' }).success).toBe(false)
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
