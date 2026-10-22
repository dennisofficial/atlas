import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  actOnDevice,
  AuthApiError,
  claimDeviceCode,
  formatUserCode,
  googleSignInUrl,
  isAccountExistsError,
  isInvalidTokenError,
  normalizeUserCode,
  requestPasswordReset,
  resetPassword,
  sessionUserPresent,
  signIn,
  signOut,
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

const bodyOf = (index: number): unknown => JSON.parse(String(fetchCalls[index]?.init?.body))

describe('formatUserCode', () => {
  it('shows eight characters as XXXX-XXXX', () => {
    expect(formatUserCode('abcd1234')).toBe('ABCD-1234')
    expect(formatUserCode('ABCD-1234')).toBe('ABCD-1234')
  })

  it('leaves short input ungrouped', () => {
    expect(formatUserCode('abc')).toBe('ABC')
    expect(formatUserCode(null)).toBe('')
  })
})

describe('googleSignInUrl', () => {
  it('posts absolute web-origin callbacks and returns the provider url', async () => {
    answerWith(json({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' }))

    const url = await googleSignInUrl({ origin: 'https://byatlas.io', next: null })

    expect(url).toBe('https://accounts.google.com/o/oauth2/auth?x=1')
    expect(fetchCalls[0]?.url).toBe('/api/auth/sign-in/social')
    expect(fetchCalls[0]?.init?.method).toBe('POST')
    expect(bodyOf(0)).toEqual({
      provider: 'google',
      callbackURL: 'https://byatlas.io/',
      newUserCallbackURL: 'https://byatlas.io/setup',
      errorCallbackURL: 'https://byatlas.io/sign-in?error=google',
    })
  })

  it('sends a returning and a new user to next, and keeps next on the error url', async () => {
    answerWith(json({ url: 'https://accounts.google.com/x' }))

    await googleSignInUrl({ origin: 'http://localhost:3001', next: '/device?user_code=ABCD1234' })

    expect(bodyOf(0)).toEqual({
      provider: 'google',
      callbackURL: 'http://localhost:3001/device?user_code=ABCD1234',
      newUserCallbackURL: 'http://localhost:3001/device?user_code=ABCD1234',
      errorCallbackURL:
        'http://localhost:3001/sign-in?error=google&next=%2Fdevice%3Fuser_code%3DABCD1234',
    })
  })

  it('fails when the answer carries no url', async () => {
    answerWith(json({}))

    await expect(googleSignInUrl({ origin: 'https://byatlas.io', next: null })).rejects.toBeInstanceOf(
      AuthApiError,
    )
  })

  it('maps a rejected fetch to the unreachable message', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('network')
    }) as typeof fetch

    await expect(googleSignInUrl({ origin: 'https://byatlas.io', next: null })).rejects.toMatchObject({
      message: UNREACHABLE,
    })
  })
})

describe('signOut', () => {
  it('posts to sign-out', async () => {
    answerWith(json({ success: true }))

    await signOut()

    expect(fetchCalls[0]?.url).toBe('/api/auth/sign-out')
    expect(fetchCalls[0]?.init?.method).toBe('POST')
  })

  it('raises on failure', async () => {
    answerWith(json({}, 500))

    await expect(signOut()).rejects.toMatchObject({ message: 'Sign-out failed' })
  })
})

describe('requestPasswordReset', () => {
  it('posts the email with an absolute reset-password redirect', async () => {
    answerWith(json({ status: true }))

    await requestPasswordReset({ email: 'a@b.c', origin: 'https://byatlas.io' })

    expect(fetchCalls[0]?.url).toBe('/api/auth/request-password-reset')
    expect(bodyOf(0)).toEqual({ email: 'a@b.c', redirectTo: 'https://byatlas.io/reset-password' })
  })

  it('raises with the server message on failure', async () => {
    answerWith(json({ message: 'Reset password isn\'t enabled' }, 400))

    await expect(
      requestPasswordReset({ email: 'a@b.c', origin: 'https://byatlas.io' }),
    ).rejects.toMatchObject({ message: 'Reset password isn\'t enabled' })
  })
})

describe('resetPassword', () => {
  it('posts the new password and token', async () => {
    answerWith(json({ status: true }))

    await resetPassword({ newPassword: 'hunter2secret', token: 'tok' })

    expect(fetchCalls[0]?.url).toBe('/api/auth/reset-password')
    expect(bodyOf(0)).toEqual({ newPassword: 'hunter2secret', token: 'tok' })
  })

  it('carries the better-auth error code so an invalid token is recognisable', async () => {
    answerWith(json({ code: 'INVALID_TOKEN', message: 'Invalid token' }, 400))

    const failure = await resetPassword({ newPassword: 'hunter2secret', token: 'x' }).catch(
      (cause: unknown) => cause,
    )

    expect(isInvalidTokenError(failure)).toBe(true)
    expect(isAccountExistsError(failure)).toBe(false)
  })
})

describe('isAccountExistsError', () => {
  it('recognises both better-auth duplicate-user codes', async () => {
    answerWith(json({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', message: 'exists' }, 422))

    const failure = await signUp({ name: 'D', email: 'a@b.c', password: 'hunter2secret' }).catch(
      (cause: unknown) => cause,
    )

    expect(isAccountExistsError(failure)).toBe(true)
    expect(isAccountExistsError(new Error('other'))).toBe(false)
  })
})
