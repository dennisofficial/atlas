import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it } from 'bun:test'

import { ERunFailureKind, toAccountId } from '@dltech/atlas-core'

import { withFailureAccount } from '../../providers/failure-account'
import { ModelStreamError } from '../errors'
import { modelFailureOf } from '../failure'
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

  it('does not read network from message text of a plain error', () => {
    for (const message of ['socket hang up', 'fetch failed', 'terminated', 'econnreset']) {
      expect(runFailureOf({ message, cause: new Error(message) }).kind).toBe(ERunFailureKind.Other)
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
    const plain = unauthorized()
    const before = modelFailureOf(plain)
    withFailureAccount({ error: plain, accountId: toAccountId('acct-1') })
    expect(modelFailureOf(plain)).toEqual(before)
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

  it('classifies a missing key and credential errors', () => {
    expect(runFailureOf({ message: 'x', cause: new MissingKeyError('Inference.net') }).kind).toBe(
      ERunFailureKind.MissingCredential,
    )
    const credential = (failure: ECredentialFailure) =>
      runFailureOf({ message: 'x', cause: new CredentialError({ failure, message: 'x' }) }).kind
    expect(credential(ECredentialFailure.NotFound)).toBe(ERunFailureKind.MissingCredential)
    expect(credential(ECredentialFailure.RefreshFailed)).toBe(ERunFailureKind.Auth)
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
