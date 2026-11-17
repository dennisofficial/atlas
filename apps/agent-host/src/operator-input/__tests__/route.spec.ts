import { useTestDatabase } from '@dltech/atlas-db/testing'
import { operatorAnswerPayloadSchema } from '@dltech/atlas-plugin-operator/core'
import { describe, expect, it } from 'bun:test'

import type { Posted } from './fixtures'
import { CALL, cipher, postOf, registryOf, routeOf, seedSession, VALUE } from './fixtures'

const testDb = useTestDatabase()

const MAX_VALUE_LENGTH = 64 * 1024
const body = { sessionId: 'ses_1', callId: CALL, value: VALUE }
const cancel = { sessionId: 'ses_1', callId: CALL, cancel: true }

describe('the operator answer route', () => {
  it('refuses an origin the host does not trust', async () => {
    const { db } = testDb()
    const registry = registryOf({ db })

    const answer = await routeOf({ registry, trusted: ['https://byatlas.io'] })(
      postOf({ body, origin: 'https://evil.example', bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(403)
  })

  it('refuses a request with no bearer and one with an unknown bearer', async () => {
    const { db } = testDb()
    const route = routeOf({ registry: registryOf({ db }) })

    expect((await route(postOf({ body })))?.status).toBe(401)
    expect((await route(postOf({ body, bearer: 'token-2' })))?.status).toBe(401)
  })

  it('refuses the requestId body the shipped interface used to send', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const route = routeOf({ registry: registryOf({ db }) })

    const answer = await route(
      postOf({ body: { requestId: 'oreq_1', value: VALUE }, bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(400)
  })

  it('refuses a value and a cancel together, a missing callId and an oversized value', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const route = routeOf({ registry: registryOf({ db }) })

    const both = await route(postOf({ body: { ...body, cancel: true }, bearer: 'token-1' }))
    const noCall = await route(
      postOf({ body: { sessionId: 'ses_1', value: VALUE }, bearer: 'token-1' }),
    )
    const huge = await route(
      postOf({ body: { ...body, value: 'x'.repeat(MAX_VALUE_LENGTH + 1) }, bearer: 'token-1' }),
    )

    expect(both?.status).toBe(400)
    expect(noCall?.status).toBe(400)
    expect(huge?.status).toBe(400)
  })

  it("answers 200 straight away for the owner's session, with the value sealed in the inbox", async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const posted: Posted[] = []
    const registry = registryOf({ db, posted })

    const refused = await routeOf({ registry, userId: 'user-2' })(
      postOf({ body, bearer: 'token-1' }),
    )
    expect(refused?.status).toBe(404)

    const answered = await routeOf({ registry, userId: 'user-1' })(
      postOf({ body, bearer: 'token-1' }),
    )

    expect(answered?.status).toBe(200)
    const stored = operatorAnswerPayloadSchema.parse(JSON.parse(posted[0]?.payload ?? 'null'))
    expect(stored.callId).toBe(CALL)
    expect('sealedValue' in stored ? cipher.decrypt(stored.sealedValue) : undefined).toBe(VALUE)
    expect(posted[0]?.payload).not.toContain(VALUE)
  })

  it('stores a cancel with no value at all', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const posted: Posted[] = []

    const answered = await routeOf({ registry: registryOf({ db, posted }), userId: 'user-1' })(
      postOf({ body: cancel, bearer: 'token-1' }),
    )

    expect(answered?.status).toBe(200)
    expect(posted[0]?.payload).toBe(JSON.stringify({ callId: CALL, cancel: true }))
  })
})
