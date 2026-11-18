import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import { InvalidResponseDataError, StreamProviderError } from 'ai'

import { EProviderFailureKind, EProviderRetry } from '@dltech/atlas-core'

import { ModelStreamError, StreamStallError } from '@dltech/atlas-agent'
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

  const withCode = (code: string, message: string): Error =>
    Object.assign(new Error(message), { code })

  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'UND_ERR_SOCKET'])(
    'reads code %p as a dropped connection, which has no status',
    (code) => {
      const failure = normalized(withCode(code, 'whatever the runtime worded it'))

      expect(failure).toMatchObject(transient(EProviderFailureKind.Network))
      expect(failure.statusCode).toBeUndefined()
    },
  )

  it('reads the code on the cause of a fetch failure', () => {
    const error = new TypeError('fetch failed', { cause: withCode('UND_ERR_SOCKET', 'closed') })

    expect(normalized(error)).toMatchObject(transient(EProviderFailureKind.Network))
  })

  it.each(['fetch failed', 'socket hang up', 'terminated', 'Connection closed.'])(
    'does not read the bare message %p as a dropped connection',
    (message) => {
      expect(normalized(new Error(message))).toMatchObject(never(EProviderFailureKind.Other))
    },
  )

  it('does not retry a 400 whose message says the session was terminated', () => {
    const error = new APICallError({
      message: 'session terminated by the user',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 400,
    })

    expect(normalized(error).retry).toBe(EProviderRetry.Never)
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
