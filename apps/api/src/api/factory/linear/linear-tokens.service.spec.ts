import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { LinearTokensService } from './linear-tokens.service'

const ENV = {
  LINEAR_CLIENT_ID: 'linear-client-id',
  LINEAR_CLIENT_SECRET: 'linear-client-secret',
}

function tokenResponse(args: { token: string; expiresIn: number }): Response {
  return new Response(
    JSON.stringify({ access_token: args.token, expires_in: args.expiresIn, scope: 'read write' }),
    { status: 200 },
  )
}

describe('LinearTokensService', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses when the oauth app is not configured', async () => {
    const tokens = new LinearTokensService(new EnvService({}))

    await expect(tokens.getToken()).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mints a client-credentials token with basic auth and caches it', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse({ token: 'token-1', expiresIn: 2591999 }))
    const tokens = new LinearTokensService(new EnvService(ENV))

    const first = await tokens.getToken()
    const second = await tokens.getToken()

    expect(first).toBe('token-1')
    expect(second).toBe('token-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.linear.app/oauth/token')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from('linear-client-id:linear-client-secret').toString('base64')}`,
    )
    expect(init.body).toContain('grant_type=client_credentials')
    expect(init.body).toContain('scope=read%2Cwrite')
  })

  it('refetches once the cached token expires', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ token: 'token-1', expiresIn: 0 }))
      .mockResolvedValueOnce(tokenResponse({ token: 'token-2', expiresIn: 2591999 }))
    const tokens = new LinearTokensService(new EnvService(ENV))

    const first = await tokens.getToken()
    const second = await tokens.getToken()

    expect(first).toBe('token-1')
    expect(second).toBe('token-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('invalidate forces a refetch for the 401 path', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ token: 'token-1', expiresIn: 2591999 }))
      .mockResolvedValueOnce(tokenResponse({ token: 'token-2', expiresIn: 2591999 }))
    const tokens = new LinearTokensService(new EnvService(ENV))

    await tokens.getToken()
    tokens.invalidate()
    const refreshed = await tokens.getToken()

    expect(refreshed).toBe('token-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a failed mint throws without leaking the response body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_client', secret: 'do-not-leak' }), {
        status: 401,
      }),
    )
    const tokens = new LinearTokensService(new EnvService(ENV))

    const failure = await tokens.getToken().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain('do-not-leak')
  })
})
