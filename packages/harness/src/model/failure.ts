import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import type { ModelFailure } from '@dltech/atlas-core'

import { ModelStreamError, StreamStallError } from './errors'
import { providerErrorOf } from './provider-error'

const DROPPED_CONNECTION = [
  'fetch failed',
  'socket hang up',
  'terminated',
  'network request failed',
  'connection closed',
  'econnreset',
  'econnrefused',
  'etimedout',
  'epipe',
  'enotfound',
  'und_err_socket',
  'without a finish reason',
]

const SECONDS = 1_000

const DROPPED: ModelFailure = {}

const UPSTREAM_FAILURE_MESSAGE = 'the upstream provider returned an error while processing this request.'

const UPSTREAM_FAILURE_IDENTIFIERS: ReadonlySet<string> = new Set([
  'upstream_error',
  'server_error',
  'internal_server_error',
  'service_unavailable',
])

const GENERIC_INVALID_REQUEST_IDENTIFIERS: ReadonlySet<string> = new Set(['invalid_request_error', 'invalid_request'])

const PERMANENT_IDENTIFIERS: ReadonlySet<string> = new Set([
  'invalid_api_key',
  'insufficient_quota',
  'context_length_exceeded',
  'billing_hard_limit_reached',
  'payment_required',
])

const TOO_MANY_REQUESTS = 429
const FIRST_SERVER_ERROR = 500
const PERMANENT_CLIENT_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 404, 413, 422])

function retryAfterMsOf(headers: Record<string, string> | undefined): number | undefined {
  const header = headers?.['retry-after']
  if (header === undefined) return undefined

  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * SECONDS : undefined
}

const looksLikeDroppedConnection = (message: string): boolean => {
  const lowered = message.toLowerCase()
  return DROPPED_CONNECTION.some((needle) => lowered.includes(needle))
}

type ProviderFailureSource = {
  error: APICallError | StreamProviderError
  statusCode: number
}

const identifiersOf = (error: unknown): string[] => {
  const { providerCode, providerType } = providerErrorOf(error)
  return [providerCode, providerType].filter((value): value is string => typeof value === 'string')
}

function providerRetryHintOf(error: APICallError | StreamProviderError): boolean | undefined {
  const identifiers = identifiersOf(error)
  if (identifiers.some((identifier) => PERMANENT_IDENTIFIERS.has(identifier))) return false
  if (error.message.trim().toLowerCase() === UPSTREAM_FAILURE_MESSAGE) return true
  if (identifiers.some((identifier) => UPSTREAM_FAILURE_IDENTIFIERS.has(identifier))) return true
  if (identifiers.some((identifier) => GENERIC_INVALID_REQUEST_IDENTIFIERS.has(identifier))) return false
  return error.isRetryable ? true : undefined
}

function retryableOverrideOf(source: ProviderFailureSource): boolean {
  const { error, statusCode } = source
  if (statusCode === TOO_MANY_REQUESTS || statusCode >= FIRST_SERVER_ERROR) return false
  if (PERMANENT_CLIENT_STATUSES.has(statusCode)) return false
  return providerRetryHintOf(error) === true
}

const failureOfStatus = (source: ProviderFailureSource): ModelFailure => ({
  status: source.statusCode,
  ...(retryableOverrideOf(source) ? { retryable: true } : {}),
})

export function modelFailureOf(error: unknown): ModelFailure | null {
  if (error instanceof StreamStallError) return DROPPED

  if (error instanceof ModelStreamError) return modelFailureOf(error.cause)

  if (APICallError.isInstance(error)) {
    if (error.statusCode === undefined && providerRetryHintOf(error) === false) return null
    const retryAfterMs = retryAfterMsOf(error.responseHeaders)
    const status =
      error.statusCode === undefined
        ? {}
        : failureOfStatus({
            error,
            statusCode: error.statusCode,
          })
    return {
      ...status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    }
  }

  if (StreamProviderError.isInstance(error)) {
    if (error.statusCode !== undefined) {
      return failureOfStatus({
        error,
        statusCode: error.statusCode,
      })
    }
    const hint = providerRetryHintOf(error)
    if (hint === false) return null
    if (hint === true) return DROPPED
  }

  // AbortSignal.timeout() aborts with a DOMException named 'TimeoutError', which carries no
  // status and matches none of the message needles.
  if (error instanceof Error && error.name === 'TimeoutError') return DROPPED

  if (error instanceof Error && looksLikeDroppedConnection(error.message)) return DROPPED

  return null
}
