import {
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata,
  OAuthError,
  parseWwwAuthenticate,
  selectScope,
  type OAuthFetch,
} from '@dltech/atlas-harness/mcp-oauth'
import { assertPublicUrl } from './mcp-oauth-ssrf'

const PROBE_TIMEOUT_MS = 10_000

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'Atlas', version: '0' },
  },
})

export type DiscoveryOutcome =
  | { supported: false; reason: string }
  | {
      supported: true
      authorizationEndpoint: string
      tokenEndpoint: string
      registrationEndpoint?: string
      authMethods?: string[]
      resource?: string
      scope?: string
    }

const stripLoneSlash = (url: string): string => {
  const parsed = new URL(url)
  return parsed.pathname === '/' && parsed.search === '' && parsed.hash === '' ? parsed.origin : url
}

const samePath = (left: string, right: string): boolean =>
  left.replace(/\/$/, '') === right.replace(/\/$/, '')

export const resolveResource = (args: { serverUrl: string; declared?: string | undefined }) => {
  if (args.declared === undefined)
    return { matches: true as const, resource: stripLoneSlash(args.serverUrl) }
  let declared: URL
  try {
    declared = new URL(args.declared)
  } catch {
    return { matches: false as const }
  }
  const server = new URL(args.serverUrl)
  const matches = declared.origin === server.origin && samePath(declared.pathname, server.pathname)
  return matches ? { matches: true as const, resource: args.declared } : { matches: false as const }
}

export const discoverOauthEndpoints = async (args: {
  serverUrl: string
  fetch: OAuthFetch
  allowLocalTargets: boolean
}): Promise<DiscoveryOutcome> => {
  const probe = await args.fetch(args.serverUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: INITIALIZE_BODY,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (probe.ok) return { supported: false, reason: 'server does not require sign-in' }
  if (probe.status !== 401) {
    return {
      supported: false,
      reason: `server answered HTTP ${probe.status} to the probe`,
    }
  }

  const challenge = parseWwwAuthenticate(probe.headers.get('www-authenticate') ?? '')
  const prm = await discoverProtectedResourceMetadata({
    serverUrl: args.serverUrl,
    ...(challenge.resourceMetadataUrl === undefined
      ? {}
      : { resourceMetadataUrl: challenge.resourceMetadataUrl }),
    fetch: args.fetch,
  }).catch((error: unknown) => {
    if (error instanceof OAuthError) return undefined
    throw error
  })

  let resource: string | undefined
  if (prm !== undefined) {
    const resolved = resolveResource({ serverUrl: args.serverUrl, declared: prm.resource })
    if (!resolved.matches) {
      return {
        supported: false,
        reason: 'protected resource metadata does not match the server URL',
      }
    }
    resource = resolved.resource
  }

  const authServerUrl = prm?.authorization_servers[0] ?? new URL(args.serverUrl).origin
  assertPublicUrl({
    url: authServerUrl,
    allowLocalTargets: args.allowLocalTargets,
  })
  const metadata = await discoverAuthorizationServerMetadata({
    authServerUrl,
    fetch: args.fetch,
  })
  for (const endpoint of [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.registration_endpoint,
  ]) {
    if (endpoint !== undefined)
      assertPublicUrl({
        url: endpoint,
        allowLocalTargets: args.allowLocalTargets,
      })
  }

  const scope = selectScope({
    ...(challenge.scope === undefined ? {} : { challengeScope: challenge.scope }),
    ...(prm === undefined ? {} : { protectedResourceMetadata: prm }),
  })
  const methods = metadata.token_endpoint_auth_methods_supported
  return {
    supported: true,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    ...(metadata.registration_endpoint === undefined
      ? {}
      : { registrationEndpoint: metadata.registration_endpoint }),
    ...(methods === undefined ? {} : { authMethods: methods }),
    ...(resource === undefined ? {} : { resource }),
    ...(scope === undefined ? {} : { scope }),
  }
}
