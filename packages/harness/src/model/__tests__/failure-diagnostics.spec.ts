import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ModelStreamError } from '../errors'
import { modelFailureDiagnosticsOf } from '../failure-diagnostics'

const UPSTREAM_ENVELOPE = {
  error: {
    message: 'boom with details',
    type: 'server_error',
    code: 'upstream_error',
  },
}

const apiError = (args: {
  statusCode?: number
  isRetryable?: boolean
  data?: unknown
  responseBody?: string
}): APICallError =>
  new APICallError({
    message: 'The upstream provider returned an error while processing this request.',
    url: 'https://user:hunter2@api.example.com/v1/chat?key=sk-url-secret',
    requestBodyValues: { prompt: 'prompt-secret' },
    responseHeaders: {
      Authorization: 'Bearer sk-header-secret',
      'set-cookie': 'session-secret',
    },
    responseBody: args.responseBody ?? '{"error":{"message":"body-secret","code":"upstream_error"}}',
    ...(args.statusCode === undefined ? {} : { statusCode: args.statusCode }),
    ...(args.isRetryable === undefined ? {} : { isRetryable: args.isRetryable }),
    ...(args.data === undefined ? {} : { data: args.data }),
  })

describe('safe diagnostics read off a model failure', () => {
  it('has nothing to say about a plain error', () => {
    expect(modelFailureDiagnosticsOf(new Error('boom'))).toEqual({})
  })

  it('has nothing to say about a thrown string or nothing at all', () => {
    expect(modelFailureDiagnosticsOf('boom')).toEqual({})
    expect(modelFailureDiagnosticsOf(undefined)).toEqual({})
    expect(modelFailureDiagnosticsOf(null)).toEqual({})
  })

  it('reports status, the sdk retry flag, and the provider code and type of an api error', () => {
    const diagnostics = modelFailureDiagnosticsOf(
      apiError({
        statusCode: 400,
        isRetryable: false,
        data: UPSTREAM_ENVELOPE,
      }),
    )

    expect(diagnostics).toEqual({
      statusCode: 400,
      isRetryable: false,
      providerCode: 'upstream_error',
      providerType: 'server_error',
    })
  })

  it('reaches the api error through the stream error the port wrapped it in', () => {
    const wrapped = new ModelStreamError({
      message: 'stream failed',
      cause: apiError({
        statusCode: 400,
        isRetryable: false,
        data: UPSTREAM_ENVELOPE,
      }),
    })

    expect(modelFailureDiagnosticsOf(wrapped)).toEqual({
      statusCode: 400,
      isRetryable: false,
      providerCode: 'upstream_error',
      providerType: 'server_error',
    })
  })

  it('omits the status when the response never carried one', () => {
    const diagnostics = modelFailureDiagnosticsOf(apiError({ isRetryable: true }))

    expect(diagnostics).not.toHaveProperty('statusCode')
    expect(diagnostics).toMatchObject({ isRetryable: true })
  })

  it('keeps the original status on a provider stream error', () => {
    const diagnostics = modelFailureDiagnosticsOf(
      new StreamProviderError({
        message: 'upstream exploded',
        statusCode: 400,
        isRetryable: false,
      }),
    )

    expect(diagnostics).toMatchObject({ statusCode: 400, isRetryable: false })
  })

  it('survives data that is not an envelope', () => {
    const error = apiError({
      statusCode: 400,
      data: 'not an envelope',
      responseBody: 'upstream down',
    })

    expect(() => modelFailureDiagnosticsOf(error)).not.toThrow()
    const diagnostics = modelFailureDiagnosticsOf(error)

    expect(diagnostics).not.toHaveProperty('providerCode')
    expect(diagnostics).not.toHaveProperty('providerType')
  })

  it('never carries the url, headers, request body, response body, data, or message', () => {
    const wrapped = new ModelStreamError({
      message: 'wrapper-secret',
      cause: apiError({
        statusCode: 400,
        isRetryable: false,
        data: UPSTREAM_ENVELOPE,
      }),
    })

    const serialized = JSON.stringify(modelFailureDiagnosticsOf(wrapped))

    for (const secret of [
      'hunter2',
      'sk-url-secret',
      'sk-header-secret',
      'Authorization',
      'prompt-secret',
      'session-secret',
      'body-secret',
      'boom with details',
      'upstream provider returned',
      'wrapper-secret',
      'api.example.com',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })
})
