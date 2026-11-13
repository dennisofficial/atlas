import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { CALL, clockOf, postOf, registryOf, routeOf, seedSession, settle, VALUE } from './fixtures'

const testDb = useTestDatabase()

const MAX_VALUE_LENGTH = 64 * 1024
const body = { sessionId: 'ses_1', callId: CALL, value: VALUE }
const cancel = { sessionId: 'ses_1', callId: CALL, cancel: true }

describe('the operator answer route', () => {
  it('leaves every other path to the stream server', async () => {
    const { db } = testDb()
    const registry = registryOf({ db, clock: clockOf() })

    expect(await routeOf({ registry })(postOf({ body: {}, path: '/healthz' }))).toBeNull()
  })

  it('answers the preflight with the cors headers', async () => {
    const { db } = testDb()
    const registry = registryOf({ db, clock: clockOf() })

    const answer = await routeOf({ registry, trusted: ['https://byatlas.io'] })(
      postOf({ body: {}, method: 'OPTIONS', origin: 'https://byatlas.io' }),
    )

    expect(answer?.status).toBe(204)
    expect(answer?.headers.get('access-control-allow-origin')).toBe('https://byatlas.io')
    expect(answer?.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('refuses a request with no bearer and one with an unknown bearer', async () => {
    const { db } = testDb()
    const route = routeOf({ registry: registryOf({ db, clock: clockOf() }) })

    expect((await route(postOf({ body })))?.status).toBe(401)
    expect((await route(postOf({ body, bearer: 'token-2' })))?.status).toBe(401)
  })

  it('refuses the requestId body the shipped interface used to send', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const route = routeOf({ registry: registryOf({ db, clock: clockOf() }) })

    const answer = await route(
      postOf({ body: { requestId: 'oreq_1', value: VALUE }, bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(400)
  })

  it('refuses a value and a cancel together, a missing callId and an oversized value', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const route = routeOf({ registry: registryOf({ db, clock: clockOf() }) })

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

  it("answers 404 for another user's session and accepts the owner's", async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })

    const refused = await routeOf({ registry, userId: 'user-2' })(
      postOf({ body, bearer: 'token-1' }),
    )
    expect(refused?.status).toBe(404)

    const answering = routeOf({ registry, userId: 'user-1' })(
      postOf({ body: cancel, bearer: 'token-1' }),
    )
    await settle()
    registry.answers.resolve({ key: { sessionId: 'ses_1', callId: CALL }, result: { ok: true } })

    expect((await answering)?.status).toBe(200)
  })
})
