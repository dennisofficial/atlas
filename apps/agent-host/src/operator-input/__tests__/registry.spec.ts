import type { OperatorDeliveryResult } from '@dltech/atlas-host'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { CALL, clockOf, registryOf, seedSession, settle, untilTimer, VALUE } from './fixtures'

const testDb = useTestDatabase()

const okay: OperatorDeliveryResult = { ok: true }
const key = { sessionId: 'ses_1', callId: CALL }

describe('the operator answer registry', () => {
  it('rings the session with a callId-only entry and hands the value to the holder', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const posted: { sessionId: string; kind: string; payload: string }[] = []
    const registry = registryOf({ db, clock: clockOf(), posted })

    const answering = registry.answer({ ...key, userId: 'user-1', value: VALUE })
    await settle()

    expect(posted).toEqual([
      { sessionId: 'ses_1', kind: 'operator-answer', payload: JSON.stringify({ callId: CALL }) },
    ])
    expect(registry.answers.take(key)).toEqual({ ok: true, value: VALUE })
    registry.answers.resolve({ key, result: okay })

    expect(await answering).toEqual({ ok: true })
  })

  it('hands a cancel with no value', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })

    const cancelling = registry.cancel({ ...key, userId: 'user-1' })
    await settle()

    expect(registry.answers.take(key)).toEqual({ ok: false, cancel: true })
    registry.answers.resolve({ key, result: okay })

    expect(await cancelling).toEqual({ ok: true })
  })

  it('drops the value and refuses when the session never wakes', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock, answerTimeoutMs: 120_000 })

    const answering = registry.answer({ ...key, userId: 'user-1', value: VALUE })
    await untilTimer(clock)
    clock.fire(120_000)
    await settle()

    expect(await answering).toEqual({
      ok: false,
      status: 409,
      reason: 'the session did not wake in time; try again',
    })
    expect(registry.answers.take(key)).toBeUndefined()
  })

  it('answers 404 for another user and for a session it never heard of', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })

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

  it('exposes only the answer handoff on the port', () => {
    const { db } = testDb()
    const registry = registryOf({ db, clock: clockOf() })

    expect(Object.keys(registryOf({ db, clock: clockOf() }).answers)).toEqual(['take', 'resolve'])
    expect(registry.answers.take(key)).toBeUndefined()
  })
})
