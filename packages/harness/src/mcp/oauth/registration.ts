import type { OAuthFetch } from './discovery'
import { EOAuthFailure, OAuthError, parseOAuthErrorBody } from './oauth-error'

export type ClientInformation = {
  clientId: string
  clientSecret?: string
  clientIdIssuedAt?: number
  clientSecretExpiresAt?: number
}

const numberOr = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const parseClientInformation = (raw: unknown): ClientInformation | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const body = raw as {
    client_id?: unknown
    client_secret?: unknown
    client_id_issued_at?: unknown
    client_secret_expires_at?: unknown
  }
  if (typeof body.client_id !== 'string' || body.client_id.length === 0) return undefined
  const clientSecret = typeof body.client_secret === 'string' ? body.client_secret : undefined
  const issuedAt = numberOr(body.client_id_issued_at)
  const expiresAt = numberOr(body.client_secret_expires_at)

  return {
    clientId: body.client_id,
    ...(clientSecret === undefined ? {} : { clientSecret }),
    ...(issuedAt === undefined ? {} : { clientIdIssuedAt: issuedAt }),
    ...(expiresAt === undefined ? {} : { clientSecretExpiresAt: expiresAt }),
  }
}

// RFC 7591 §3.1: the client metadata POST body; §3.2.1 returns the registered client_id.
export const registerClient = async (args: {
  registrationEndpoint: string
  metadata: { redirectUris: string[]; scope?: string }
  fetch: OAuthFetch
}): Promise<ClientInformation> => {
  const requestBody: Record<string, unknown> = {
    redirect_uris: args.metadata.redirectUris,
    client_name: 'Atlas',
    client_uri: 'https://github.com/dennisofficial/atlas',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...(args.metadata.scope === undefined ? {} : { scope: args.metadata.scope }),
  }

  const response = await args.fetch(args.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(requestBody),
  })

  const raw: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const errorBody = parseOAuthErrorBody(raw)
    throw new OAuthError({
      failure: EOAuthFailure.RegistrationFailed,
      message:
        errorBody?.errorDescription ??
        `the registration endpoint answered HTTP ${response.status}`,
      ...(errorBody === undefined ? {} : { code: errorBody.error }),
      status: response.status,
    })
  }

  const client = parseClientInformation(raw)
  if (client === undefined)
    throw new OAuthError({
      failure: EOAuthFailure.RegistrationFailed,
      message: 'the registration response carries no client_id',
    })
  return client
}
