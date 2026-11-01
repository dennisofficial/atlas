import { EAuthProvider } from '../credentials/account'

export const MAX_IDENTIFIER_CHARS = 80

export const QUOTA_IDENTIFIERS: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'payment_required',
])

export const AUTH_IDENTIFIERS: ReadonlySet<string> = new Set([
  'invalid_api_key',
  'authentication_error',
  'authentication',
  'invalid_authentication',
])

export const MODEL_DENIED_IDENTIFIERS: ReadonlySet<string> = new Set([
  'permission_error',
  'model_not_found',
  'not_found_error',
])

export const CONTEXT_OVERFLOW_IDENTIFIERS: ReadonlySet<string> = new Set([
  'context_length_exceeded',
])

export const OVERLOADED_IDENTIFIERS: ReadonlySet<string> = new Set([
  'overloaded_error',
  'overloaded',
])

export const UPSTREAM_FAILURE_IDENTIFIERS: ReadonlySet<string> = new Set([
  'upstream_error',
  'server_error',
  'internal_server_error',
  'service_unavailable',
])

export const GENERIC_INVALID_REQUEST_IDENTIFIERS: ReadonlySet<string> = new Set([
  'invalid_request_error',
  'invalid_request',
])

const UPSTREAM_FAILURE_MESSAGE =
  'the upstream provider returned an error while processing this request.'

const MISSING_AUTH_HEADER =
  /\b(?:missing|no)\s+(?:an?\s+)?(?:authentication|authorization)\s+header\b/i

const MONTHLY_LIMIT_CLAUSE = /\bmonthly\s+spend(?:ing)?\s+limit\b/i
const LIMIT_STATE_VERB = /\b(?:exceeded|reached|would\s+exceed|will\s+exceed)\b/i
const NEGATION = /\b(?:not|never|no\s+longer)\b|n't\b/i
const SENTENCE_BREAK = /[.!?\n]+/

const MONTHLY_SPEND_STATUSES: ReadonlySet<number> = new Set([429, 400])
const MONTHLY_SPEND_PROVIDER_TYPE = 'rate_limit_error'

export function normalizedIdentifier(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase().slice(0, MAX_IDENTIFIER_CHARS)
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

export const namesIdentifier = (args: {
  set: ReadonlySet<string>
  identifiers: readonly (string | undefined)[]
}): boolean =>
  args.identifiers.some((identifier) => identifier !== undefined && args.set.has(identifier))

export const saysMissingAuthHeader = (providerMessage: string | undefined): boolean =>
  providerMessage !== undefined && MISSING_AUTH_HEADER.test(providerMessage)

export const isUpstreamFailureMessage = (providerMessage: string | undefined): boolean =>
  providerMessage?.trim().toLowerCase() === UPSTREAM_FAILURE_MESSAGE

export function isMonthlySpendLimit(args: {
  providerId: string | undefined
  providerType: string | undefined
  statusCode: number | undefined
  providerMessage: string | undefined
}): boolean {
  const { providerMessage, statusCode } = args
  if (providerMessage === undefined || statusCode === undefined) return false
  if (args.providerId?.toLowerCase() !== EAuthProvider.Anthropic) return false
  if (args.providerType !== MONTHLY_SPEND_PROVIDER_TYPE) return false
  if (!MONTHLY_SPEND_STATUSES.has(statusCode)) return false
  return providerMessage
    .split(SENTENCE_BREAK)
    .some(
      (clause) =>
        MONTHLY_LIMIT_CLAUSE.test(clause) &&
        LIMIT_STATE_VERB.test(clause) &&
        !NEGATION.test(clause),
    )
}
