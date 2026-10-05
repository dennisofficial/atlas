import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ModelStreamError } from '../errors'
import { providerErrorOf } from '../provider-error'

const apiError = (args: { data?: unknown; responseBody?: string }): APICallError =>
  new APICallError({
    message: 'secret message sk-live-123',
    url: 'https://api.example.com/v1/chat?key=secret',
    requestBodyValues: { prompt: 'secret prompt' },
    statusCode: 400,
    responseHeaders: { authorization: 'Bearer secret' },
    ...(args.data === undefined ? {} : { data: args.data }),
    ...(args.responseBody === undefined ? {} : { responseBody: args.responseBody }),
  })

describe('reading the provider identifiers off an error', () => {
  it('takes code and type from the nested error in structured data', () => {
    const error = apiError({
      data: {
        error: { message: 'x', type: 'server_error', code: 'upstream_error' },
      },
    })

    expect(providerErrorOf(error)).toEqual({
      providerCode: 'upstream_error',
      providerType: 'server_error',
    })
  })

  it('accepts a numeric code', () => {
    expect(providerErrorOf(apiError({ data: { error: { code: 502 } } }))).toEqual({ providerCode: 502 })
  })

  it('falls back to the response body when there is no structured data', () => {
    const responseBody = JSON.stringify({
      error: { message: 'x', type: 'invalid_request_error', code: 'bad' },
    })

    expect(providerErrorOf(apiError({ responseBody }))).toEqual({
      providerCode: 'bad',
      providerType: 'invalid_request_error',
    })
  })

  it('prefers structured data over the response body', () => {
    const responseBody = JSON.stringify({ error: { code: 'from_body' } })

    expect(providerErrorOf(apiError({ data: { error: { code: 'from_data' } }, responseBody }))).toEqual({
      providerCode: 'from_data',
    })
  })

  it('fills a missing code from the response body while keeping the structured type', () => {
    const data = { error: { type: 'invalid_request_error' } }
    const responseBody = JSON.stringify({ error: { type: 'server_error', code: 'insufficient_quota' } })
    expect(providerErrorOf(apiError({ data, responseBody }))).toEqual({
      providerType: 'invalid_request_error',
      providerCode: 'insufficient_quota',
    })
  })

  it('fills a missing type without replacing a structured code', () => {
    const data = { error: { code: 'insufficient_quota' } }
    const responseBody = JSON.stringify({ error: { type: 'invalid_request_error', code: 'upstream_error' } })
    expect(providerErrorOf(apiError({ data, responseBody }))).toEqual({
      providerType: 'invalid_request_error',
      providerCode: 'insufficient_quota',
    })
  })

  it('reads a stream provider error', () => {
    const error = new StreamProviderError({
      message: 'm',
      data: { error: { code: 'service_unavailable' } },
    })

    expect(providerErrorOf(error)).toEqual({
      providerCode: 'service_unavailable',
    })
  })

  it('reads through the stream error the port wrapped it in', () => {
    const wrapped = new ModelStreamError({
      message: 'boom',
      cause: apiError({ data: { error: { type: 'server_error' } } }),
    })

    expect(providerErrorOf(wrapped)).toEqual({ providerType: 'server_error' })
  })

  it('ignores top-level code and type, which are not the provider error object', () => {
    expect(providerErrorOf(apiError({ data: { code: 'top', type: 'top' } }))).toEqual({})
  })

  it.each([[null], [undefined], ['text'], [42], [{}], [[]], [{ data: 'str' }]])('returns nothing for %p', (value) => {
    expect(providerErrorOf(value)).toEqual({})
  })
})

describe('reading an error that is not a provider error', () => {
  it('returns nothing for a plain Error', () => {
    expect(providerErrorOf(new TypeError('plain'))).toEqual({})
  })
})

describe('bounding what leaves the provider error', () => {
  it('drops identifiers longer than eighty characters', () => {
    const error = apiError({
      data: { error: { code: 'a'.repeat(81), type: 'a'.repeat(80) } },
    })

    expect(providerErrorOf(error)).toEqual({ providerType: 'a'.repeat(80) })
  })

  it.each(['has space', 'new\nline', 'sk-live-123 secret', 'quo"te', '', 'émoji', '<script>'])(
    'drops the identifier %p, which is not an identifier',
    (code) => {
      expect(providerErrorOf(apiError({ data: { error: { code } } }))).toEqual({})
    },
  )

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [true], [null], [{}], [['a']]])(
    'drops the non-identifier %p',
    (code) => {
      expect(providerErrorOf(apiError({ data: { error: { code, type: code } } }))).toEqual({})
    },
  )

  it('does not parse a response body over sixteen thousand characters', () => {
    const padding = 'x'.repeat(16_384)
    const responseBody = JSON.stringify({
      error: { code: 'upstream_error' },
      padding,
    })

    expect(responseBody.length).toBeGreaterThan(16_384)
    expect(providerErrorOf(apiError({ responseBody }))).toEqual({})
  })

  it('parses a response body of exactly the limit', () => {
    const base = JSON.stringify({ error: { code: 'upstream_error' }, p: '' })
    const responseBody = JSON.stringify({
      error: { code: 'upstream_error' },
      p: 'x'.repeat(16_384 - base.length),
    })

    expect(responseBody.length).toBe(16_384)
    expect(providerErrorOf(apiError({ responseBody }))).toEqual({
      providerCode: 'upstream_error',
    })
  })

  it('does not throw on a malformed response body', () => {
    expect(providerErrorOf(apiError({ responseBody: '{"error": {' }))).toEqual({})
  })

  it('does not throw on data that throws when read', () => {
    const hostile = {
      get error(): unknown {
        throw new Error('nope')
      },
    }

    expect(providerErrorOf(apiError({ data: hostile }))).toEqual({})
  })

  it('does not throw on circular data', () => {
    const circular: Record<string, unknown> = {}
    circular.error = circular

    expect(providerErrorOf(apiError({ data: circular }))).toEqual({})
  })

  it('never carries the message, url, headers, request body or response body', () => {
    const responseBody = JSON.stringify({
      error: { message: 'secret body', code: 'upstream_error' },
    })
    const result = providerErrorOf(apiError({ responseBody }))

    expect(Object.keys(result).sort()).toEqual(['providerCode'])
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
