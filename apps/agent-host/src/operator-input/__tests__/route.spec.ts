import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { EOperatorRequestStatus } from '../store'
import { askOf, clockOf, postOf, registryOf, routeOf, seedSession, VALUE } from './fixtures'

const testDb = useTestDatabase()

const MAX_VALUE_LENGTH = 64 * 1024

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
    const registry = registryOf({ db, clock: clockOf() })
    const route = routeOf({ registry })

    expect((await route(postOf({ body: { requestId: 'oreq_1', value: VALUE } })))?.status).toBe(401)
    expect(
      (await route(postOf({ body: { requestId: 'oreq_1', value: VALUE }, bearer: 'token-2' })))
        ?.status,
    ).toBe(401)
  })

  it("refuses an answer to another user's session", async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    const answer = await routeOf({ registry, userId: 'user-2' })(
      postOf({ body: { requestId: opened.requestId, value: VALUE }, bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(403)
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Pending,
    )
    opened.abandon('cancelled')
  })

  it('delivers a value to the waiting call and answers an empty body', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    const answer = await routeOf({ registry })(
      postOf({ body: { requestId: opened.requestId, value: VALUE }, bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(200)
    expect(await answer?.json()).toEqual({})
    expect(await opened.answered).toEqual({ ok: true, value: VALUE })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Answered,
    )
  })

  it('answers 404 for an unknown request and for one already settled', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })
    const route = routeOf({ registry })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })
    await route(postOf({ body: { requestId: opened.requestId, value: VALUE }, bearer: 'token-1' }))

    expect(
      (
        await route(
          postOf({ body: { requestId: 'oreq_unknown', value: VALUE }, bearer: 'token-1' }),
        )
      )?.status,
    ).toBe(404)
    expect(
      (
        await route(
          postOf({ body: { requestId: opened.requestId, value: VALUE }, bearer: 'token-1' }),
        )
      )?.status,
    ).toBe(404)
  })

  it('answers 409 when the waiting call is not held by this host', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const elsewhere = registryOf({ db, clock })
    const opened = await elsewhere.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    const answer = await routeOf({ registry: registryOf({ db, clock }) })(
      postOf({ body: { requestId: opened.requestId, value: VALUE }, bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(409)
    expect(await answer?.json()).toEqual({ reason: 'not_held_here' })
  })

  it('cancels the waiting call and marks the row cancelled', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    const answer = await routeOf({ registry })(
      postOf({ body: { requestId: opened.requestId, cancel: true }, bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(200)
    expect(await opened.answered).toEqual({ ok: false, reason: 'cancelled' })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Cancelled,
    )
  })

  it('refuses a body over the value cap and one that both answers and cancels', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })
    const route = routeOf({ registry })

    const tooLong = await route(
      postOf({
        body: { requestId: opened.requestId, value: 'a'.repeat(MAX_VALUE_LENGTH + 1) },
        bearer: 'token-1',
      }),
    )
    const both = await route(
      postOf({
        body: { requestId: opened.requestId, value: VALUE, cancel: true },
        bearer: 'token-1',
      }),
    )

    expect(tooLong?.status).toBe(400)
    expect(both?.status).toBe(400)
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Pending,
    )
  })
})
