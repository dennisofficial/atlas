import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ModelStreamError } from '../errors'
import { modelFailureOf } from '../failure'

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

const streamError = (args: { statusCode?: number; message?: string; isRetryable?: boolean; data?: unknown }): StreamProviderError =>
  new StreamProviderError({
    message: args.message ?? 'upstream said no',
    ...(args.statusCode === undefined ? {} : { statusCode: args.statusCode }),
    ...(args.isRetryable === undefined ? {} : { isRetryable: args.isRetryable }),
    ...(args.data === undefined ? {} : { data: args.data }),
  })

const wrapped = (cause: unknown): ModelStreamError => new ModelStreamError({ message: 'wrapped', cause })

const kinds: ReadonlyArray<readonly [string, (args: Parameters<typeof providerError>[0]) => unknown]> = [
  ['an api error', providerError],
  ['a mid-stream provider error', streamError],
  ['a wrapped api error', (args) => wrapped(providerError(args))],
  ['a wrapped mid-stream provider error', (args) => wrapped(streamError(args))],
]

describe.each(kinds)('reading the upstream provider failure off %s', (_name, build) => {
  it('retries a 400 that carries the upstream provider message, whatever the SDK flag says', () => {
    const failure = modelFailureOf(build({ statusCode: 400, message: UPSTREAM_TEXT, isRetryable: false }))

    expect(failure).toEqual({ status: 400, retryable: true })
  })

  it('matches that message case-insensitively and trimmed', () => {
    const failure = modelFailureOf(
      build({
        statusCode: 400,
        message: `  ${UPSTREAM_TEXT.toUpperCase()}\n`,
      }),
    )

    expect(failure).toEqual({ status: 400, retryable: true })
  })

  it('does not retry an arbitrary 400', () => {
    expect(modelFailureOf(build({ statusCode: 400, message: 'bad tool schema' }))).toEqual({ status: 400 })
  })

  it('does not match the message as a substring', () => {
    const message = `${UPSTREAM_TEXT} Also your prompt is malformed.`

    expect(modelFailureOf(build({ statusCode: 400, message }))).toEqual({
      status: 400,
    })
  })

  it('honors a custom retryable flag on a 400', () => {
    expect(modelFailureOf(build({ statusCode: 400, isRetryable: true }))).toEqual({ status: 400, retryable: true })
  })

  it.each([408, 409])('honors the retryable flag on a %i', (statusCode) => {
    expect(modelFailureOf(build({ statusCode, isRetryable: true }))).toEqual({
      status: statusCode,
      retryable: true,
    })
  })

  it.each([401, 402, 403, 404, 413, 422])('keeps %i non-retryable despite the upstream text and a flag', (statusCode) => {
    const failure = modelFailureOf(build({ statusCode, message: UPSTREAM_TEXT, isRetryable: true }))

    expect(failure).toEqual({ status: statusCode })
  })

  it.each(['upstream_error', 'server_error', 'internal_server_error', 'service_unavailable'])(
    'retries a 400 whose provider code is %s',
    (code) => {
      const failure = modelFailureOf(build({ statusCode: 400, data: { error: { code } } }))

      expect(failure).toEqual({ status: 400, retryable: true })
    },
  )

  it('retries a 400 whose provider type is a server fault', () => {
    const failure = modelFailureOf(build({ statusCode: 400, data: { error: { type: 'server_error' } } }))

    expect(failure).toEqual({ status: 400, retryable: true })
  })

  it.each([
    'invalid_request_error',
    'invalid_request',
    'invalid_api_key',
    'insufficient_quota',
    'context_length_exceeded',
    'billing_hard_limit_reached',
    'payment_required',
  ])('keeps a 400 flagged retryable fail-fast when the provider says %s', (code) => {
    const failure = modelFailureOf(
      build({
        statusCode: 400,
        isRetryable: true,
        data: { error: { code } },
      }),
    )

    expect(failure).toEqual({ status: 400 })
  })

  it.each(['invalid_request_error', 'invalid_request'])('lets the upstream message win over the generic %s label', (label) => {
    const data = { error: { type: label, code: label } }

    expect(modelFailureOf(build({ statusCode: 400, message: UPSTREAM_TEXT, data }))).toEqual({
      status: 400,
      retryable: true,
    })
  })

  it('lets an upstream code win over the generic invalid_request_error type', () => {
    const data = {
      error: { type: 'invalid_request_error', code: 'upstream_error' },
    }

    expect(modelFailureOf(build({ statusCode: 400, isRetryable: false, data }))).toEqual({
      status: 400,
      retryable: true,
    })
  })

  it.each(['invalid_api_key', 'insufficient_quota', 'context_length_exceeded', 'billing_hard_limit_reached', 'payment_required'])(
    'keeps a 400 fail-fast when a permanent code %s rides with the upstream message',
    (code) => {
      const data = { error: { type: 'invalid_request_error', code } }

      expect(
        modelFailureOf(
          build({
            statusCode: 400,
            message: UPSTREAM_TEXT,
            isRetryable: true,
            data,
          }),
        ),
      ).toEqual({
        status: 400,
      })
    },
  )

  it('does not block existing 429 and 5xx behavior with an invalid-request identifier', () => {
    const data = { error: { code: 'invalid_request_error' } }

    expect(modelFailureOf(build({ statusCode: 503, data }))).toEqual({
      status: 503,
    })
    expect(modelFailureOf(build({ statusCode: 429, data }))).toEqual({
      status: 429,
    })
  })

  it('does not add a retryable override to statuses core already retries', () => {
    expect(modelFailureOf(build({ statusCode: 502, message: UPSTREAM_TEXT }))).toEqual({ status: 502 })
  })
})

