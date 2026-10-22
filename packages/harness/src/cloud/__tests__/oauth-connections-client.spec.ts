import { describe, expect, it } from 'bun:test'

import { fakeOauthApi } from '../../credentials/__tests__/oauth-api-fake'
import { CloudError } from '../cloud-transport'
import { oauthAccessResponseSchema } from '../oauth-connections-client'

const tokens = { accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: '2026-10-05T13:00:00.000Z' }

describe('OAuthConnectionsClient', () => {
  it('uploads a seed and reads back an access-only response, tolerating additive fields', async () => {
    const api = fakeOauthApi()

    const access = await api.client().handoff({ connectionId: 'oauth_1', provider: 'anthropic', tokens })

    expect(access.accessToken).toBe('fake-access')
    expect(access.generation).toBe(0)
    expect(JSON.stringify(access)).not.toContain('fake-refresh')
    expect(api.calls).toEqual(['PUT /v1/oauth-connections/oauth_1'])
  })

  it('reports the rejected access token to the issuance route and the sandbox assignment route', async () => {
    const api = fakeOauthApi()
    const client = api.client()
    await client.handoff({ connectionId: 'oauth_1', provider: 'openai', tokens })

    const next = await client.accessToken({ connectionId: 'oauth_1', rejectedAccessToken: 'fake-access' })
    await client.assignSandbox({ connectionId: 'oauth_1', threadId: 'thread-1' })

    expect(next.generation).toBe(1)
    expect(api.calls).toContain('PUT /v1/oauth-connections/oauth_1/sandboxes/thread-1')
  })

  it('sends predecessor and successor authorization ids on reauthorize and surfaces a stale predecessor', async () => {
    const api = fakeOauthApi()
    const client = api.client()
    await client.handoff({ connectionId: 'oauth_1', provider: 'anthropic', tokens })
    const reauth = { connectionId: 'oauth_1', provider: 'anthropic' as const, tokens, authorizationId: 'auth_2', previousAuthorizationId: 'oauth_1' }

    expect((await client.reauthorize(reauth)).authorizationId).toBe('auth_2')
    expect((await client.reauthorize(reauth)).generation).toBe(1)

    const stale = await client.reauthorize({ ...reauth, authorizationId: 'auth_3' }).catch((error: unknown) => error)
    expect(stale).toBeInstanceOf(CloudError)
    expect((stale as CloudError).status).toBe(409)
  })

  it('allows the server refresh and contention wait to finish before the access request times out', async () => {
    const api = fakeOauthApi()
    await api.client().handoff({ connectionId: 'oauth_1', provider: 'anthropic', tokens })
    const timeout = AbortSignal.timeout
    const deadlines: number[] = []
    AbortSignal.timeout = (milliseconds: number) => {
      deadlines.push(milliseconds)
      return timeout(milliseconds)
    }
    try {
      await api.client().accessToken({ connectionId: 'oauth_1' })
      expect(deadlines).toEqual([30_000])
    } finally {
      AbortSignal.timeout = timeout
    }
  })

  it('refuses a body that is not an access response', () => {
    expect(oauthAccessResponseSchema.safeParse({ accessToken: 'a', expiresAt: 'soon', generation: 0 }).success).toBe(false)
    expect(oauthAccessResponseSchema.safeParse({ accessToken: 'a', expiresAt: '2026-10-05T13:00:00.000Z', generation: 'x' }).success).toBe(false)
  })
})
