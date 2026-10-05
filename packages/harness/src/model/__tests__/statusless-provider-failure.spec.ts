import { describe, expect, it } from 'bun:test'
import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ModelStreamError } from '../errors'
import { modelFailureOf } from '../failure'

type FailureInput = { code: string; message: string }
const factories: ReadonlyArray<readonly [string, (input: FailureInput) => APICallError | StreamProviderError]> = [
  [
    'API',
    ({ code, message }) =>
      new APICallError({
        message,
        url: 'https://api.example.com',
        requestBodyValues: {},
        isRetryable: true,
        data: { error: { code } },
      }),
  ],
  [
    'stream',
    ({ code, message }) =>
      new StreamProviderError({
        message,
        isRetryable: true,
        data: { error: { code } },
      }),
  ],
]

describe.each(factories)('permanent statusless %s provider failures', (_name, build) => {
  it.each([
    'invalid_api_key',
    'insufficient_quota',
    'context_length_exceeded',
    'billing_hard_limit_reached',
    'payment_required',
    'invalid_request_error',
  ])('rejects %s before either the retry flag or network-message fallback', (code) => {
    const error = build({ code, message: 'fetch failed' })
    expect(modelFailureOf(error)).toBeNull()
    expect(modelFailureOf(new ModelStreamError({ message: 'wrapped', cause: error }))).toBeNull()
  })
})
