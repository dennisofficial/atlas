import { z } from 'zod'

import { accountIdSchema, type AccountId } from '../credentials/account'
import {
  AUTH_IDENTIFIERS,
  CONTEXT_OVERFLOW_IDENTIFIERS,
  GENERIC_INVALID_REQUEST_IDENTIFIERS,
  MODEL_DENIED_IDENTIFIERS,
  OVERLOADED_IDENTIFIERS,
  QUOTA_IDENTIFIERS,
  UPSTREAM_FAILURE_IDENTIFIERS,
  isMonthlySpendLimit,
  isUpstreamFailureMessage,
  namesIdentifier,
  normalizedIdentifier,
  saysMissingAuthHeader,
} from './provider-failure-profiles'

export enum EProviderFailureKind {
  Auth = 'auth',
  Quota = 'quota',
  RateLimited = 'rate-limited',
  Network = 'network',
  Overloaded = 'overloaded',
  Stalled = 'stalled',
  Delivery = 'delivery',
  ModelDenied = 'model-denied',
  ContextOverflow = 'context-overflow',
  InvalidRequest = 'invalid-request',
  Cancelled = 'cancelled',
  Other = 'other',
}

export enum EProviderFailureScope {
  Credential = 'credential',
  Route = 'route',
  Request = 'request',
}

export enum EProviderRetry {
  Transient = 'transient',
  Never = 'never',
}

export type NormalizedProviderFailure = {
  kind: EProviderFailureKind
  scope: EProviderFailureScope
  retry: EProviderRetry
  message: string
  statusCode?: number | undefined
  providerCode?: string | undefined
  providerType?: string | undefined
  providerId?: string | undefined
  modelId?: string | undefined
  accountId?: AccountId | undefined
  retryAt?: string | undefined
  resetAt?: string | undefined
}

export const normalizedProviderFailureSchema: z.ZodType<NormalizedProviderFailure> = z.object({
  kind: z.enum(EProviderFailureKind),
  scope: z.enum(EProviderFailureScope),
  retry: z.enum(EProviderRetry),
  message: z.string(),
  statusCode: z.number().int().optional(),
  providerCode: z.string().optional(),
  providerType: z.string().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  accountId: accountIdSchema.optional(),
  retryAt: z.string().optional(),
  resetAt: z.string().optional(),
})

export type ProviderFailureEvidence = {
  providerId?: string | undefined
  modelId?: string | undefined
  accountId?: AccountId | undefined
  statusCode?: number | undefined
  providerCode?: string | undefined
  providerType?: string | undefined
  providerMessage?: string | undefined
  message: string
  retryAt?: string | undefined
  resetAt?: string | undefined
  sdkRetryable?: boolean | undefined
  transport?: boolean | undefined
  stalled?: boolean | undefined
  cancelled?: boolean | undefined
  delivery?: boolean | undefined
  authorizationDelivered?: boolean | undefined
}

export const MAX_FAILURE_MESSAGE_CHARS = 500

type Verdict = Pick<NormalizedProviderFailure, 'kind' | 'scope' | 'retry'>

const never = (args: { kind: EProviderFailureKind; scope: EProviderFailureScope }): Verdict => ({
  ...args,
  retry: EProviderRetry.Never,
})

const transient = (kind: EProviderFailureKind): Verdict => ({
  kind,
  scope: EProviderFailureScope.Route,
  retry: EProviderRetry.Transient,
})

const UNAUTHENTICATED = 401
const PAYMENT_REQUIRED = 402
const FORBIDDEN = 403
const NOT_FOUND = 404
const PAYLOAD_TOO_LARGE = 413
const UNPROCESSABLE = 422
const TOO_MANY_REQUESTS = 429
const OVERLOADED = 529
const FIRST_SERVER_ERROR = 500
const FIRST_CLIENT_ERROR = 400

const DELIVERY = never({
  kind: EProviderFailureKind.Delivery,
  scope: EProviderFailureScope.Request,
})
const QUOTA = never({
  kind: EProviderFailureKind.Quota,
  scope: EProviderFailureScope.Credential,
})
const AUTH = never({
  kind: EProviderFailureKind.Auth,
  scope: EProviderFailureScope.Credential,
})
const MODEL_DENIED = never({
  kind: EProviderFailureKind.ModelDenied,
  scope: EProviderFailureScope.Route,
})
const CONTEXT_OVERFLOW = never({
  kind: EProviderFailureKind.ContextOverflow,
  scope: EProviderFailureScope.Request,
})
const INVALID_REQUEST = never({
  kind: EProviderFailureKind.InvalidRequest,
  scope: EProviderFailureScope.Request,
})
const CANCELLED = never({
  kind: EProviderFailureKind.Cancelled,
  scope: EProviderFailureScope.Request,
})
const OTHER = never({
  kind: EProviderFailureKind.Other,
  scope: EProviderFailureScope.Request,
})

