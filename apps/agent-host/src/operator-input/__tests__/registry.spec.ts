import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { EOperatorRequestOutcome } from '@dltech/atlas-plugin-operator/core'
import type { OperatorDeliveryResult } from '@dltech/atlas-host'
import { EOperatorRequestStatus } from '..'
import {
  askOf,
  clockOf,
  NOW_MS,
  registryOf,
  seedSession,
  settle,
  untilTimer,
  VALUE,
} from './fixtures'

const testDb = useTestDatabase()

const okay: OperatorDeliveryResult = { ok: true }

describe('the operator request registry', () => {
  it('writes a pending row with the question and no deadline', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })

    const opened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf('shell'),
    })

    expect(opened).toEqual({ requestId: opened.requestId })
    const row = await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId })
    expect(row).toMatchObject({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      kind: 'shell',
      prompt: 'the login code',
      secret: true,
      shellId: 'shl_1',
      status: EOperatorRequestStatus.Pending,
      resolvedAt: null,
    })
  })

  it('rings the session with a requestId-only entry and leaves settling to the holder', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const posted: { sessionId: string; kind: string; payload: string }[] = []
    const registry = registryOf({ db, clock: clockOf(), posted })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    const answering = registry.answer({
      requestId: opened.requestId,
      userId: 'user-1',
      value: VALUE,
    })
    await settle()

    expect(posted).toEqual([
      {
        sessionId: 'ses_1',
        kind: 'operator-answer',
        payload: JSON.stringify({ requestId: opened.requestId }),
      },
    ])
    expect(registry.answers.take(opened.requestId)).toEqual({ ok: true, value: VALUE })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Pending,
    )

    await registry.settle({
      requestId: opened.requestId,
      outcome: EOperatorRequestOutcome.Delivered,
    })
    registry.answers.resolve({ requestId: opened.requestId, result: okay })

    expect(await answering).toEqual({ ok: true })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Answered,
    )
  })

  it('opens a new request after the holder settled the previous one cancelled', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    await registry.settle({
      requestId: opened.requestId,
      outcome: EOperatorRequestOutcome.Cancelled,
    })
    const reopened = await registry.open({
      sessionId: 'ses_1',
      threadId: 'thr_ses_1',
      ask: askOf(),
    })

    expect(reopened.requestId).not.toBe(opened.requestId)
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Cancelled,
    )
  })

  it('drops the value and refuses when the session never wakes', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const clock = clockOf()
    const registry = registryOf({ db, clock, answerTimeoutMs: 120_000 })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    const answering = registry.answer({
      requestId: opened.requestId,
      userId: 'user-1',
      value: VALUE,
    })
    await untilTimer(clock)
    clock.fire(120_000)
    await settle()

    expect(await answering).toEqual({
      ok: false,
      status: 409,
      reason: 'the session did not wake in time; try again',
    })
    expect(registry.answers.take(opened.requestId)).toBeUndefined()
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Pending,
    )
  })

  it('cancels with no value and settles the row cancelled', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    const cancelling = registry.cancel({ requestId: opened.requestId, userId: 'user-1' })
    await settle()

    expect(registry.answers.take(opened.requestId)).toEqual({ ok: false, cancel: true })
    await registry.settle({
      requestId: opened.requestId,
      outcome: EOperatorRequestOutcome.Cancelled,
    })
    registry.answers.resolve({ requestId: opened.requestId, result: okay })

    expect(await cancelling).toEqual({ ok: true })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Cancelled,
    )
  })

  it('refuses a second pending request for the same session', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })
    await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    await expect(
      registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() }),
    ).rejects.toThrow('already waiting on an operator request')
  })

  it('refuses an answer from a user who does not own the session', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })
    const opened = await registry.open({ sessionId: 'ses_1', threadId: 'thr_ses_1', ask: askOf() })

    expect(
      await registry.answer({ requestId: opened.requestId, userId: 'user-2', value: VALUE }),
    ).toEqual({ ok: false, status: 403, reason: 'request' })
    expect((await db.orm.v2.V2OperatorRequest.first({ id: opened.requestId }))?.status).toBe(
      EOperatorRequestStatus.Pending,
    )
  })

  it('answers 404 for an id it never heard of', async () => {
    const { db } = testDb()
    await seedSession(db, { id: 'ses_1', userId: 'user-1' })
    const registry = registryOf({ db, clock: clockOf() })

    expect(
      await registry.answer({ requestId: 'oreq_unknown', userId: 'user-1', value: VALUE }),
    ).toEqual({ ok: false, status: 404, reason: 'request' })
    expect(NOW_MS).toBe(Date.parse('2026-11-12T03:00:00.000Z'))
  })
})
