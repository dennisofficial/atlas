import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { EOperatorRequestStatus } from '..'
import { askOf, clockOf, NOW_MS, registryOf, seedSession, tick, VALUE } from './fixtures'

const testDb = useTestDatabase()

describe('the operator request registry', () => {
  it('writes a pending row with the question and the deadline it hands back', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })

    const opened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf('shell'),
    })

    expect(opened.expiresAt.getTime()).toBe(NOW_MS + 15 * 60_000)
    const row = await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId })
    expect(row).toMatchObject({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      kind: 'shell',
      prompt: 'the login code',
      secret: true,
      shellId: 'shl_1',
      status: EOperatorRequestStatus.Pending,
      expiresAt: opened.expiresAt,
      resolvedAt: null,
    })
  })

  it('answers once, marks the row answered and refuses a second answer', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    const opened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    expect(
      await registry.answer({ requestId: opened.requestId, userId: 'user-1', value: VALUE }),
    ).toEqual({ ok: true })
    expect(await opened.answered).toEqual({ ok: true, value: VALUE })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Answered,
    )

    const again = await registry.answer({
      requestId: opened.requestId,
      userId: 'user-1',
      value: VALUE,
    })
    expect(again).toEqual({ ok: false, status: 404, reason: 'request' })
  })

  it('marks the row expired and answers the wait when the deadline passes', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    const opened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    clock.fire(15 * 60_000)
    await tick()

    expect(await opened.answered).toEqual({ ok: false, reason: 'expired' })
    const row = await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId })
    expect(row?.status).toBe(EOperatorRequestStatus.Expired)
    expect(row?.resolvedAt).toEqual(new Date(NOW_MS + 15 * 60_000))
  })

  it('marks the row cancelled when the waiting call abandons it', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    const opened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    opened.abandon('cancelled')
    await tick()

    expect(await opened.answered).toEqual({ ok: false, reason: 'cancelled' })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Cancelled,
    )
  })

  it('settles abandoned, not cancelled, when the host drops the turn', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    const opened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    opened.abandon('abandoned')
    await tick()

    expect(await opened.answered).toEqual({ ok: false, reason: 'abandoned' })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Abandoned,
    )
  })

  it('refuses a second pending request for the same session', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    await expect(
      registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() }),
    ).rejects.toThrow('already waiting on an operator request')
  })

  it('refuses an answer from a user who does not own the session', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    const opened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    expect(
      await registry.answer({ requestId: opened.requestId, userId: 'user-2', value: VALUE }),
    ).toEqual({ ok: false, status: 403, reason: 'request' })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Pending,
    )
  })

  it('answers 404 for an id it never heard of and 409 for one another host holds', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    const other = registryOf({ db, clock })
    const opened = await other.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    expect(
      await registry.answer({ requestId: 'oreq_unknown', userId: 'user-1', value: VALUE }),
    ).toEqual({ ok: false, status: 404, reason: 'request' })
    expect(
      await registry.answer({ requestId: opened.requestId, userId: 'user-1', value: VALUE }),
    ).toEqual({ ok: false, status: 409, reason: 'not_held_here' })
  })

  it('cancels a held request and settles the wait with the reason', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock })
    const opened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    expect(await registry.cancel({ requestId: opened.requestId, userId: 'user-1' })).toEqual({
      ok: true,
    })
    expect(await opened.answered).toEqual({ ok: false, reason: 'cancelled' })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Cancelled,
    )
  })
})
