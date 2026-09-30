import { EOAuthFailure, OAuthError } from './oauth-error'

export type OAuthFetch = (input: string, init?: RequestInit) => Promise<Response>

export type ProtectedResourceMetadata = {
  authorization_servers: string[]
  scopes_supported?: string[]
}

export type AuthorizationServerMetadata = {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  code_challenge_methods_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  scopes_supported?: string[]
}

export type WwwAuthenticateChallenge = {
  resourceMetadataUrl?: string
  scope?: string
  error?: string
  errorDescription?: string
}

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const stringArrayOr = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string')
  return strings.length === value.length && strings.length > 0 ? strings : undefined
}

// RFC 9110 §11.3: a challenge value may be quoted, with \" and \\ as escapes.
const parseChallengeParams = (input: string): Record<string, string> => {
  const params: Record<string, string> = {}
  const pattern = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g
  for (const match of input.matchAll(pattern)) {
    const key = match[1]
    if (key === undefined) continue
    params[key.toLowerCase()] = (match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1')
  }
  return params
}

// RFC 9728 §5.1: Bearer challenges carry resource_metadata, scope, error, error_description.
export const parseWwwAuthenticate = (header: string): WwwAuthenticateChallenge => {
  const trimmed = header.trim()
  if (!/^bearer\b/i.test(trimmed)) return {}
  const params = parseChallengeParams(trimmed.slice('bearer'.length))

  return {
    ...(params['resource_metadata'] !== undefined
      ? { resourceMetadataUrl: params['resource_metadata'] }
      : {}),
    ...(params['scope'] !== undefined ? { scope: params['scope'] } : {}),
    ...(params['error'] !== undefined ? { error: params['error'] } : {}),
    ...(params['error_description'] !== undefined
      ? { errorDescription: params['error_description'] }
      : {}),
  }
}

const parseProtectedResourceMetadata = (raw: unknown): ProtectedResourceMetadata | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const body = raw as { authorization_servers?: unknown; scopes_supported?: unknown }
  const authorizationServers = stringArrayOr(body.authorization_servers)
  if (authorizationServers === undefined) return undefined
  const scopesSupported = stringArrayOr(body.scopes_supported)
  return {
    authorization_servers: authorizationServers,
    ...(scopesSupported === undefined ? {} : { scopes_supported: scopesSupported }),
  }
}

const fetchJson = async (args: { url: string; fetch: OAuthFetch }): Promise<unknown | undefined> => {
  const response = await args.fetch(args.url, { headers: { accept: 'application/json' } })
  if (!response.ok) return undefined
  return (await response.json()) as unknown
}

export const discoverProtectedResourceMetadata = async (args: {
  serverUrl: string
  resourceMetadataUrl?: string
  fetch: OAuthFetch
}): Promise<ProtectedResourceMetadata> => {
  // RFC 9728 §3: the well-known path takes the resource's path as a suffix; on 404 a client
  // falls back to the path-less well-known at the origin.
  const server = new URL(args.serverUrl)
  const candidates: string[] = []
  if (args.resourceMetadataUrl !== undefined) {
    candidates.push(args.resourceMetadataUrl)
  } else {
    const suffix = server.pathname === '/' ? '' : server.pathname
    candidates.push(`${server.origin}/.well-known/oauth-protected-resource${suffix}`)
    if (suffix !== '') candidates.push(`${server.origin}/.well-known/oauth-protected-resource`)
  }

  for (const url of candidates) {
    const parsed = parseProtectedResourceMetadata(await fetchJson({ url, fetch: args.fetch }))
    if (parsed !== undefined) return parsed
  }

  throw new OAuthError({
    failure: EOAuthFailure.DiscoveryFailed,
    message: `no protected-resource metadata found for ${args.serverUrl}`,
  })
}

// OAuth endpoints must be HTTPS, with a loopback exemption for local development servers.
const enforceSecureEndpoint = (endpoint: string): void => {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new OAuthError({
      failure: EOAuthFailure.InsecureEndpoint,
      message: `the authorization server metadata carries an invalid endpoint: ${endpoint}`,
    })
  }
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return
  throw new OAuthError({
    failure: EOAuthFailure.InsecureEndpoint,
    message: `the authorization server metadata carries an insecure endpoint: ${endpoint}`,
  })
}

const parseAuthorizationServerMetadata = (raw: unknown): AuthorizationServerMetadata | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const body = raw as {
    authorization_endpoint?: unknown
    token_endpoint?: unknown
    registration_endpoint?: unknown
    code_challenge_methods_supported?: unknown
    token_endpoint_auth_methods_supported?: unknown
    scopes_supported?: unknown
  }
  const authorizationEndpoint = stringOr(body.authorization_endpoint)
  const tokenEndpoint = stringOr(body.token_endpoint)
  if (authorizationEndpoint === undefined || tokenEndpoint === undefined) return undefined
  enforceSecureEndpoint(authorizationEndpoint)
  enforceSecureEndpoint(tokenEndpoint)

  const registrationEndpoint = stringOr(body.registration_endpoint)
  if (registrationEndpoint !== undefined) enforceSecureEndpoint(registrationEndpoint)
  const codeChallengeMethods = stringArrayOr(body.code_challenge_methods_supported)
  const tokenEndpointAuthMethods = stringArrayOr(body.token_endpoint_auth_methods_supported)
  const scopesSupported = stringArrayOr(body.scopes_supported)

  return {
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    ...(registrationEndpoint === undefined ? {} : { registration_endpoint: registrationEndpoint }),
    ...(codeChallengeMethods === undefined
      ? {}
      : { code_challenge_methods_supported: codeChallengeMethods }),
    ...(tokenEndpointAuthMethods === undefined
      ? {}
      : { token_endpoint_auth_methods_supported: tokenEndpointAuthMethods }),
    ...(scopesSupported === undefined ? {} : { scopes_supported: scopesSupported }),
  }
}

export const discoverAuthorizationServerMetadata = async (args: {
  authServerUrl: string
  fetch: OAuthFetch
}): Promise<AuthorizationServerMetadata> => {
  // RFC 8414 §3.1 for the OAuth form, OIDC Discovery §4 for the openid-configuration fallbacks.
  const issuer = new URL(args.authServerUrl)
  const suffix = issuer.pathname === '/' ? '' : issuer.pathname
  const candidates = [
    `${issuer.origin}/.well-known/oauth-authorization-server${suffix}`,
    `${issuer.origin}/.well-known/openid-configuration${suffix}`,
    ...(suffix === '' ? [] : [`${issuer.origin}${suffix}/.well-known/openid-configuration`]),
  ]

  for (const url of candidates) {
    const parsed = parseAuthorizationServerMetadata(await fetchJson({ url, fetch: args.fetch }))
    if (parsed !== undefined) return parsed
  }

  throw new OAuthError({
    failure: EOAuthFailure.DiscoveryFailed,
    message: `no authorization-server metadata found for ${args.authServerUrl}`,
  })
}

export const selectScope = (args: {
  challengeScope?: string
  protectedResourceMetadata?: ProtectedResourceMetadata
}): string | undefined => {
  if (args.challengeScope !== undefined && args.challengeScope !== '') return args.challengeScope
  const supported = args.protectedResourceMetadata?.scopes_supported
  if (supported !== undefined && supported.length > 0) return supported.join(' ')
  return undefined
}
