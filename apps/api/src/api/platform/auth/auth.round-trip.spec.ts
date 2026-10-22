import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeAll, describe, expect, it } from 'vitest'

describe('better-auth over the shared pool', () => {
  const database = useTestDatabase()
  let auth: typeof import('./auth.server').auth

  beforeAll(async () => {
    ;({ auth } = await import('./auth.server'))
  })

  it('signs up and signs in against real Postgres', async () => {
    const credentials = { email: 'round-trip@test.local', password: 'a-long-enough-password', name: 'Round Trip' }

    const signedUp = await auth.api.signUpEmail({ body: credentials })
    expect(signedUp.user).toMatchObject({ email: credentials.email, name: credentials.name })

    const signedIn = await auth.api.signInEmail({ body: { email: credentials.email, password: credentials.password } })
    expect(signedIn.user.id).toBe(signedUp.user.id)

    const { db } = database()
    const user = await db.orm.public.User.first({ id: signedUp.user.id })
    expect(user?.createdAt).toBeInstanceOf(Date)
    expect(await db.orm.public.Account.where({ userId: signedUp.user.id }).all()).toHaveLength(1)
    expect(await db.orm.public.Session.where({ userId: signedUp.user.id }).all()).toHaveLength(2)
  })

  it('creates an organization and its owner membership', async () => {
    const { user } = await auth.api.signUpEmail({
      body: { email: 'owner@test.local', password: 'a-long-enough-password', name: 'Owner' },
    })

    const created = await auth.api.createOrganization({
      body: { name: 'Acme', slug: 'acme', userId: user.id },
    })

    const members = await database().db.orm.public.Member.where({ organizationId: created.id }).all()
    expect(members).toMatchObject([{ userId: user.id, role: 'owner' }])
  })
})
