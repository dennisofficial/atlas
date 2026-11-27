import { describe, expect, it } from 'bun:test'

import {
  AuthAccountError,
  SIGN_IN_AGAIN,
  SESSION_NOT_FRESH,
  UNREACHABLE,
  createAuthAccountApi,
  unlinkRefusalOf,
} from '../auth-api'

const BASE_URL = 'https://api.example.test'
const TOKEN = 'bearer-token'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const apiWith = (response: Response) => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return response
  }) as unknown as typeof fetch
  return { api: createAuthAccountApi({ baseUrl: BASE_URL, token: TOKEN, fetchFn }), calls }
}

const rejectingApi = () =>
  createAuthAccountApi({
    baseUrl: BASE_URL,
    token: TOKEN,
    fetchFn: (async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch,
  })

const bodyOf = (init: RequestInit | undefined): unknown => JSON.parse(String(init?.body))

describe('auth account requests', () => {
  it('reads the current session with the bearer token', async () => {
    const { api, calls } = apiWith(
      json({
        session: { token: 't' },
        user: { name: 'Dennis', email: 'd@example.test', createdAt: '2026-09-23T17:58:36.683Z' },
      }),
    )

    expect(await api.getCurrentSession()).toEqual({
      session: { token: 't' },
      user: { name: 'Dennis', email: 'd@example.test', createdAt: '2026-09-23T17:58:36.683Z' },
    })
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/auth/get-session`)
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]?.init?.method).toBe('GET')
  })

  it('saves the name as a post', async () => {
    const { api, calls } = apiWith(json({ status: true }))

    await api.updateName('Dennis L')

    expect(calls[0]?.url).toBe(`${BASE_URL}/api/auth/update-user`)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(bodyOf(calls[0]?.init)).toEqual({ name: 'Dennis L' })
  })

  it('reads the sign-in method ids', async () => {
    const { api } = apiWith(
      json([
        { id: 'acc-1', providerId: 'credential' },
        { id: 'acc-2', providerId: 'google' },
      ]),
    )

    expect(await api.listSignInMethods()).toEqual({ google: 'acc-2', password: 'acc-1' })
  })

  it('reads the sessions', async () => {
    const { api } = apiWith(
      json([{ id: 's', token: 't', createdAt: 'x', expiresAt: 'y', userAgent: 'curl/8' }]),
    )

    expect(await api.listSessions()).toEqual([
      { id: 's', token: 't', createdAt: 'x', expiresAt: 'y', userAgent: 'curl/8' },
    ])
  })

  it('revokes one session and every other session', async () => {
    const unlink = apiWith(json({ status: true }))
    await unlink.api.revokeSession('t')
    expect(unlink.calls[0]?.url).toBe(`${BASE_URL}/api/auth/revoke-session`)
    expect(bodyOf(unlink.calls[0]?.init)).toEqual({ token: 't' })

    const others = apiWith(json({ status: true }))
    await others.api.revokeOtherSessions()
    expect(others.calls[0]?.url).toBe(`${BASE_URL}/api/auth/revoke-other-sessions`)
    expect(bodyOf(others.calls[0]?.init)).toEqual({})
  })

  it('requests a reset link at the given address', async () => {
    const { api, calls } = apiWith(json({ status: true }))

    await api.requestPasswordReset({
      email: 'd@example.test',
      redirectTo: 'https://byatlas.io/reset-password',
    })

    expect(calls[0]?.url).toBe(`${BASE_URL}/api/auth/request-password-reset`)
    expect(bodyOf(calls[0]?.init)).toEqual({
      email: 'd@example.test',
      redirectTo: 'https://byatlas.io/reset-password',
    })
  })
})

describe('auth account failures', () => {
  it('maps a rejected fetch to the unreachable message', async () => {
    await expect(rejectingApi().listSessions()).rejects.toMatchObject({ message: UNREACHABLE })
  })

  it('surfaces the server message and code', async () => {
    const { api } = apiWith(
      json(
        { message: 'You cannot unlink your last account', code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' },
        400,
      ),
    )

    await expect(api.unlinkAccount('acc-2')).rejects.toMatchObject({
      message: 'You cannot unlink your last account',
      code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
    })
  })

  it('asks for a fresh sign-in when better-auth refuses a stale session', async () => {
    const { api } = apiWith(json({ message: 'Session is not fresh', code: SESSION_NOT_FRESH }, 403))

    const failure = await api.unlinkAccount('acc-2').catch((cause: unknown) => cause)

    expect(failure).toBeInstanceOf(AuthAccountError)
    expect(failure).toMatchObject({ message: SIGN_IN_AGAIN, code: SESSION_NOT_FRESH, status: 403 })
  })

  it('fails when the answer is not the expected shape', async () => {
    const { api } = apiWith(json({ nope: true }))

    await expect(api.listSignInMethods()).rejects.toBeInstanceOf(AuthAccountError)
  })
})

describe('unlinkRefusalOf', () => {
  it('keeps an ordinary refusal verbatim', () => {
    expect(unlinkRefusalOf({ message: 'Nope', code: 'OTHER' })).toEqual({
      message: 'Nope',
      code: 'OTHER',
    })
  })

  it('replaces a stale session refusal with the next step', () => {
    expect(unlinkRefusalOf({ message: 'Session is not fresh', code: SESSION_NOT_FRESH })).toEqual({
      message: SIGN_IN_AGAIN,
      code: SESSION_NOT_FRESH,
    })
  })
})
