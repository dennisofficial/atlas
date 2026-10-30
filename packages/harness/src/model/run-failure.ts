import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ERunFailureKind, runFailureKindOf, type RunFailure } from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../credentials/credential-error'
import { failureAccountOf } from '../providers/failure-account'
import { MissingKeyError } from '../providers/provider-key'
import { ModelStreamError, StreamStallError } from './errors'
import { modelFailureOf } from './failure'
import { providerErrorOf } from './provider-error'
import { TurnFault } from './turn-fault'

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

const unwrapped = (error: unknown): unknown =>
  error instanceof ModelStreamError && error.cause !== undefined ? unwrapped(error.cause) : error

const typedKindOf = (cause: unknown): ERunFailureKind | undefined => {
  const error = unwrapped(cause)
  if (error instanceof TurnFault) return error.kind
  if (error instanceof MissingKeyError) return ERunFailureKind.MissingCredential
  if (error instanceof CredentialError) {
    return error.failure === ECredentialFailure.RefreshFailed
      ? ERunFailureKind.Auth
      : ERunFailureKind.MissingCredential
  }
  if (error instanceof StreamStallError) return ERunFailureKind.Stalled
  return undefined
}

export function runFailureOf(args: {
  message: string
  cause: unknown
  providerId?: string | undefined
  modelId?: string | undefined
  escaped?: boolean | undefined
}): RunFailure {
  const { providerCode, providerType } = providerErrorOf(args.cause)
  const statusCode = statusOf(args.cause)
  const dropped = modelFailureOf(args.cause) !== null && statusCode === undefined
  const accountId = failureAccountOf(args.cause)

  const classified = runFailureKindOf({ statusCode, providerCode, providerType, dropped })
  const kind =
    typedKindOf(args.cause) ??
    (classified === ERunFailureKind.Other && args.escaped === true
      ? ERunFailureKind.Crashed
      : classified)

  return {
    kind,
    message: safeMessageOf(args.message),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(providerCode === undefined ? {} : { providerCode: String(providerCode) }),
    ...(args.providerId === undefined ? {} : { providerId: args.providerId }),
    ...(args.modelId === undefined ? {} : { modelId: args.modelId }),
    ...(accountId === undefined ? {} : { accountId }),
  }
}
