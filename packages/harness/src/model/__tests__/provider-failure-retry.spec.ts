import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ModelStreamError } from '../errors'
import { EProviderFailureKind as K, EProviderRetry } from '@dltech/atlas-core'

import { never, normalized, transient } from './normalize-fixture'

const UPSTREAM_TEXT = 'The upstream provider returned an error while processing this request.'

const providerError = (args: {
  statusCode?: number
  message?: string
  isRetryable?: boolean
  data?: unknown
  responseHeaders?: Record<string, string>
}): APICallError =>
  new APICallError({
    message: args.message ?? 'upstream said no',
    url: 'https://api.example.com/v1/chat/completions',
    requestBodyValues: {},
    ...(args.statusCode === undefined ? {} : { statusCode: args.statusCode }),
    ...(args.isRetryable === undefined ? {} : { isRetryable: args.isRetryable }),
    ...(args.data === undefined ? {} : { data: args.data }),
    ...(args.responseHeaders === undefined ? {} : { responseHeaders: args.responseHeaders }),
  })

const streamError = (args: {
  statusCode?: number
  message?: string
  isRetryable?: boolean
  data?: unknown
}): StreamProviderError =>
  new StreamProviderError({
    message: args.message ?? 'upstream said no',
    ...(args.statusCode === undefined ? {} : { statusCode: args.statusCode }),
    ...(args.isRetryable === undefined ? {} : { isRetryable: args.isRetryable }),
    ...(args.data === undefined ? {} : { data: args.data }),
  })

const wrapped = (cause: unknown): ModelStreamError =>
  new ModelStreamError({ message: 'wrapped', cause })

const kinds: ReadonlyArray<
  readonly [string, (args: Parameters<typeof providerError>[0]) => unknown]
> = [
  ['an api error', providerError],
  ['a mid-stream provider error', streamError],
  ['a wrapped api error', (args) => wrapped(providerError(args))],
  ['a wrapped mid-stream provider error', (args) => wrapped(streamError(args))],
]

describe.each(kinds)('reading the upstream provider failure off %s', (_name, build) => {
  it('retries a 400 that carries the upstream provider message, whatever the SDK flag says', () => {
    const failure = normalized(
      build({ statusCode: 400, message: UPSTREAM_TEXT, isRetryable: false }),
    )

    expect(failure).toMatchObject({ ...transient(K.Overloaded), statusCode: 400 })
  })

  it('matches that message case-insensitively and trimmed', () => {
    const failure = normalized(
      build({ statusCode: 400, message: `  ${UPSTREAM_TEXT.toUpperCase()}\n` }),
    )

    expect(failure).toMatchObject(transient(K.Overloaded))
  })

  it('does not retry an arbitrary 400', () => {
    expect(normalized(build({ statusCode: 400, message: 'bad tool schema' }))).toMatchObject(
      never(K.InvalidRequest),
    )
  })

  it('does not match the message as a substring', () => {
    const message = `${UPSTREAM_TEXT} Also your prompt is malformed.`

    expect(normalized(build({ statusCode: 400, message }))).toMatchObject(never(K.InvalidRequest))
  })

  it('honors a custom retryable flag on a 400', () => {
    expect(normalized(build({ statusCode: 400, isRetryable: true }))).toMatchObject(
      transient(K.Other),
    )
  })

  it.each([408, 409])('honors the retryable flag on a %i', (statusCode) => {
    expect(normalized(build({ statusCode, isRetryable: true }))).toMatchObject({
      ...transient(K.Other),
      statusCode,
    })
  })

  it.each([401, 402, 403, 404, 413, 422])(
    'keeps %i non-retryable despite the upstream text and a flag',
    (statusCode) => {
      const failure = normalized(build({ statusCode, message: UPSTREAM_TEXT, isRetryable: true }))

      expect(failure.retry).toBe(EProviderRetry.Never)
      expect(failure.statusCode).toBe(statusCode)
    },
  )

  it.each(['upstream_error', 'server_error', 'internal_server_error', 'service_unavailable'])(
    'retries a 400 whose provider code is %s',
    (code) => {
      expect(normalized(build({ statusCode: 400, data: { error: { code } } }))).toMatchObject(
        transient(K.Overloaded),
      )
    },
  )

  it('retries a 400 whose provider type is a server fault', () => {
    expect(
      normalized(build({ statusCode: 400, data: { error: { type: 'server_error' } } })),
    ).toMatchObject(transient(K.Overloaded))
  })

  it.each([
    ['invalid_request_error', K.InvalidRequest],
    ['invalid_request', K.InvalidRequest],
    ['insufficient_quota', K.Quota],
    ['billing_hard_limit_reached', K.Quota],
    ['payment_required', K.Quota],
    ['context_length_exceeded', K.ContextOverflow],
    ['invalid_api_key', K.Auth],
  ])('keeps a 400 flagged retryable fail-fast when the provider says %s', (code, kind) => {
    const failure = normalized(
      build({ statusCode: 400, isRetryable: true, data: { error: { code } } }),
    )

    expect(failure).toMatchObject(never(kind))
  })

  it.each(['invalid_request_error', 'invalid_request'])(
    'lets the upstream message win over the generic %s label',
    (label) => {
      const data = { error: { type: label, code: label } }

      expect(normalized(build({ statusCode: 400, message: UPSTREAM_TEXT, data }))).toMatchObject(
        transient(K.Overloaded),
      )
    },
  )

  it('lets an upstream code win over the generic invalid_request_error type', () => {
    const data = { error: { type: 'invalid_request_error', code: 'upstream_error' } }

    expect(normalized(build({ statusCode: 400, isRetryable: false, data }))).toMatchObject(
      transient(K.Overloaded),
    )
  })

  it.each([
    ['invalid_api_key', K.Auth],
    ['insufficient_quota', K.Quota],
    ['context_length_exceeded', K.ContextOverflow],
    ['billing_hard_limit_reached', K.Quota],
    ['payment_required', K.Quota],
  ])(
    'keeps a 400 fail-fast when a permanent code %s rides with the upstream message',
    (code, kind) => {
      const data = { error: { type: 'invalid_request_error', code } }

      expect(
        normalized(build({ statusCode: 400, message: UPSTREAM_TEXT, isRetryable: true, data })),
      ).toMatchObject(never(kind))
    },
  )

  it('does not block existing 429 and 5xx behavior with an invalid-request identifier', () => {
    const data = { error: { code: 'invalid_request_error' } }

    expect(normalized(build({ statusCode: 503, data }))).toMatchObject(transient(K.Overloaded))
    expect(normalized(build({ statusCode: 429, data }))).toMatchObject(transient(K.RateLimited))
  })
})

