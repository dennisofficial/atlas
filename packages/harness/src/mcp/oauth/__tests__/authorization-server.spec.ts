import { describe, expect, it } from 'bun:test'

import { discoverAuthorizationServerMetadata } from '../discovery'
import { EOAuthFailure, OAuthError } from '../oauth-error'

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

const METADATA = {
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
}

describe('discoverAuthorizationServerMetadata', () => {
  it('prefers the oauth-authorization-server well-known URL', async () => {
    const { fetch, calls } = router({
      'https://auth.example.com/.well-known/oauth-authorization-server': { body: METADATA },
    })

    const result = await discoverAuthorizationServerMetadata({
      authServerUrl: 'https://auth.example.com',
      fetch,
    })

    expect(result.token_endpoint).toBe('https://auth.example.com/token')
    expect(calls).toEqual(['https://auth.example.com/.well-known/oauth-authorization-server'])
  })

  it('carries the issuer path as a suffix on the well-known URL', async () => {
    const { fetch, calls } = router({
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant': {
        body: METADATA,
      },
    })

    await discoverAuthorizationServerMetadata({
      authServerUrl: 'https://auth.example.com/tenant',
      fetch,
    })

    expect(calls).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
    ])
  })

  it('falls back to openid-configuration, then to the path-prefixed form', async () => {
    const { fetch, calls } = router({
      'https://auth.example.com/tenant/.well-known/openid-configuration': { body: METADATA },
    })

    const result = await discoverAuthorizationServerMetadata({
      authServerUrl: 'https://auth.example.com/tenant',
      fetch,
    })

    expect(result.authorization_endpoint).toBe('https://auth.example.com/authorize')
    expect(calls).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
      'https://auth.example.com/.well-known/openid-configuration/tenant',
      'https://auth.example.com/tenant/.well-known/openid-configuration',
    ])
  })

  it('returns the optional capability fields when present', async () => {
    const { fetch } = router({
      'https://auth.example.com/.well-known/oauth-authorization-server': {
        body: {
          ...METADATA,
          registration_endpoint: 'https://auth.example.com/register',
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
          scopes_supported: ['files:read'],
        },
      },
    })

    const result = await discoverAuthorizationServerMetadata({
      authServerUrl: 'https://auth.example.com',
      fetch,
    })

    expect(result).toEqual({
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      registration_endpoint: 'https://auth.example.com/register',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
      scopes_supported: ['files:read'],
    })
  })

  it('rejects an http endpoint on a non-loopback host', async () => {
    const { fetch } = router({
      'https://auth.example.com/.well-known/oauth-authorization-server': {
        body: { ...METADATA, token_endpoint: 'http://auth.example.com/token' },
      },
    })

    const attempt = discoverAuthorizationServerMetadata({
      authServerUrl: 'https://auth.example.com',
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({
      name: 'OAuthError',
      failure: EOAuthFailure.InsecureEndpoint,
    })
  })

  it('allows http endpoints on loopback hosts', async () => {
    const loopback = {
      authorization_endpoint: 'http://localhost:8080/authorize',
      token_endpoint: 'http://127.0.0.1:8080/token',
    }
    const { fetch } = router({
      'http://localhost:8080/.well-known/oauth-authorization-server': { body: loopback },
    })

    const result = await discoverAuthorizationServerMetadata({
      authServerUrl: 'http://localhost:8080',
      fetch,
    })

    expect(result.token_endpoint).toBe('http://127.0.0.1:8080/token')
  })

  it('throws a typed discovery error when no candidate answers', async () => {
    const { fetch } = router({})

    const attempt = discoverAuthorizationServerMetadata({
      authServerUrl: 'https://auth.example.com',
      fetch,
    })

    await expect(attempt).rejects.toBeInstanceOf(OAuthError)
    await expect(attempt).rejects.toMatchObject({ failure: EOAuthFailure.DiscoveryFailed })
  })
})