function bareCredentialStatusVerdict(args: {
  statusCode: number
  authorizationDelivered: boolean | undefined
}): Verdict {
  if (args.authorizationDelivered !== true) return DELIVERY
  return args.statusCode === PAYMENT_REQUIRED ? QUOTA : AUTH
}

function verdictOf(args: {
  evidence: ProviderFailureEvidence
  identifiers: readonly (string | undefined)[]
  providerType: string | undefined
}): Verdict {
  const { evidence, identifiers } = args
  const { statusCode } = evidence
  const named = (set: ReadonlySet<string>): boolean => namesIdentifier({ set, identifiers })

  if (evidence.cancelled === true) return CANCELLED
  if (evidence.delivery === true || saysMissingAuthHeader(evidence.providerMessage)) return DELIVERY

  const quotaEvidence =
    named(QUOTA_IDENTIFIERS) ||
    isMonthlySpendLimit({
      providerId: evidence.providerId,
      providerType: args.providerType,
      statusCode,
      providerMessage: evidence.providerMessage,
    })
  if (quotaEvidence || named(AUTH_IDENTIFIERS)) {
    if (evidence.authorizationDelivered === false) return DELIVERY
    return quotaEvidence ? QUOTA : AUTH
  }

  if (named(MODEL_DENIED_IDENTIFIERS) || statusCode === FORBIDDEN || statusCode === NOT_FOUND) {
    return MODEL_DENIED
  }
  if (named(CONTEXT_OVERFLOW_IDENTIFIERS) || statusCode === PAYLOAD_TOO_LARGE) {
    return CONTEXT_OVERFLOW
  }
  if (statusCode === UNAUTHENTICATED || statusCode === PAYMENT_REQUIRED) {
    return bareCredentialStatusVerdict({
      statusCode,
      authorizationDelivered: evidence.authorizationDelivered,
    })
  }
  if (statusCode === UNPROCESSABLE) return INVALID_REQUEST

  if (evidence.stalled === true) return transient(EProviderFailureKind.Stalled)
  if (statusCode === TOO_MANY_REQUESTS) return transient(EProviderFailureKind.RateLimited)
  if (
    statusCode === OVERLOADED ||
    named(OVERLOADED_IDENTIFIERS) ||
    (statusCode !== undefined && statusCode >= FIRST_SERVER_ERROR)
  ) {
    return transient(EProviderFailureKind.Overloaded)
  }
  if (isUpstreamFailureMessage(evidence.providerMessage) || named(UPSTREAM_FAILURE_IDENTIFIERS)) {
    return transient(EProviderFailureKind.Overloaded)
  }

  const flaggedRetryable =
    evidence.sdkRetryable === true && !named(GENERIC_INVALID_REQUEST_IDENTIFIERS)
  if (statusCode === undefined) {
    return evidence.transport === true || flaggedRetryable
      ? transient(EProviderFailureKind.Network)
      : OTHER
  }
  if (flaggedRetryable) return transient(EProviderFailureKind.Other)
  return statusCode >= FIRST_CLIENT_ERROR ? INVALID_REQUEST : OTHER
}

const validInstantOf = (value: string | undefined): string | undefined =>
  value !== undefined && Number.isFinite(Date.parse(value)) ? value : undefined

export function classifyProviderFailure(args: {
  evidence: ProviderFailureEvidence
}): NormalizedProviderFailure {
  const { evidence } = args
  const providerCode = normalizedIdentifier(evidence.providerCode)
  const providerType = normalizedIdentifier(evidence.providerType)
  const retryAt = validInstantOf(evidence.retryAt)

  return {
    ...verdictOf({
      evidence,
      identifiers: [providerCode, providerType],
      providerType,
    }),
    message: evidence.message.slice(0, MAX_FAILURE_MESSAGE_CHARS),
    ...(evidence.statusCode === undefined ? {} : { statusCode: evidence.statusCode }),
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(providerType === undefined ? {} : { providerType }),
    ...(evidence.providerId === undefined ? {} : { providerId: evidence.providerId }),
    ...(evidence.modelId === undefined ? {} : { modelId: evidence.modelId }),
    ...(evidence.accountId === undefined ? {} : { accountId: evidence.accountId }),
    ...(retryAt === undefined ? {} : { retryAt }),
  }
}