describe('keeping the retry-after on an upstream provider failure', () => {
  it('carries retryAt next to the classification', () => {
    const failure = normalized(
      providerError({
        statusCode: 400,
        message: UPSTREAM_TEXT,
        responseHeaders: { 'retry-after': '7' },
      }),
    )

    expect(failure).toMatchObject(transient(K.Overloaded))
    expect(failure.retryAt).toBe('2026-10-31T12:00:07.000Z')
  })
})

describe('refusing to trust the upstream text without a provider error', () => {
  it('refuses a plain Error carrying the upstream text', () => {
    expect(normalized(new Error(UPSTREAM_TEXT))).toMatchObject(never(K.Other))
  })

  it('refuses a wrapped plain Error carrying the upstream text', () => {
    expect(normalized(wrapped(new Error(UPSTREAM_TEXT)))).toMatchObject(never(K.Other))
  })
})

describe('reading a mid-stream provider error that carries no status', () => {
  it('retries one that carries the exact upstream message despite isRetryable false', () => {
    const error = streamError({ message: UPSTREAM_TEXT, isRetryable: false })

    expect(normalized(error)).toMatchObject(transient(K.Overloaded))
    expect(normalized(wrapped(error))).toMatchObject(transient(K.Overloaded))
  })

  it('matches the message case-insensitively and trimmed', () => {
    expect(
      normalized(
        streamError({ message: `\n ${UPSTREAM_TEXT.toUpperCase()} `, isRetryable: false }),
      ),
    ).toMatchObject(transient(K.Overloaded))
  })

  it.each(['upstream_error', 'server_error', 'internal_server_error', 'service_unavailable'])(
    'retries one whose provider code is %s',
    (code) => {
      expect(
        normalized(streamError({ isRetryable: false, data: { error: { code } } })),
      ).toMatchObject(transient(K.Overloaded))
    },
  )

  it('lets the upstream message win over the generic invalid_request_error label', () => {
    const data = { error: { type: 'invalid_request_error' } }

    expect(
      normalized(streamError({ message: UPSTREAM_TEXT, isRetryable: false, data })),
    ).toMatchObject(transient(K.Overloaded))
    const invalid = streamError({ message: 'bad tool schema', isRetryable: true, data })
    expect(normalized(invalid)).toMatchObject(never(K.Other))
    expect(normalized(wrapped(invalid))).toMatchObject(never(K.Other))
  })

  it('refuses an unrecognised message with no status', () => {
    expect(
      normalized(streamError({ message: 'bad tool schema', isRetryable: false })),
    ).toMatchObject(never(K.Other))
  })

  it('refuses a message that merely contains the upstream text', () => {
    expect(
      normalized(streamError({ message: `${UPSTREAM_TEXT} Plus more.`, isRetryable: false })),
    ).toMatchObject(never(K.Other))
  })

  it.each([
    ['invalid_api_key', K.Auth],
    ['insufficient_quota', K.Quota],
    ['context_length_exceeded', K.ContextOverflow],
    ['billing_hard_limit_reached', K.Quota],
    ['payment_required', K.Quota],
  ])('refuses a no-status error coded %s even with the upstream message', (code, kind) => {
    const data = { error: { code } }

    for (const isRetryable of [false, true]) {
      const error = streamError({ message: UPSTREAM_TEXT, isRetryable, data })
      expect(normalized(error)).toMatchObject(never(kind))
      expect(normalized(wrapped(error))).toMatchObject(never(kind))
    }
  })

  it('refuses a no-status billing error with an invalid-request label', () => {
    const data = { error: { type: 'invalid_request_error', code: 'insufficient_quota' } }

    expect(normalized(streamError({ message: 'billing hard limit reached', data })).retry).toBe(
      EProviderRetry.Never,
    )
  })
})
