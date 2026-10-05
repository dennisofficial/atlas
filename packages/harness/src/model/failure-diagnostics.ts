import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ModelStreamError } from './errors'
import { providerErrorOf } from './provider-error'

export function modelFailureDiagnosticsOf(error: unknown): Record<string, unknown> {
  if (error instanceof ModelStreamError) return modelFailureDiagnosticsOf(error.cause)

  if (!APICallError.isInstance(error) && !StreamProviderError.isInstance(error)) return {}

  const { providerCode, providerType } = providerErrorOf(error)
  return {
    ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
    ...(error.isRetryable === undefined ? {} : { isRetryable: error.isRetryable }),
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(providerType === undefined ? {} : { providerType }),
  }
}
