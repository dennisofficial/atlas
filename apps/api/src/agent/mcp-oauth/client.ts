import { EOAuthFailure, OAuthError, parseOAuthErrorBody } from './errors'
import { unsealJson } from './seal'
import { sealedGrantSchema, type ClientInformation, type OAuthFetch } from './types'
import type { McpServerGrantRow } from './types'
import type { SecretCipher } from '../config/secret-cipher'

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
  const issuedAt = numberOr(body.client_id_issued_at)
  const expiresAt = numberOr(body.client_secret_expires_at)
  return {
    clientId: body.client_id,
    ...(typeof body.client_secret === 'string' ? { clientSecret: body.client_secret } : {}),
    ...(issuedAt === undefined ? {} : { clientIdIssuedAt: issuedAt }),
    ...(expiresAt === undefined ? {} : { clientSecretExpiresAt: expiresAt }),
  }
}

export const registerClient = async (args: {
  registrationEndpoint: string
  redirectUri: string
  scope?: string | undefined
  fetch: OAuthFetch
}): Promise<ClientInformation> => {
  const requestBody = {
    redirect_uris: [args.redirectUri],
    client_name: 'Atlas',
    client_uri: 'https://github.com/dennisofficial/atlas',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...(args.scope === undefined ? {} : { scope: args.scope }),
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
        errorBody?.errorDescription ?? `the registration endpoint answered HTTP ${response.status}`,
      ...(errorBody === undefined ? {} : { code: errorBody.error }),
      status: response.status,
    })
  }
  const client = parseClientInformation(raw)
  if (client === undefined) {
    throw new OAuthError({
      failure: EOAuthFailure.RegistrationFailed,
      message: 'the registration response carries no client_id',
    })
  }
  return client
}

const reusableClientOf = (args: {
  row: McpServerGrantRow
  cipher: SecretCipher
  nowMs: number
  redirectUri: string
  tokenEndpoint: string
}): ClientInformation | undefined => {
  if (args.row.oauthSealed === null) return undefined
  try {
    const grant = unsealJson({
      cipher: args.cipher,
      sealed: args.row.oauthSealed,
      schema: sealedGrantSchema,
    })
    const secretExpiresAt = grant.clientInfo.clientSecretExpiresAt
    const secretExpired =
      secretExpiresAt !== undefined && secretExpiresAt > 0 && secretExpiresAt * 1000 <= args.nowMs
    const matches =
      grant.redirectUri === args.redirectUri && grant.tokenEndpoint === args.tokenEndpoint
    return matches && !secretExpired ? grant.clientInfo : undefined
  } catch {
    return undefined
  }
}

export const oauthClientFor = async (args: {
  row: McpServerGrantRow
  cipher: SecretCipher
  nowMs: number
  redirectUri: string
  tokenEndpoint: string
  registrationEndpoint?: string | undefined
  scope?: string | undefined
  fetch: OAuthFetch
}): Promise<ClientInformation | undefined> => {
  const reusable = reusableClientOf(args)
  if (reusable !== undefined) return reusable
  if (args.registrationEndpoint === undefined) return undefined
  return registerClient({
    registrationEndpoint: args.registrationEndpoint,
    redirectUri: args.redirectUri,
    ...(args.scope === undefined ? {} : { scope: args.scope }),
    fetch: args.fetch,
  })
}
