import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it } from 'bun:test'

import { ERunFailureKind, toAccountId } from '@dltech/atlas-core'

import { withFailureAccount } from '../../providers/failure-account'
import { ModelStreamError } from '../errors'
import { modelFailureOf } from '../failure'
import { runFailureOf } from '../run-failure'

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

  it('treats a dropped connection as network', () => {
    const failure = runFailureOf({ message: 'fetch failed', cause: new Error('fetch failed') })
    expect(failure.kind).toBe(ERunFailureKind.Network)
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
})
