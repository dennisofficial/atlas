import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import { InvalidResponseDataError, StreamProviderError } from 'ai'

import { EProviderFailureKind, EProviderRetry } from '@dltech/atlas-core'

import { ModelStreamError, StreamStallError } from '../errors'
import { normalizeProviderFailure } from '../failure'
import { never, normalized, NOW_MS, transient } from './normalize-fixture'

const apiError = (args: {
  statusCode?: number
  responseHeaders?: Record<string, string>
}): APICallError =>
  new APICallError({
    message: 'upstream said no',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    ...(args.statusCode === undefined ? {} : { statusCode: args.statusCode }),
    ...(args.responseHeaders === undefined ? {} : { responseHeaders: args.responseHeaders }),
  })

describe('normalizing whatever the provider threw', () => {
  it('takes the status straight off an api error', () => {
    expect(normalized(apiError({ statusCode: 529 }))).toMatchObject({
      ...transient(EProviderFailureKind.Overloaded),
      statusCode: 529,
    })
  })

  it('reads a bare 429 as rate limited', () => {
    expect(normalized(apiError({ statusCode: 429 }))).toMatchObject({
      ...transient(EProviderFailureKind.RateLimited),
      statusCode: 429,
    })
  })

  it('unwraps the stream error the port wrapped the provider error in', () => {
    const wrapped = new ModelStreamError({
      message: 'overloaded',
      cause: apiError({ statusCode: 529 }),
    })

    expect(normalized(wrapped)).toMatchObject({
      ...transient(EProviderFailureKind.Overloaded),
      statusCode: 529,
    })
  })

  it('reads a stream stall as stalled, even wrapped', () => {
    const stall = new StreamStallError('silent')

    expect(normalized(stall)).toMatchObject(transient(EProviderFailureKind.Stalled))
    expect(normalized(new ModelStreamError({ message: 'x', cause: stall }))).toMatchObject(
      transient(EProviderFailureKind.Stalled),
    )
  })

  it.each([
    'fetch failed',
    'socket hang up',
    'terminated',
    'read ECONNRESET',
    'connect ETIMEDOUT 1.2.3.4:443',
    'Connection closed.',
  ])('reads %p as a dropped connection, which has no status', (message) => {
    const failure = normalized(new Error(message))

    expect(failure).toMatchObject(transient(EProviderFailureKind.Network))
    expect(failure.statusCode).toBeUndefined()
  })

  it('takes the status off a mid-stream provider error', () => {
    const error = new StreamProviderError({ message: 'upstream exploded', statusCode: 500 })

    expect(normalized(error)).toMatchObject({
      ...transient(EProviderFailureKind.Overloaded),
      statusCode: 500,
    })
  })

  it('trusts a mid-stream provider error the provider flagged retryable', () => {
    const error = new StreamProviderError({ message: 'try again', isRetryable: true })

    expect(normalized(error)).toMatchObject(transient(EProviderFailureKind.Network))
  })

  it("reads litellm's dropped upstream connection as transient", () => {
    const error = new StreamProviderError({
      message: 'litellm.APIConnectionError: APIConnectionError: UpstreamError - Connection closed.',
    })

    expect(normalized(error)).toMatchObject(transient(EProviderFailureKind.Network))
  })

  it('refuses a mid-stream provider error with no status, no flag, and an unrecognised message', () => {
    expect(
      normalized(new StreamProviderError({ message: 'billing hard limit reached' })),
    ).toMatchObject(never(EProviderFailureKind.Other))
  })

  it('reads a stream that ended without a finish reason as a dropped connection', () => {
    const error = new InvalidResponseDataError({
      data: undefined,
      message: 'Response stream ended without a finish reason.',
    })

    expect(normalized(error)).toMatchObject(transient(EProviderFailureKind.Network))
    expect(normalized(new ModelStreamError({ message: 'x', cause: error }))).toMatchObject(
      transient(EProviderFailureKind.Network),
    )
  })

  it('refuses invalid response data that is not a truncated stream', () => {
    const error = new InvalidResponseDataError({
      data: {},
      message: "Expected 'id' to be a string.",
    })

    expect(normalized(error)).toMatchObject(never(EProviderFailureKind.Other))
  })

  it('reads an AbortSignal.timeout reason as a dropped connection, even wrapped', () => {
    const timedOut = new DOMException('The operation timed out.', 'TimeoutError')

    expect(normalized(timedOut)).toMatchObject(transient(EProviderFailureKind.Network))
    expect(normalized(new ModelStreamError({ message: 'x', cause: timedOut }))).toMatchObject(
      transient(EProviderFailureKind.Network),
    )
  })

  it('reads an explicit caller abort as cancelled, not a provider fault', () => {
    const aborted = normalizeProviderFailure({
      cause: new DOMException('The operation was aborted.', 'AbortError'),
      cancelled: true,
      nowMs: NOW_MS,
    })

    expect(aborted).toMatchObject(never(EProviderFailureKind.Cancelled))
    expect(aborted.retry).toBe(EProviderRetry.Never)
  })

  it('refuses to call a programming error transient', () => {
    expect(normalized(new TypeError('x.map is not a function'))).toMatchObject(
      never(EProviderFailureKind.Other),
    )
  })

  it('refuses a plain string', () => {
    expect(normalized('something went wrong')).toMatchObject(never(EProviderFailureKind.Other))
  })

  it('walks a cyclic cause chain without looping', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    Object.assign(first, { cause: second })

    expect(normalized(first)).toMatchObject(never(EProviderFailureKind.Other))
  })

  it('stops looking for a provider error past eight links', () => {
    let cause: unknown = apiError({ statusCode: 529 })
    for (let depth = 0; depth < 9; depth += 1) cause = new Error('wrapper', { cause })

    expect(normalized(cause)).toMatchObject(never(EProviderFailureKind.Other))
  })

  it('normalizes the same failure object once, so a later clock never recomputes a hint', () => {
    const error = apiError({ statusCode: 429, responseHeaders: { 'retry-after': '30' } })

    const first = normalized(error, 1_000_000)
    const later = normalized(error, 9_000_000)

    expect(later).toBe(first)
  })
})
