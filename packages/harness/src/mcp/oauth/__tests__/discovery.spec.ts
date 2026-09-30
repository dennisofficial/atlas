import { describe, expect, it } from 'bun:test'

import {
  discoverProtectedResourceMetadata,
  parseWwwAuthenticate,
  selectScope,
} from '../discovery'
import { EOAuthFailure } from '../oauth-error'

type Route = { status?: number; body?: unknown }

const router = (routes: Record<string, Route>) => {
  const calls: string[] = []
  const fetch = async (url: string): Promise<Response> => {
    calls.push(url)
    const route = routes[url]
    if (route === undefined) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 })
  }
  return { fetch, calls }
}

describe('parseWwwAuthenticate', () => {
  it('parses a full Bearer challenge', () => {
    const challenge = parseWwwAuthenticate(
      'Bearer realm="api", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read files:write", error="invalid_token", error_description="The access token expired"',
    )

    expect(challenge).toEqual({
      resourceMetadataUrl:
        'https://mcp.example.com/.well-known/oauth-protected-resource',
      scope: 'files:read files:write',
      error: 'invalid_token',
      errorDescription: 'The access token expired',
    })
  })

  it('parses a challenge holding only resource_metadata', () => {
    const challenge = parseWwwAuthenticate(
      'Bearer resource_metadata="https://mcp.example.com/rm.json"',
    )

    expect(challenge.resourceMetadataUrl).toBe('https://mcp.example.com/rm.json')
    expect(challenge.scope).toBeUndefined()
  })

  it('unescapes quoted values', () => {
    const challenge = parseWwwAuthenticate(
      'Bearer error_description="the token \\"died\\" hard"',
    )

    expect(challenge.errorDescription).toBe('the token "died" hard')
  })

  it('parses unquoted token values', () => {
    const challenge = parseWwwAuthenticate('Bearer error=invalid_token')

    expect(challenge.error).toBe('invalid_token')
  })

  it('returns an empty challenge for a non-Bearer scheme', () => {
    expect(parseWwwAuthenticate('Basic realm="api"')).toEqual({})
  })

  it('returns an empty challenge for a bare Bearer header', () => {
    expect(parseWwwAuthenticate('Bearer')).toEqual({})
  })
})

describe('discoverProtectedResourceMetadata', () => {
  const metadata = { authorization_servers: ['https://auth.example.com'] }

  it('fetches the explicit resource metadata URL when given one', async () => {
    const { fetch, calls } = router({ 'https://other.example.com/rm.json': { body: metadata } })

    const result = await discoverProtectedResourceMetadata({
      serverUrl: 'https://mcp.example.com/server',
      resourceMetadataUrl: 'https://other.example.com/rm.json',
      fetch,
    })

    expect(result.authorization_servers).toEqual(['https://auth.example.com'])
    expect(calls).toEqual(['https://other.example.com/rm.json'])
  })

  it('builds the well-known URL with the server path as suffix', async () => {
    const { fetch, calls } = router({
      'https://mcp.example.com/.well-known/oauth-protected-resource/server': { body: metadata },
    })

    await discoverProtectedResourceMetadata({ serverUrl: 'https://mcp.example.com/server', fetch })

    expect(calls).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource/server',
    ])
  })

  it('falls back to the path-less well-known URL on 404', async () => {
    const { fetch, calls } = router({
      'https://mcp.example.com/.well-known/oauth-protected-resource': { body: metadata },
    })

    const result = await discoverProtectedResourceMetadata({
      serverUrl: 'https://mcp.example.com/server',
      fetch,
    })

    expect(result.authorization_servers).toEqual(['https://auth.example.com'])
    expect(calls).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource/server',
      'https://mcp.example.com/.well-known/oauth-protected-resource',
    ])
  })

  it('fetches the plain well-known URL when the server has no path', async () => {
    const { fetch, calls } = router({
      'https://mcp.example.com/.well-known/oauth-protected-resource': { body: metadata },
    })

    await discoverProtectedResourceMetadata({ serverUrl: 'https://mcp.example.com', fetch })

    expect(calls).toEqual(['https://mcp.example.com/.well-known/oauth-protected-resource'])
  })

  it('returns scopes_supported when present', async () => {
    const { fetch } = router({
      'https://mcp.example.com/.well-known/oauth-protected-resource': {
        body: { ...metadata, scopes_supported: ['files:read'] },
      },
    })

    const result = await discoverProtectedResourceMetadata({
      serverUrl: 'https://mcp.example.com',
      fetch,
    })

    expect(result.scopes_supported).toEqual(['files:read'])
  })

  it('throws a typed discovery error when nothing answers', async () => {
    const { fetch } = router({})

    const attempt = discoverProtectedResourceMetadata({
      serverUrl: 'https://mcp.example.com',
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({
      name: 'OAuthError',
      failure: EOAuthFailure.DiscoveryFailed,
    })
  })
})

describe('selectScope', () => {
  it('prefers the WWW-Authenticate scope', () => {
    expect(
      selectScope({
        challengeScope: 'files:read',
        protectedResourceMetadata: {
          authorization_servers: [],
          scopes_supported: ['other'],
        },
      }),
    ).toBe('files:read')
  })

  it('falls back to the protected-resource scopes joined by space', () => {
    expect(
      selectScope({
        protectedResourceMetadata: {
          authorization_servers: [],
          scopes_supported: ['files:read', 'files:write'],
        },
      }),
    ).toBe('files:read files:write')
  })

  it('returns undefined when neither source holds a scope', () => {
    expect(selectScope({})).toBeUndefined()
    expect(
      selectScope({ protectedResourceMetadata: { authorization_servers: [] } }),
    ).toBeUndefined()
  })
})
