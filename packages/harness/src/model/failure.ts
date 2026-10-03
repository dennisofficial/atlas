import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import type { ModelFailure } from '@dltech/atlas-core'

import { ModelStreamError, StreamStallError } from './errors'

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

// SGLang rejects oversized requests with text like "Multimodal prompt is too long after expanding
// multimodal tokens ... 250000 >= 249994" — any image in the request (even a small one) routes it
// into this multimodal branch, and the identical retry can land on a replica with a bigger pool.
const PROMPT_TOO_LONG: readonly RegExp[] = [
  /prompt is too long/i,
  /too many tokens/i,
  /context[ _-]?(length|window).{0,20}(exceed|too long)/i,
  /too long after expanding multimodal tokens.*>= ?\d+/i,
]

const looksLikePromptTooLong = (message: string): boolean =>
  PROMPT_TOO_LONG.some((pattern) => pattern.test(message))

const messageFromCause = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function modelFailureOf(error: unknown): ModelFailure | null {
  if (error instanceof StreamStallError) return DROPPED

  if (error instanceof ModelStreamError) return modelFailureOf(error.cause)

  if (APICallError.isInstance(error)) {
    const retryAfterMs = retryAfterMsOf(error.responseHeaders)
    const promptTooLong = looksLikePromptTooLong(error.message)
    return {
      ...(error.statusCode === undefined ? {} : { status: error.statusCode }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      ...(promptTooLong ? { promptTooLong: true } : {}),
    }
  }

  if (StreamProviderError.isInstance(error)) {
    if (error.statusCode !== undefined) return { status: error.statusCode }
    if (error.isRetryable) return DROPPED
  }

  // AbortSignal.timeout() aborts with a DOMException named 'TimeoutError', which carries no
  // status and matches none of the message needles.
  if (error instanceof Error && error.name === 'TimeoutError') return DROPPED

  if (error instanceof Error && looksLikeDroppedConnection(error.message)) return DROPPED

  return null
}
