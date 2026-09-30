export enum EOAuthFailure {
  DiscoveryFailed = 'discovery_failed',
  RegistrationFailed = 'registration_failed',
  TokenExchangeFailed = 'token_exchange_failed',
  InsecureEndpoint = 'insecure_endpoint',
}

export class OAuthError extends Error {
  readonly failure: EOAuthFailure
  readonly code: string | undefined
  readonly status: number | undefined

  constructor(args: { failure: EOAuthFailure; message: string; code?: string; status?: number }) {
    super(args.message)
    this.name = 'OAuthError'
    this.failure = args.failure
    this.code = args.code
    this.status = args.status
  }
}

export type OAuthErrorBody = { error: string; errorDescription?: string }

// RFC 6749 §5.2: error responses carry a JSON body with `error` and optional `error_description`.
export const parseOAuthErrorBody = (raw: unknown): OAuthErrorBody | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const body = raw as { error?: unknown; error_description?: unknown }
  if (typeof body.error !== 'string' || body.error.length === 0) return undefined
  const description = body.error_description
  return {
    error: body.error,
    ...(typeof description === 'string' ? { errorDescription: description } : {}),
  }
}
