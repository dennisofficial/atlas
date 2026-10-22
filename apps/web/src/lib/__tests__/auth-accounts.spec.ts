import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { AuthApiError, UNREACHABLE } from '../auth-api'
import { linkGoogleUrl, listSignInMethods, unlinkSignInMethod } from '../auth-accounts'

let fetchCalls: { url: string; init?: RequestInit }[]
const realFetch = globalThis.fetch

const answerWith = (response: Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  }) as typeof fetch
}

const rejectNetwork = (): void => {
  globalThis.fetch = (async () => {
    throw new TypeError('network')
  }) as typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const bodyOf = (index: number): unknown => JSON.parse(String(fetchCalls[index]?.init?.body))

beforeEach(() => {
  fetchCalls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('listSignInMethods', () => {
  it('maps credential and google account rows to their row ids', async () => {
    answerWith(
      json([
        { id: 'acc-1', providerId: 'credential', accountId: 'user-1' },
        { id: 'acc-2', providerId: 'google', accountId: '1234567890' },
      ]),
    )

    expect(await listSignInMethods()).toEqual({ google: 'acc-2', password: 'acc-1' })
    expect(fetchCalls[0]?.url).toBe('/api/auth/list-accounts')
  })

  it('answers null for a method with no account row', async () => {
    answerWith(json([{ id: 'acc-2', providerId: 'google', accountId: '1' }]))

    expect(await listSignInMethods()).toEqual({ google: 'acc-2', password: null })
  })

  it('ignores providers the settings page does not manage', async () => {
    answerWith(json([{ id: 'acc-9', providerId: 'github', accountId: '7' }]))

    expect(await listSignInMethods()).toEqual({ google: null, password: null })
  })

  it('fails with the server message when the answer is not ok', async () => {
    answerWith(json({ message: 'Unauthorized' }, 401))

    await expect(listSignInMethods()).rejects.toMatchObject({ message: 'Unauthorized' })
  })

  it('fails when the answer is not a list', async () => {
    answerWith(json({ nope: true }))

    await expect(listSignInMethods()).rejects.toBeInstanceOf(AuthApiError)
  })

  it('maps a rejected fetch to the unreachable message', async () => {
    rejectNetwork()

    await expect(listSignInMethods()).rejects.toMatchObject({ message: UNREACHABLE })
  })
})

describe('linkGoogleUrl', () => {
  it('posts absolute web-origin callbacks and returns the provider url', async () => {
    answerWith(json({ url: 'https://accounts.google.com/o/oauth2/auth?x=1', redirect: true }))

    const url = await linkGoogleUrl({ origin: 'https://byatlas.io' })

    expect(url).toBe('https://accounts.google.com/o/oauth2/auth?x=1')
    expect(fetchCalls[0]?.url).toBe('/api/auth/link-social')
    expect(fetchCalls[0]?.init?.method).toBe('POST')
    expect(bodyOf(0)).toEqual({
      provider: 'google',
      callbackURL: 'https://byatlas.io/settings/account?linked=google',
      errorCallbackURL: 'https://byatlas.io/settings/account',
    })
  })

  it('fails when the answer carries no url', async () => {
    answerWith(json({}))

    await expect(linkGoogleUrl({ origin: 'https://byatlas.io' })).rejects.toBeInstanceOf(
      AuthApiError,
    )
  })

  it('fails with the server message when the answer is not ok', async () => {
    answerWith(json({ message: 'Provider not found' }, 404))

    await expect(linkGoogleUrl({ origin: 'https://byatlas.io' })).rejects.toMatchObject({
      message: 'Provider not found',
    })
  })

  it('maps a rejected fetch to the unreachable message', async () => {
    rejectNetwork()

    await expect(linkGoogleUrl({ origin: 'https://byatlas.io' })).rejects.toMatchObject({
      message: UNREACHABLE,
    })
  })
})

describe('unlinkSignInMethod', () => {
  it('posts the account row id', async () => {
    answerWith(json({ status: true }))

    await unlinkSignInMethod('acc-2')

    expect(fetchCalls[0]?.url).toBe('/api/auth/unlink-account')
    expect(fetchCalls[0]?.init?.method).toBe('POST')
    expect(bodyOf(0)).toEqual({ accountId: 'acc-2' })
  })

  it('surfaces the server refusal for the last method', async () => {
    answerWith(
      json(
        { message: 'You cannot unlink your last account', code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' },
        400,
      ),
    )

    await expect(unlinkSignInMethod('acc-2')).rejects.toMatchObject({
      message: 'You cannot unlink your last account',
      code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
    })
  })

  it('asks for a fresh sign-in when better-auth refuses a stale session', async () => {
    answerWith(json({ message: 'Session is not fresh', code: 'SESSION_NOT_FRESH' }, 403))

    await expect(unlinkSignInMethod('acc-2')).rejects.toMatchObject({
      message: 'Sign out and back in, then remove this sign-in method.',
      code: 'SESSION_NOT_FRESH',
    })
  })

  it('maps a rejected fetch to the unreachable message', async () => {
    rejectNetwork()

    await expect(unlinkSignInMethod('acc-2')).rejects.toMatchObject({ message: UNREACHABLE })
  })
})
