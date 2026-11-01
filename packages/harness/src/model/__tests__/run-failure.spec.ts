import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it } from 'bun:test'

import { EProviderFailureKind, ERunFailureKind, toAccountId } from '@dltech/atlas-core'

import { withFailureAccount } from '../../providers/failure-account'
import { ModelStreamError } from '../errors'
import { NOW_MS, normalized } from './normalize-fixture'
import { CredentialError, ECredentialFailure } from '../../credentials/credential-error'
import { MissingKeyError } from '../../providers/provider-key'
import { StreamStallError } from '../errors'
import { droppedByMessageHeuristic } from '../dropped-by-message'
import { runFailureOf, safeFailureMessage } from '../run-failure'
import { TurnFault } from '../turn-fault'

const unauthorized = (): APICallError =>
  new APICallError({
    message: 'Invalid API key',
    url: 'https://api.inference.net/v1/chat/completions',
    requestBodyValues: { secret: 'sk-live-abcdef123456' },
    statusCode: 401,
    responseHeaders: { authorization: 'Bearer sk-live-abcdef123456' },
    responseBody: '{"error":{"message":"Invalid API key","code":"invalid_api_key"}}',
  })

describe('runFailureOf', () => {
  it('classifies a tagged 401 with provider, model and request-time account', () => {
    const cause = withFailureAccount({ error: unauthorized(), accountId: toAccountId('acct-1') })
    const failure = runFailureOf({
      message: 'Invalid API key',
      cause: new ModelStreamError({ message: 'Invalid API key', cause }),
      providerId: 'inference',
      modelId: 'kimi',
    })
    expect(failure).toEqual({
      kind: ERunFailureKind.Auth,
      message: 'Invalid API key',
      statusCode: 401,
      providerCode: 'invalid_api_key',
      providerId: 'inference',
      modelId: 'kimi',
      accountId: 'acct-1',
    })
    expect(JSON.stringify(failure)).not.toContain('sk-live')
  })

  const withCode = (code: string): Error => Object.assign(new Error('boom'), { code })

  it.each([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_SOCKET',
  ])('classifies code %s as network, even wrapped', (code) => {
    const cause = new ModelStreamError({ message: 'x', cause: withCode(code) })
    expect(runFailureOf({ message: 'x', cause }).kind).toBe(ERunFailureKind.Network)
  })

  it('classifies a fetch TypeError by its cause code', () => {
    const cause = new TypeError('fetch failed', { cause: withCode('ECONNRESET') })
    expect(runFailureOf({ message: 'x', cause }).kind).toBe(ERunFailureKind.Network)
    expect(runFailureOf({ message: 'x', cause: new TypeError('fetch failed') }).kind).toBe(
      ERunFailureKind.Network,
    )
  })

  it('classifies timeout and abort errors by name', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name })
    expect(runFailureOf({ message: 'x', cause: named('TimeoutError') }).kind).toBe(
      ERunFailureKind.Network,
    )
    expect(runFailureOf({ message: 'x', cause: named('AbortError') }).kind).toBe(
      ERunFailureKind.Network,
    )
  })

  it('reads a dropped connection off a plain error the same way the retry loop does', () => {
    for (const message of ['socket hang up', 'fetch failed', 'terminated', 'econnreset']) {
      expect(runFailureOf({ message, cause: new Error(message) }).kind).toBe(
        ERunFailureKind.Network,
      )
    }
  })

  it('reads a stream ended without a finish reason through the named heuristic only', () => {
    const message = 'Response stream ended without a finish reason.'
    expect(droppedByMessageHeuristic(new Error(message))).toBe(true)
    expect(droppedByMessageHeuristic(new Error('socket hang up'))).toBe(false)
    const cause = new ModelStreamError({ message, cause: new Error(message) })
    expect(runFailureOf({ message, cause }).kind).toBe(ERunFailureKind.Network)
  })

  it('keeps an HTTP status ahead of any network signal', () => {
    const cause = new APICallError({
      message: 'x',
      url: 'https://x',
      requestBodyValues: {},
      statusCode: 400,
      cause: withCode('ECONNRESET'),
    })
    expect(runFailureOf({ message: 'x', cause }).kind).toBe(ERunFailureKind.Other)
  })

  it('treats a non-model failure as other', () => {
    const failure = runFailureOf({ message: 'loop guard tripped', cause: undefined })
    expect(failure).toEqual({ kind: ERunFailureKind.Other, message: 'loop guard tripped' })
  })

  it('redacts key-shaped tokens in the message', () => {
    const failure = runFailureOf({ message: 'bad key sk-live-abcdef123456', cause: undefined })
    expect(failure.message).toBe('bad key [redacted]')
  })

  it('leaves retry classification unchanged by the account tag', () => {
    const before = normalized(unauthorized())
    const tagged = normalized(
      withFailureAccount({ error: unauthorized(), accountId: toAccountId('acct-1') }),
    )
    expect(tagged.kind).toBe(before.kind)
    expect(tagged.retry).toBe(before.retry)
    expect(tagged.accountId).toBe(toAccountId('acct-1'))
  })

  it.each([
    [ERunFailureKind.ToolSettlement],
    [ERunFailureKind.LoopGuard],
    [ERunFailureKind.ContextOverflow],
    [ERunFailureKind.ExchangeFault],
    [ERunFailureKind.FinishFault],
  ])('reads the kind of a typed %s cause, not its message', (kind) => {
    const failure = runFailureOf({
      message: 'unrelated words',
      cause: new TurnFault({ kind, message: 'unrelated words' }),
    })
    expect(failure.kind).toBe(kind)
  })

  it('classifies a stream stall as stalled, even wrapped', () => {
    const stall = new StreamStallError('silent')
    expect(runFailureOf({ message: 'x', cause: stall }).kind).toBe(ERunFailureKind.Stalled)
    expect(
      runFailureOf({ message: 'x', cause: new ModelStreamError({ message: 'x', cause: stall }) })
        .kind,
    ).toBe(ERunFailureKind.Stalled)
  })

  it('reports a missing key and undeliverable credentials as delivery, never an invalid key', () => {
    expect(runFailureOf({ message: 'x', cause: new MissingKeyError('Inference.net') }).kind).toBe(
      ERunFailureKind.Delivery,
    )
    const credential = (failure: ECredentialFailure) =>
      runFailureOf({ message: 'x', cause: new CredentialError({ failure, message: 'x' }) }).kind
    for (const failure of [
      ECredentialFailure.NotFound,
      ECredentialFailure.Expired,
      ECredentialFailure.Unreadable,
      ECredentialFailure.Unsupported,
    ]) {
      expect(credential(failure)).toBe(ERunFailureKind.Delivery)
    }
  })

  it('does not call a failed token refresh an invalid key', () => {
    const cause = new CredentialError({ failure: ECredentialFailure.RefreshFailed, message: 'x' })
    expect(runFailureOf({ message: 'x', cause }).kind).toBe(ERunFailureKind.Network)
  })

  it('reports a grant the provider refused to renew as auth', () => {
    const cause = new CredentialError({
      failure: ECredentialFailure.Expired,
      message: 'x',
      providerRefused: true,
    })
    expect(runFailureOf({ message: 'x', cause }).kind).toBe(ERunFailureKind.Auth)
  })

  it('keeps an expired credential nobody asked the provider about as delivery', () => {
    const cause = new CredentialError({ failure: ECredentialFailure.Expired, message: 'x' })
    expect(runFailureOf({ message: 'x', cause }).kind).toBe(ERunFailureKind.Delivery)
  })

  it('reports retryAt from Retry-After and leaves resetAt unset', () => {
    const cause = new APICallError({
      message: 'slow down',
      url: 'https://x',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { 'retry-after': '30' },
    })
    const failure = runFailureOf({ message: 'slow down', cause, nowMs: NOW_MS })
    expect(failure.kind).toBe(ERunFailureKind.RateLimited)
    expect(failure.retryAt).toBe('2026-10-31T12:00:30.000Z')
    expect(failure.resetAt).toBeUndefined()
  })

  it('reports the same identity and reason the retry loop saw', () => {
    const cause = withFailureAccount({
      error: unauthorized(),
      accountId: toAccountId('acct-1'),
    })
    const seen = normalized(cause)
    const failure = runFailureOf({ message: 'x', cause })
    expect(failure.accountId).toBe(seen.accountId)
    expect(failure.kind).toBe(ERunFailureKind.Auth)
    expect(seen.kind).toBe(EProviderFailureKind.Auth)
  })

  it('classifies an escaped exception as crashed', () => {
    expect(runFailureOf({ message: 'boom', cause: new Error('boom'), escaped: true }).kind).toBe(
      ERunFailureKind.Crashed,
    )
  })

  it.each([
    ['key AIzaSyA1234567890abcdefghij', 'key [redacted]'],
    ['jwt eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl end', 'jwt [redacted] end'],
    ['GET /v1?api_key=abc123&x=1', 'GET /v1?api_key=[redacted]&x=1'],
    ['GET /v1?token=abc123 failed', 'GET /v1?token=[redacted] failed'],
    ['GET /v1?access_token=abc&apikey=def', 'GET /v1?access_token=[redacted]&apikey=[redacted]'],
  ])('redacts %s', (input, expected) => {
    expect(safeFailureMessage(input)).toBe(expected)
  })
})
