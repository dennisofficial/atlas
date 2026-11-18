import { describe, expect, it } from 'bun:test'

import { ModelStreamError } from '@dltech/atlas-agent'
import { APICallError } from '@ai-sdk/provider'
import { DownloadError } from 'ai'

import { isMediaUnavailable } from '../media-unavailable'

const refusal = (body: unknown) =>
  new APICallError({
    message: 'Bad Request',
    url: 'https://provider.test/v1',
    requestBodyValues: {},
    statusCode: 400,
    responseBody: JSON.stringify(body),
    isRetryable: false,
  })

const anthropicRefusal = refusal({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Unable to download the file. Please verify the URL and try again.',
  },
})

const openaiRefusal = refusal({
  error: {
    message: 'Error while downloading file. Upstream status code: 403.',
    type: 'invalid_request_error',
    param: 'url',
    code: 'invalid_value',
  },
})

describe('isMediaUnavailable', () => {
  it('recognises the refusals Anthropic and OpenAI answer for an unreachable image url', () => {
    expect(isMediaUnavailable(anthropicRefusal)).toBe(true)
    expect(isMediaUnavailable(openaiRefusal)).toBe(true)
  })

  it('looks through the stream error the model port throws', () => {
    const wrapped = new ModelStreamError({ message: 'Bad Request', cause: anthropicRefusal })

    expect(isMediaUnavailable(wrapped)).toBe(true)
  })

  it('recognises a failed download on the host', () => {
    const failed = new DownloadError({ url: 'https://blob.fake/x', statusCode: 403 })

    expect(isMediaUnavailable(new ModelStreamError({ message: 'x', cause: failed }))).toBe(true)
  })

  it('leaves every other failure alone', () => {
    const overloaded = refusal({
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    })

    expect(isMediaUnavailable(overloaded)).toBe(false)
    expect(isMediaUnavailable(new Error('Unable to download the file'))).toBe(false)
  })
})
