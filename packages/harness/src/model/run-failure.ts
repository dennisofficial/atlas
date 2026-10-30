import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { runFailureKindOf, type RunFailure } from '@dltech/atlas-core'

import { failureAccountOf } from '../providers/failure-account'
import { ModelStreamError } from './errors'
import { modelFailureOf } from './failure'
import { providerErrorOf } from './provider-error'

const MAX_MESSAGE_CHARS = 500
const SECRET_SHAPES = /\b(?:sk|pk|rk|key)-[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._~+/=-]+/gi

const statusOf = (error: unknown): number | undefined => {
  if (error instanceof ModelStreamError) return statusOf(error.cause)
  if (APICallError.isInstance(error) || StreamProviderError.isInstance(error)) {
    return error.statusCode
  }
  return undefined
}

const safeMessageOf = (message: string): string =>
  message.replace(SECRET_SHAPES, '[redacted]').slice(0, MAX_MESSAGE_CHARS)

export function runFailureOf(args: {
  message: string
  cause: unknown
  providerId?: string | undefined
  modelId?: string | undefined
}): RunFailure {
  const { providerCode, providerType } = providerErrorOf(args.cause)
  const statusCode = statusOf(args.cause)
  const dropped = modelFailureOf(args.cause) !== null && statusCode === undefined
  const accountId = failureAccountOf(args.cause)

  return {
    kind: runFailureKindOf({ statusCode, providerCode, providerType, dropped }),
    message: safeMessageOf(args.message),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(providerCode === undefined ? {} : { providerCode: String(providerCode) }),
    ...(args.providerId === undefined ? {} : { providerId: args.providerId }),
    ...(args.modelId === undefined ? {} : { modelId: args.modelId }),
    ...(accountId === undefined ? {} : { accountId }),
  }
}
