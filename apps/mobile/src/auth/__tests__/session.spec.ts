import { describe, expect, it } from 'bun:test'

import { fetchSession, revokeSession, signInWithPassword } from '../session'

const recorder = (respond: () => Response) => {
  const inits: RequestInit[] = []
  const fetchFn = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      inits.push(init ?? {})
      return respond()
    },
    { preconnect: () => undefined },
  )
  return { inits, fetchFn }
}

const credentialsOf = (init: RequestInit | undefined): unknown => init?.credentials

describe('the better-auth calls this app makes', () => {
  it('asks for the session without the device cookie jar', async () => {
    const { inits, fetchFn } = recorder(
      () =>
        new Response(JSON.stringify({ user: { id: 'u1', email: 'a@b.c', name: null } }), {
          status: 200,
        }),
    )
    const user = await fetchSession({ apiOrigin: 'https://api.example', token: 't', fetchFn })
    expect(user).toEqual({ id: 'u1', email: 'a@b.c' })
    expect(credentialsOf(inits[0])).toBe('omit')
  })

  it('signs in without the device cookie jar', async () => {
    const { inits, fetchFn } = recorder(
      () => new Response('{}', { status: 200, headers: { 'set-auth-token': 'token-1' } }),
    )
    const result = await signInWithPassword({
      apiOrigin: 'https://api.example',
      email: 'a@b.c',
      password: 'x',
      fetchFn,
    })
    expect(result).toEqual({ ok: true, token: 'token-1' })
    expect(credentialsOf(inits[0])).toBe('omit')
  })

  it('revokes the session without the device cookie jar', async () => {
    const { inits, fetchFn } = recorder(() => new Response('{}', { status: 200 }))
    const revoked = await revokeSession({ apiOrigin: 'https://api.example', token: 't', fetchFn })
    expect(revoked).toBe(true)
    expect(credentialsOf(inits[0])).toBe('omit')
  })
})
