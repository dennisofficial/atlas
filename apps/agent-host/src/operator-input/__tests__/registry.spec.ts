import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { CALL, registryOf, seedSession, VALUE } from './fixtures'

const testDb = useTestDatabase()

const key = { sessionId: 'ses_1', callId: CALL }

describe('the operator answers', () => {
  it('stores the value in the inbox entry and returns without waiting', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const posted: { sessionId: string; kind: string; payload: string }[] = []
    const registry = registryOf({ db, posted })

    expect(await registry.answer({ ...key, userId: 'user-1', value: VALUE })).toEqual({ ok: true })
    expect(posted).toEqual([
      {
        sessionId: 'ses_1',
        kind: 'operator-answer',
        payload: JSON.stringify({ callId: CALL, value: VALUE }),
      },
    ])
  })

  it('stores a cancel with no value', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const posted: { sessionId: string; kind: string; payload: string }[] = []

    expect(await registryOf({ db, posted }).cancel({ ...key, userId: 'user-1' })).toEqual({
      ok: true,
    })
    expect(posted[0]?.payload).toBe(JSON.stringify({ callId: CALL, cancel: true }))
  })

  it('answers 404 for another user and for a session it never heard of', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db })

    expect(await registry.answer({ ...key, userId: 'user-2', value: VALUE })).toEqual({
      ok: false,
      status: 404,
      reason: 'session',
    })
    expect(
      await registry.answer({
        sessionId: 'ses_unknown',
        callId: CALL,
        userId: 'user-1',
        value: VALUE,
      }),
    ).toEqual({ ok: false, status: 404, reason: 'session' })
  })
})
