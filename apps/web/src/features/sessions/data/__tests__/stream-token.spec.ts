import { afterEach, describe, expect, it, mock } from 'bun:test'

import { AuthApiError } from '@/lib/auth-api'

import { fetchStreamToken, SIGNED_OUT_CODE } from '../stream-token'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const respond = (body: unknown, status = 200) => {
  const fetchMock = mock(async (_input: unknown) => Response.json(body, { status }))
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('fetchStreamToken', () => {
  it('returns the session token from get-session', async () => {
    const fetchMock = respond({ user: { id: 'u' }, session: { token: 'tok-1' } })

    expect(await fetchStreamToken()).toBe('tok-1')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/get-session')
  })

  it('throws when there is no session', async () => {
    respond(null)

    await expect(fetchStreamToken()).rejects.toMatchObject({ code: SIGNED_OUT_CODE })
  })

  it('throws when the session carries no token', async () => {
    respond({ user: { id: 'u' }, session: {} })

    await expect(fetchStreamToken()).rejects.toBeInstanceOf(AuthApiError)
  })

  it('throws when the session check is refused', async () => {
    respond({ message: 'nope' }, 401)

    await expect(fetchStreamToken()).rejects.toMatchObject({ code: SIGNED_OUT_CODE })
  })

  it('throws when Atlas Cloud is unreachable', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch

    const failure = await fetchStreamToken().catch((caught: unknown) => caught)
    expect(failure).toBeInstanceOf(AuthApiError)
    expect(failure).not.toMatchObject({ code: SIGNED_OUT_CODE })
  })
})
