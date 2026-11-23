import { describe, expect, it } from 'bun:test'

import { APNS_PUSH_PATH, APNS_TOKEN_PATH, createApnsRoutes } from '../apns-routes'

const post = (pathname: string, body: unknown): Request =>
  new Request(`http://127.0.0.1${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const routesOf = (args: { signedIn?: boolean; fail?: boolean } = {}) => {
  const registered: string[] = []
  const routes = createApnsRoutes({
    signedIn: () => args.signedIn ?? true,
    register: async ({ token }) => {
      if (args.fail === true) throw new Error('offline')
      registered.push(token)
    },
  })
  return { routes, registered }
}

describe('apns token route', () => {
  it('registers the token once while signed in', async () => {
    const { routes, registered } = routesOf()

    await routes.handler(post(APNS_TOKEN_PATH, { token: 'abc' }), APNS_TOKEN_PATH)
    await routes.sync()
    await routes.sync()

    expect(registered).toEqual(['abc'])
  })

  it('registers once per token and again after a new sign-in', async () => {
    const signedIn = { value: true }
    const registered: string[] = []
    const routes = createApnsRoutes({
      signedIn: () => signedIn.value,
      register: async ({ token }) => {
        registered.push(token)
      },
    })

    await routes.handler(post(APNS_TOKEN_PATH, { token: 'abc' }), APNS_TOKEN_PATH)
    await routes.handler(post(APNS_TOKEN_PATH, { token: 'abc' }), APNS_TOKEN_PATH)
    signedIn.value = false
    await routes.sync()
    signedIn.value = true
    await routes.sync()

    expect(registered).toEqual(['abc', 'abc'])
  })

  it('holds a token that arrives before the sign-in and registers on it', async () => {
    const signedIn = { value: false }
    const registered: string[] = []
    const routes = createApnsRoutes({
      signedIn: () => signedIn.value,
      register: async ({ token }) => {
        registered.push(token)
      },
    })

    await routes.handler(post(APNS_TOKEN_PATH, { token: 'abc' }), APNS_TOKEN_PATH)
    expect(registered).toEqual([])
    signedIn.value = true
    await routes.sync()
    expect(registered).toEqual(['abc'])
  })

  it('registers again on the next change when the call fails', async () => {
    const { routes, registered } = routesOf({ fail: true })

    await routes.handler(post(APNS_TOKEN_PATH, { token: 'abc' }), APNS_TOKEN_PATH)
    expect(registered).toEqual([])
  })

  it('refuses a body it cannot read', async () => {
    const { routes } = routesOf()

    const reply = await routes.handler(post(APNS_TOKEN_PATH, { token: '' }), APNS_TOKEN_PATH)

    expect(reply?.status).toBe(400)
  })
})

describe('apns push route', () => {
  it('names the group of a clear push', async () => {
    const { routes } = routesOf()

    const reply = await routes.handler(
      post(APNS_PUSH_PATH, {
        userInfo: { aps: { 'content-available': 1 }, clearSessionId: 'session-1' },
        groupIds: ['session-1', 'session-2'],
      }),
      APNS_PUSH_PATH,
    )

    expect(await reply?.json()).toEqual({ groups: ['session-1'] })
  })

  it('removes nothing for an alert push or an unknown payload', async () => {
    const { routes } = routesOf()

    const alert = await routes.handler(
      post(APNS_PUSH_PATH, {
        userInfo: { sessionId: 'session-1', seq: 7 },
        groupIds: ['session-1'],
      }),
      APNS_PUSH_PATH,
    )
    const unknown = await routes.handler(
      post(APNS_PUSH_PATH, { userInfo: null, groupIds: ['session-1'] }),
      APNS_PUSH_PATH,
    )

    expect(await alert?.json()).toEqual({ groups: [] })
    expect(await unknown?.json()).toEqual({ groups: [] })
  })

  it('leaves a path it does not own alone', async () => {
    const { routes } = routesOf()

    expect(await routes.handler(post('/desktop/health', {}), '/desktop/health')).toBeUndefined()
  })
})