describe('keeping the retry-after on an upstream provider failure', () => {
  it('carries retry-after next to the override', () => {
    const failure = modelFailureOf(
      providerError({
        statusCode: 400,
        message: UPSTREAM_TEXT,
        responseHeaders: { 'retry-after': '7' },
      }),
    )

    expect(failure).toEqual({
      status: 400,
      retryable: true,
      retryAfterMs: 7_000,
    })
  })
})

describe('refusing to trust the upstream text without a provider error', () => {
  it('refuses a plain Error carrying the upstream text', () => {
    expect(modelFailureOf(new Error(UPSTREAM_TEXT))).toBeNull()
  })

  it('refuses a wrapped plain Error carrying the upstream text', () => {
    expect(modelFailureOf(wrapped(new Error(UPSTREAM_TEXT)))).toBeNull()
  })

  it('refuses an api error with the upstream text and no status', () => {
    expect(modelFailureOf(providerError({ message: UPSTREAM_TEXT, isRetryable: false }))).toEqual({})
  })
})

describe('reading a mid-stream provider error that carries no status', () => {
  it('retries one that carries the exact upstream message despite isRetryable false', () => {
    const error = streamError({ message: UPSTREAM_TEXT, isRetryable: false })

    expect(modelFailureOf(error)).toEqual({})
    expect(modelFailureOf(wrapped(error))).toEqual({})
  })

  it('matches the message case-insensitively and trimmed', () => {
    expect(
      modelFailureOf(
        streamError({
          message: `\n ${UPSTREAM_TEXT.toUpperCase()} `,
          isRetryable: false,
        }),
      ),
    ).toEqual({})
  })

  it.each(['upstream_error', 'server_error', 'internal_server_error', 'service_unavailable'])(
    'retries one whose provider code is %s',
    (code) => {
      expect(modelFailureOf(streamError({ isRetryable: false, data: { error: { code } } }))).toEqual({})
    },
  )

  it('retries one whose provider type is an upstream identifier', () => {
    expect(
      modelFailureOf(
        streamError({
          isRetryable: false,
          data: { error: { type: 'server_error' } },
        }),
      ),
    ).toEqual({})
  })

  it('lets the upstream message win over the generic invalid_request_error label', () => {
    const data = { error: { type: 'invalid_request_error' } }

    expect(modelFailureOf(streamError({ message: UPSTREAM_TEXT, isRetryable: false, data }))).toEqual({})
  })

  it('refuses an unrecognised message with no status', () => {
    expect(modelFailureOf(streamError({ message: 'bad tool schema', isRetryable: false }))).toBeNull()
  })

  it('refuses a message that merely contains the upstream text', () => {
    expect(
      modelFailureOf(
        streamError({
          message: `${UPSTREAM_TEXT} Plus more.`,
          isRetryable: false,
        }),
      ),
    ).toBeNull()
  })

  it.each(['invalid_api_key', 'insufficient_quota', 'context_length_exceeded', 'billing_hard_limit_reached', 'payment_required'])(
    'refuses a no-status billing or limit error coded %s even with the upstream message',
    (code) => {
      const data = { error: { code } }

      expect(modelFailureOf(streamError({ message: UPSTREAM_TEXT, isRetryable: false, data }))).toBeNull()
    },
  )

  it('refuses a no-status billing error with an invalid-request label', () => {
    const data = {
      error: { type: 'invalid_request_error', code: 'insufficient_quota' },
    }

    expect(modelFailureOf(streamError({ message: 'billing hard limit reached', data }))).toBeNull()
  })
})
