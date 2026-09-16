import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  actOnDevice,
  AuthApiError,
  claimDeviceCode,
  normalizeUserCode,
  sessionUserPresent,
  signIn,
  signUp,
  UNREACHABLE,
} from '../auth-api'

let fetchCalls: { url: string; init?: RequestInit }[]
const realFetch = globalThis.fetch

const answerWith = (response: Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  }) as typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  fetchCalls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('normalizeUserCode', () => {
  it('uppercases and strips dashes and whitespace', () => {
    expect(normalizeUserCode('  abcd-efgh ')).toBe('ABCDEFGH')
  })

  it('answers empty for a missing code', () => {
    expect(normalizeUserCode(null)).toBe('')
  })
})

describe('sessionUserPresent', () => {
  it('reads the body, not the status: 200 with a user is signed in', async () => {
    answerWith(json({ user: { email: 'a@b.c' }, session: { id: 's' } }))

    expect(await sessionUserPresent()).toBe(true)
    expect(fetchCalls[0]?.url).toBe('/api/auth/get-session')
  })

  it('answers false for the 200-with-empty-body signed-out shape', async () => {
    answerWith(json({ session: null }))

    expect(await sessionUserPresent()).toBe(false)
  })

  it('answers false when the response is not ok', async () => {
    answerWith(json({}, 401))

    expect(await sessionUserPresent()).toBe(false)
  })

  it('turns a network failure into an unreachable error', async () => {
    globalThis.fetch = (async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      throw new TypeError('fetch failed')
    }) as typeof fetch

    const failure = await sessionUserPresent().catch((thrown: unknown) => thrown)

    expect(failure).toBeInstanceOf(AuthApiError)
    expect((failure as Error).message).toBe(UNREACHABLE)
  })
})

describe('signIn', () => {
  it('posts the email and password', async () => {
    answerWith(json({}))

    await signIn({ email: 'a@b.c', password: 'hunter2secret' })

    expect(fetchCalls[0]?.url).toBe('/api/auth/sign-in/email')
    expect(fetchCalls[0]?.init?.method).toBe('POST')
  })

  it('falls back to the fixed invalid-credentials message', async () => {
    answerWith(json({}, 401))

    await expect(signIn({ email: 'a@b.c', password: 'nope' })).rejects.toMatchObject({
      message: 'Invalid email or password',
    })
  })
})

describe('signUp', () => {
  it('surfaces the server message when there is one', async () => {
    answerWith(json({ message: 'email already registered' }, 422))

    await expect(
      signUp({ name: 'D', email: 'a@b.c', password: 'hunter2secret' }),
    ).rejects.toMatchObject({ message: 'email already registered' })
  })
})

describe('claimDeviceCode', () => {
  it('encodes the code into the device claim url', async () => {
    answerWith(json({}))

    await claimDeviceCode('ABCD1234')

    expect(fetchCalls[0]?.url).toBe('/api/auth/device?user_code=ABCD1234')
  })

  it('names an unknown or expired code', async () => {
    answerWith(json({ error_description: 'expired' }, 400))

    await expect(claimDeviceCode('ABCD1234')).rejects.toBeInstanceOf(AuthApiError)
  })
})

describe('actOnDevice', () => {
  it('posts the action with the user code', async () => {
    answerWith(json({}))

    await actOnDevice({ action: 'approve', userCode: 'ABCD1234' })

    expect(fetchCalls[0]?.url).toBe('/api/auth/device/approve')
    expect(fetchCalls[0]?.init?.body).toBe(JSON.stringify({ userCode: 'ABCD1234' }))
  })

  it('raises AuthApiError on a failed deny', async () => {
    answerWith(json({}, 500))

    await expect(actOnDevice({ action: 'deny', userCode: 'ABCD1234' })).rejects.toMatchObject({
      message: 'Request failed',
    })
  })
})
