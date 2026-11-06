import {
  ModelStreamError,
  StreamStallError,
  blockedFailureOf,
  causeChainOf,
  safeFailureMessage,
} from '@dltech/atlas-agent'
import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import {
  classifyProviderFailure,
  type NormalizedProviderFailure,
  type ProviderFailureEvidence,
} from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from './credential-error'
import { MissingKeyError } from './provider-key'
import { normalizationOf, provenanceOf, rememberNormalization } from './failure-provenance'
import { networkFailureOf } from './network-failure'
import { providerErrorOf, providerMessageOf } from './provider-error'
import { retryAtOf } from './provider-reset'

const GENERIC_INVALID_REQUEST: ReadonlySet<string> = new Set([
  'invalid_request_error',
  'invalid_request',
])

const REFUSED_GRANT_CODE = 'invalid_authentication'

type ProviderError = APICallError | StreamProviderError

const namesGenericInvalidRequest = (error: ProviderError | undefined): boolean => {
  if (error === undefined) return false
  const { providerCode, providerType } = providerErrorOf(error)
  return [providerCode, providerType].some(
    (identifier) =>
      typeof identifier === 'string' && GENERIC_INVALID_REQUEST.has(identifier.toLowerCase()),
  )
}

const isProviderError = (link: unknown): link is ProviderError =>
  APICallError.isInstance(link) || StreamProviderError.isInstance(link)

const unwrapped = (error: unknown): unknown =>
  error instanceof ModelStreamError && error.cause !== undefined ? unwrapped(error.cause) : error

const responseHeadersOf = (error: ProviderError): Record<string, string> | undefined =>
  APICallError.isInstance(error) ? error.responseHeaders : undefined

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function credentialEvidenceOf(
  chain: readonly unknown[],
): Pick<ProviderFailureEvidence, 'delivery' | 'transport' | 'providerCode'> {
  for (const link of chain) {
    if (link instanceof MissingKeyError) return { delivery: true }
    if (!(link instanceof CredentialError)) continue
    if (link.providerRefused) return { providerCode: REFUSED_GRANT_CODE }
    return link.failure === ECredentialFailure.RefreshFailed
      ? { transport: true }
      : { delivery: true }
  }
  return {}
}

function providerEvidenceOf(args: {
  providerError: ProviderError | undefined
  nowMs: number
}): Partial<ProviderFailureEvidence> {
  const { providerError } = args
  if (providerError === undefined) return {}

  const { providerCode, providerType } = providerErrorOf(providerError)
  return {
    statusCode: providerError.statusCode,
    providerCode: providerCode === undefined ? undefined : String(providerCode),
    providerType,
    providerMessage: providerMessageOf(providerError),
    sdkRetryable: providerError.isRetryable,
    retryAt: retryAtOf({ headers: responseHeadersOf(providerError), nowMs: args.nowMs }),
  }
}

export function normalizeProviderFailure(args: {
  cause: unknown
  message?: string | undefined
  providerId?: string | undefined
  modelId?: string | undefined
  cancelled?: boolean | undefined
  nowMs: number
}): NormalizedProviderFailure {
  const remembered = normalizationOf(args.cause)
  if (remembered !== undefined) return remembered

  const chain = causeChainOf(args.cause)
  const blocked = blockedFailureOf(chain)
  if (blocked !== undefined) {
    rememberNormalization({ cause: args.cause, normalized: blocked })
    return blocked
  }

  const providerError = chain.find(isProviderError)
  const provenance = provenanceOf(args.cause)
  const credential = credentialEvidenceOf(chain)
  const root = unwrapped(args.cause)

  const evidence: ProviderFailureEvidence = {
    ...providerEvidenceOf({ providerError, nowMs: args.nowMs }),
    ...credential,
    message: safeFailureMessage(args.message ?? messageOf(root)),
    providerId: provenance?.providerId ?? args.providerId,
    modelId: provenance?.modelId ?? args.modelId,
    accountId: provenance?.accountId,
    authorizationDelivered: provenance?.authorizationDelivered,
    cancelled: args.cancelled,
    stalled: chain.some((link) => link instanceof StreamStallError),
    transport:
      credential.transport === true ||
      (!namesGenericInvalidRequest(providerError) && networkFailureOf(args.cause)),
  }

  const normalized = classifyProviderFailure({ evidence })
  rememberNormalization({ cause: args.cause, normalized })
  return normalized
}
