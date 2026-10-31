import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ERunFailureKind, runFailureKindOf, type RunFailure } from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../credentials/credential-error'
import { failureAccountOf } from '../providers/failure-account'
import { MissingKeyError } from '../providers/provider-key'
import { ModelStreamError, StreamStallError } from './errors'
import { networkFailureOf } from './network-failure'
import { providerErrorOf } from './provider-error'
import { TurnFault } from './turn-fault'

const MAX_MESSAGE_CHARS = 500
const SECRET_SHAPES = new RegExp(
  [
    String.raw`\b(?:sk|pk|rk|key)-[A-Za-z0-9_-]{6,}`,
    String.raw`Bearer\s+[A-Za-z0-9._~+/=-]+`,
    'AIza[0-9A-Za-z_-]{20,}',
    String.raw`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
  ].join('|'),
  'gi',
)
const SECRET_QUERY_PARAM = /\b(api_key|apikey|key|token|access_token)=[^&\s]+/gi

const statusOf = (error: unknown): number | undefined => {
  if (error instanceof ModelStreamError) return statusOf(error.cause)
  if (APICallError.isInstance(error) || StreamProviderError.isInstance(error)) {
    return error.statusCode
  }
  return undefined
}

export const safeFailureMessage = (message: string): string =>
  message
    .replace(SECRET_QUERY_PARAM, '$1=[redacted]')
    .replace(SECRET_SHAPES, '[redacted]')
    .slice(0, MAX_MESSAGE_CHARS)

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
  const dropped = statusCode === undefined && networkFailureOf(args.cause)
  const accountId = failureAccountOf(args.cause)

  const classified = runFailureKindOf({ statusCode, providerCode, providerType, dropped })
  const kind =
    typedKindOf(args.cause) ??
    (classified === ERunFailureKind.Other && args.escaped === true
      ? ERunFailureKind.Crashed
      : classified)

  return {
    kind,
    message: safeFailureMessage(args.message),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(providerCode === undefined ? {} : { providerCode: String(providerCode) }),
    ...(args.providerId === undefined ? {} : { providerId: args.providerId }),
    ...(args.modelId === undefined ? {} : { modelId: args.modelId }),
    ...(accountId === undefined ? {} : { accountId }),
  }
}
