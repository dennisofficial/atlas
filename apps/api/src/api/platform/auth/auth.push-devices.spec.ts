import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeAll, describe, expect, it } from 'bun:test'

const CREDENTIALS = {
  email: 'push-devices@test.local',
  password: 'a-long-enough-password',
  name: 'Push Devices',
}

const bearerHeaders = (token: string) => new Headers({ authorization: `Bearer ${token}` })

describe('better-auth session deletion and push devices', () => {
  useTestDatabase()
  let auth: typeof import('./auth.server').auth

  beforeAll(async () => {
    ;({ auth } = await import('./auth.server'))
  })

  const signIn = async () => {
    const reply = await auth.api.signInEmail({
      body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
    })
    const session = await auth.api.getSession({ headers: bearerHeaders(reply.token) })
    if (session === null) throw new Error('sign-in produced no session')
    return { token: reply.token, userId: reply.user.id, sessionId: session.session.id }
  }

  const addDevice = ({
    token,
    userId,
    authSessionId,
  }: {
    token: string
    userId: string
    authSessionId: string | null
  }) =>
    db.orm.public.PushDevice.create({
      token,
      platform: 'ios',
      lastSeenAt: new Date(),
      userId,
      authSessionId,
    })

  const deviceTokens = async () =>
    (await db.orm.public.PushDevice.all()).map((device) => device.token).sort()

  const signUpAndSignInTwice = async () => {
    await auth.api.signUpEmail({ body: CREDENTIALS })
    return { first: await signIn(), second: await signIn() }
  }

  it('deletes the devices of a signed-out session and keeps every other device', async () => {
    const { first, second } = await signUpAndSignInTwice()
    await addDevice({ token: 'tok-first', userId: first.userId, authSessionId: first.sessionId })
    await addDevice({ token: 'tok-second', userId: second.userId, authSessionId: second.sessionId })
    await addDevice({ token: 'tok-legacy', userId: first.userId, authSessionId: null })

    await auth.api.signOut({ headers: bearerHeaders(first.token) })

    expect(await deviceTokens()).toEqual(['tok-legacy', 'tok-second'])
  })

  it('deletes the devices of every session when all of a user sessions are revoked', async () => {
    const { first, second } = await signUpAndSignInTwice()
    await addDevice({ token: 'tok-first', userId: first.userId, authSessionId: first.sessionId })
    await addDevice({ token: 'tok-second', userId: second.userId, authSessionId: second.sessionId })
    await addDevice({ token: 'tok-legacy', userId: first.userId, authSessionId: null })

    await auth.api.revokeSessions({ headers: bearerHeaders(second.token) })

    expect(await deviceTokens()).toEqual(['tok-legacy'])
  })
})
