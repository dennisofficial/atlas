import { describe, expect, it } from 'bun:test'
import { GithubDeviceClient, type GithubHttpRequest } from '../github-device-client'

const REDIRECT_URI = 'https://api.byatlas.io/v1/github/oauth/callback'

describe('GitHub redirect exchange', () => {
  it('sends the code, secret and exact redirect URI to GitHub', async () => {
    const calls: { url: string; request: GithubHttpRequest }[] = []
    const client = new GithubDeviceClient({
      fetchFn: async (url, request) => {
        calls.push({ url, request })
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ access_token: 'token', scope: 'repo' }),
        }
      },
    })
    expect(
      await client.exchangeRedirectToken({
        clientId: 'client',
        clientSecret: 'secret',
        code: 'code',
        redirectUri: REDIRECT_URI,
      }),
    ).toEqual({ accessToken: 'token', scope: 'repo' })
    expect(calls[0]?.url).toBe('https://github.com/login/oauth/access_token')
    expect(calls[0]?.request.headers.Accept).toBe('application/json')
    expect(JSON.parse(calls[0]?.request.body ?? '{}')).toEqual({
      client_id: 'client',
      client_secret: 'secret',
      code: 'code',
      redirect_uri: REDIRECT_URI,
    })
  })

  it('reports GitHub errors instead of accepting a missing token', async () => {
    const client = new GithubDeviceClient({
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ error: 'bad_verification_code', error_description: 'Code expired' }),
      }),
    })
    await expect(
      client.exchangeRedirectToken({
        clientId: 'client',
        clientSecret: 'secret',
        code: 'code',
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toThrow('Code expired')
  })
})
