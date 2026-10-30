import { z } from 'zod'

export enum ERunFailureKind {
  Auth = 'auth',
  Quota = 'quota',
  RateLimited = 'rate-limited',
  Network = 'network',
  Overloaded = 'overloaded',
  Other = 'other',
}

export type RunFailure = {
  kind: ERunFailureKind
  message: string
  statusCode?: number | undefined
  providerCode?: string | undefined
  providerId?: string | undefined
  modelId?: string | undefined
  accountId?: string | undefined
}

export const runFailureSchema: z.ZodType<RunFailure> = z.object({
  kind: z.enum(ERunFailureKind),
  message: z.string(),
  statusCode: z.number().int().optional(),
  providerCode: z.string().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
})

const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403])
const QUOTA_STATUSES: ReadonlySet<number> = new Set([402])
const AUTH_IDENTIFIERS: ReadonlySet<string> = new Set([
  'invalid_api_key',
  'authentication_error',
  'authentication',
  'invalid_authentication',
  'permission_error',
])
const QUOTA_IDENTIFIERS: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'payment_required',
])
const OVERLOADED_IDENTIFIERS: ReadonlySet<string> = new Set(['overloaded_error', 'overloaded'])
const TOO_MANY_REQUESTS = 429
const OVERLOADED_STATUS = 529
const FIRST_SERVER_ERROR = 500

export function runFailureKindOf(args: {
  statusCode?: number | undefined
  providerCode?: string | number | undefined
  providerType?: string | undefined
  dropped?: boolean | undefined
}): ERunFailureKind {
  const { statusCode } = args
  const identifiers = [args.providerCode, args.providerType]
    .filter((value): value is string | number => value !== undefined)
    .map((value) => String(value).toLowerCase())
  const named = (set: ReadonlySet<string>): boolean =>
    identifiers.some((identifier) => set.has(identifier))

  if (named(QUOTA_IDENTIFIERS)) return ERunFailureKind.Quota
  if (statusCode !== undefined && QUOTA_STATUSES.has(statusCode)) return ERunFailureKind.Quota
  if (named(AUTH_IDENTIFIERS)) return ERunFailureKind.Auth
  if (statusCode !== undefined && AUTH_STATUSES.has(statusCode)) return ERunFailureKind.Auth
  if (statusCode === TOO_MANY_REQUESTS) return ERunFailureKind.RateLimited
  if (named(OVERLOADED_IDENTIFIERS) || statusCode === OVERLOADED_STATUS) {
    return ERunFailureKind.Overloaded
  }
  if (statusCode !== undefined && statusCode >= FIRST_SERVER_ERROR) {
    return ERunFailureKind.Overloaded
  }
  if (statusCode === undefined && args.dropped === true) return ERunFailureKind.Network
  return ERunFailureKind.Other
}
