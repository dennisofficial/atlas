import { EOAuthFailure, OAuthError } from './errors'
import {
  authorizationServerMetadataSchema,
  protectedResourceMetadataSchema,
  type AuthorizationServerMetadata,
  type OAuthFetch,
  type ProtectedResourceMetadata,
  type WwwAuthenticateChallenge,
} from './types'

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

export const parseWwwAuthenticate = (header: string): WwwAuthenticateChallenge => {
  const trimmed = header.trim()
  if (!/^bearer\b/i.test(trimmed)) return {}
  const params = parseChallengeParams(trimmed.slice('bearer'.length))
  return {
    ...(params['resource_metadata'] === undefined
      ? {}
      : { resourceMetadataUrl: params['resource_metadata'] }),
    ...(params['scope'] === undefined ? {} : { scope: params['scope'] }),
    ...(params['error'] === undefined ? {} : { error: params['error'] }),
    ...(params['error_description'] === undefined
      ? {}
      : { errorDescription: params['error_description'] }),
  }
}

const fetchJson = async (args: {
  url: string
  fetch: OAuthFetch
}): Promise<unknown | undefined> => {
  const response = await args.fetch(args.url, { headers: { accept: 'application/json' } })
  if (!response.ok) return undefined
  return (await response.json().catch(() => undefined)) as unknown
}

export const discoverProtectedResourceMetadata = async (args: {
  serverUrl: string
  resourceMetadataUrl?: string | undefined
  fetch: OAuthFetch
}): Promise<ProtectedResourceMetadata> => {
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
    const parsed = protectedResourceMetadataSchema.safeParse(
      await fetchJson({ url, fetch: args.fetch }),
    )
    if (parsed.success) return parsed.data
  }
  throw new OAuthError({
    failure: EOAuthFailure.DiscoveryFailed,
    message: `no protected-resource metadata found for ${args.serverUrl}`,
  })
}

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

const parseAuthorizationServerMetadata = (
  raw: unknown,
): AuthorizationServerMetadata | undefined => {
  const parsed = authorizationServerMetadataSchema.safeParse(raw)
  if (!parsed.success) return undefined
  enforceSecureEndpoint(parsed.data.authorization_endpoint)
  enforceSecureEndpoint(parsed.data.token_endpoint)
  if (parsed.data.registration_endpoint !== undefined) {
    enforceSecureEndpoint(parsed.data.registration_endpoint)
  }
  return parsed.data
}

export const discoverAuthorizationServerMetadata = async (args: {
  authServerUrl: string
  fetch: OAuthFetch
}): Promise<AuthorizationServerMetadata> => {
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
  challengeScope?: string | undefined
  protectedResourceMetadata?: ProtectedResourceMetadata | undefined
}): string | undefined => {
  if (args.challengeScope !== undefined && args.challengeScope !== '') return args.challengeScope
  const supported = args.protectedResourceMetadata?.scopes_supported
  return supported === undefined || supported.length === 0 ? undefined : supported.join(' ')
}
