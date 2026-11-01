import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'

import { retryAtOf } from '../provider-reset'
import { NOW_MS, normalized } from './normalize-fixture'

const at = (headers: Record<string, string> | undefined) => retryAtOf({ headers, nowMs: NOW_MS })

describe('reading a not-before instant off Retry-After', () => {
  it('converts numeric seconds against the supplied clock', () => {
    expect(at({ 'retry-after': '12' })).toBe('2026-10-31T12:00:12.000Z')
  })

  it('accepts zero seconds as now', () => {
    expect(at({ 'retry-after': '0' })).toBe('2026-10-31T12:00:00.000Z')
  })

  it('parses an HTTP-date as an absolute instant', () => {
    expect(at({ 'retry-after': 'Sat, 31 Oct 2026 12:05:00 GMT' })).toBe('2026-10-31T12:05:00.000Z')
  })

  it('matches the header name case-insensitively', () => {
    expect(at({ 'Retry-After': '5' })).toBe('2026-10-31T12:00:05.000Z')
  })

  it('keeps a past HTTP-date as the instant it names', () => {
    expect(at({ 'retry-after': 'Sat, 31 Oct 2026 11:00:00 GMT' })).toBe('2026-10-31T11:00:00.000Z')
  })

  it.each(['-5', 'NaN', 'Infinity', '1e3', '', 'soon', '12 seconds', 'not a date, really'])(
    'rejects %p',
    (value) => {
      expect(at({ 'retry-after': value })).toBeUndefined()
    },
  )

  it('is absent without headers', () => {
    expect(at(undefined)).toBeUndefined()
    expect(at({})).toBeUndefined()
  })
})

describe('carrying the hint on a normalized failure', () => {
  const failure = (args: { headers?: Record<string, string>; body?: string }) =>
    new APICallError({
      message: 'slow down',
      url: 'https://api.example.com',
      requestBodyValues: {},
      statusCode: 429,
      ...(args.headers === undefined ? {} : { responseHeaders: args.headers }),
      ...(args.body === undefined ? {} : { responseBody: args.body }),
    })

  it('sets retryAt from the header and leaves resetAt undefined', () => {
    const result = normalized(failure({ headers: { 'retry-after': '7' } }))

    expect(result.retryAt).toBe('2026-10-31T12:00:07.000Z')
    expect(result.resetAt).toBeUndefined()
  })

  it('does not accept usage-endpoint reset fields from an error body', () => {
    const body = JSON.stringify({
      error: { message: 'slow down', resets_at: '2026-11-01T00:00:00Z' },
    })
    const result = normalized(failure({ body }))

    expect(result.retryAt).toBeUndefined()
    expect(result.resetAt).toBeUndefined()
  })
})
