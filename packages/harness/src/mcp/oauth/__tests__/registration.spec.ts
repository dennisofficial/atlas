import { describe, expect, it } from 'bun:test'

import { registerClient } from '../registration'
import { EOAuthFailure } from '../oauth-error'

const ENDPOINT = 'https://auth.example.com/register'

type Call = { url: string; body: Record<string, unknown> }

const serverAnswering = (args: { status?: number; body?: unknown }) => {
  const calls: Call[] = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    return new Response(JSON.stringify(args.body ?? {}), { status: args.status ?? 200 })
  }
  return { fetch, calls }
}

describe('registerClient', () => {
  it('posts the RFC 7591 client metadata for a public Atlas client', async () => {
    const { fetch, calls } = serverAnswering({ body: { client_id: 'client-123' } })

    await registerClient({
      registrationEndpoint: ENDPOINT,
      metadata: { redirectUris: ['http://localhost:3000/callback'], scope: 'files:read' },
      fetch,
    })

    expect(calls).toEqual([
      {
        url: ENDPOINT,
        body: {
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Atlas',
          client_uri: 'https://github.com/dennisofficial/atlas',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'files:read',
        },
      },
    ])
  })

  it('omits the scope when none is selected', async () => {
    const { fetch, calls } = serverAnswering({ body: { client_id: 'client-123' } })

    await registerClient({
      registrationEndpoint: ENDPOINT,
      metadata: { redirectUris: ['http://localhost:3000/callback'] },
      fetch,
    })

    expect(calls[0]?.body['scope']).toBeUndefined()
  })

  it('returns the registered client information', async () => {
    const { fetch } = serverAnswering({
      body: {
        client_id: 'client-123',
        client_secret: 'secret-xyz',
        client_id_issued_at: 1700000000,
        client_secret_expires_at: 1800000000,
      },
    })

    const client = await registerClient({
      registrationEndpoint: ENDPOINT,
      metadata: { redirectUris: ['http://localhost:3000/callback'] },
      fetch,
    })

    expect(client).toEqual({
      clientId: 'client-123',
      clientSecret: 'secret-xyz',
      clientIdIssuedAt: 1700000000,
      clientSecretExpiresAt: 1800000000,
    })
  })

  it('throws a typed registration error on a 4xx, carrying the server error code', async () => {
    const { fetch } = serverAnswering({
      status: 400,
      body: { error: 'invalid_client_metadata', error_description: 'bad redirect_uri' },
    })

    const attempt = registerClient({
      registrationEndpoint: ENDPOINT,
      metadata: { redirectUris: ['not a url'] },
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({
      name: 'OAuthError',
      failure: EOAuthFailure.RegistrationFailed,
      code: 'invalid_client_metadata',
      status: 400,
      message: 'bad redirect_uri',
    })
  })

  it('throws a typed registration error on a 5xx without a body', async () => {
    const { fetch } = serverAnswering({ status: 503 })

    const attempt = registerClient({
      registrationEndpoint: ENDPOINT,
      metadata: { redirectUris: ['http://localhost:3000/callback'] },
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({
      failure: EOAuthFailure.RegistrationFailed,
      status: 503,
    })
  })

  it('throws when the response carries no client_id', async () => {
    const { fetch } = serverAnswering({ body: { unexpected: true } })

    const attempt = registerClient({
      registrationEndpoint: ENDPOINT,
      metadata: { redirectUris: ['http://localhost:3000/callback'] },
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({ failure: EOAuthFailure.RegistrationFailed })
  })
})
