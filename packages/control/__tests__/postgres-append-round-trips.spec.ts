import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { GENESIS_HASH, SESSION_VIEW_VERSION, type LogHead, type V2Body } from '@dltech/atlas-core'
import { countQueries, useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_CHANGE_CHANNEL, sessionChangeSchema, type SessionChange } from '@dltech/atlas-protocol'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import type { SessionViewRow } from '../src/port'
import { decodeViewState } from '../src/session-view-codec'
import { mint, said, SESSION, T0, THREAD } from '../src/testing/conformance/support'

const testDb = useTestDatabase()

const changeLog = new Map<string, SessionChange[]>()
let listener: pg.Client | undefined

beforeAll(async () => {
  listener = new pg.Client(testDb().url)
  listener.on('notification', (message) => {
    if (message.payload === undefined || message.channel !== PG_CHANGE_CHANNEL) return
    const change = sessionChangeSchema.parse(JSON.parse(message.payload))
    changeLog.set(change.sessionId, [...(changeLog.get(change.sessionId) ?? []), change])
  })
  await listener.connect()
  await listener.query(`LISTEN ${PG_CHANGE_CHANNEL}`)
})

afterAll(async () => {
  await listener?.end()
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150))

const store = (): PostgresControlStore => new PostgresControlStore(testDb().db)

const appendBodies = async (params: {
  plane: ControlPlane
  epoch: number
  bodies: readonly V2Body[]
}): Promise<{ head: LogHead; statements: string[] }> => {
  const head = await params.plane.head({ threadId: THREAD })
  const events = mint({ bodies: params.bodies, epoch: params.epoch, from: head })
  const counter = countQueries()
  const outcome = await params.plane.append({ threadId: THREAD, epoch: params.epoch, events })
  const statements = counter.stop()
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  return { head: outcome.head, statements }
}

const sealed = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({
    store: store(),
    clock: () => '2026-11-02T12:00:00.000Z',
  })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 9001 })
  await appendBodies({ plane, epoch: lease.epoch, bodies: [said('warm')] })
  return { plane, epoch: lease.epoch }
}

const readView = async (): Promise<SessionViewRow | undefined> =>
  store().transact((tx) => tx.readSessionView(SESSION))

const announcedSince = async (count: number): Promise<SessionChange[]> => {
  await settle()
  return (changeLog.get(SESSION) ?? []).slice(count)
}

const shapeOf = (statements: readonly string[]): string[] =>
  statements.map((statement) => statement.trim().split(/\s+/).slice(0, 2).join(' '))

describe('control append round trips (postgres)', () => {
  it('commits a one draft append in four statements', async () => {
    const { plane, epoch } = await sealed()
    const before = await announcedSince(0)
    const { head, statements } = await appendBodies({ plane, epoch, bodies: [said('one')] })
    console.log(shapeOf(statements).join(' | '))

    expect(statements.length).toBe(4)
    expect(statements[0]).toBe('BEGIN')
    expect(statements[3]).toBe('COMMIT')
    expect(head.seq).toBe(2)
    const appended = await plane.readEvents({
      threadId: THREAD,
      afterSeq: 1,
      limit: 10,
      visible: false,
    })
    expect(appended.events.map((event) => event.seq)).toEqual([2])
    const view = await readView()
    expect(view?.atSeq).toBe(2)
    expect(view?.version).toBe(SESSION_VIEW_VERSION)
    expect(decodeViewState(view?.state ?? '')?.at).toBe(2)
    expect(await announcedSince(before.length)).toEqual([
      { sessionId: SESSION, threadId: THREAD, headSeq: 2 },
    ])
  })

  it('commits a three draft append in the same four statements', async () => {
    const { plane, epoch } = await sealed()
    const before = await announcedSince(0)
    const { head, statements } = await appendBodies({
      plane,
      epoch,
      bodies: [said('a'), said('b'), said('c')],
    })
    console.log(shapeOf(statements).join(' | '))

    expect(statements.length).toBe(4)
    expect(head.seq).toBe(4)
    const appended = await plane.readEvents({
      threadId: THREAD,
      afterSeq: 1,
      limit: 10,
      visible: false,
    })
    expect(appended.events.map((event) => event.seq)).toEqual([2, 3, 4])
    const view = await readView()
    expect(view?.atSeq).toBe(4)
    expect(decodeViewState(view?.state ?? '')?.at).toBe(4)
    expect(await announcedSince(before.length)).toEqual([
      { sessionId: SESSION, threadId: THREAD, headSeq: 4 },
    ])
  })

  it('rolls the whole append back when a hook throws', async () => {
    const plane = new ControlPlane({
      store: store(),
      clock: () => T0,
      appendHooks: [
        {
          name: 'probe',
          appliesTo: () => true,
          handle: async () => {
            throw new Error('hook failed')
          },
        },
      ],
    })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: THREAD,
    })
    const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 9001 })
    const head = await plane.head({ threadId: THREAD })
    const events = mint({ bodies: [said('fails')], epoch, from: head })

    await expect(plane.append({ threadId: THREAD, epoch, events })).rejects.toThrow('hook failed')
    expect((await plane.head({ threadId: THREAD })).seq).toBe(0)
    const reads = await plane.readEvents({
      threadId: THREAD,
      afterSeq: 0,
      limit: 10,
      visible: false,
    })
    expect(reads.events).toEqual([])
    expect(await readView()).toBeUndefined()
  })

  it('refuses an append whose event id another thread already holds', async () => {
    const { plane } = await sealed()
    const second = 'session-2'
    const secondThread = 'thread-2'
    await plane.createSession({
      sessionId: second,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: secondThread,
    })
    const { epoch } = await plane.grant({ sessionId: second, hostId: 9001 })
    await testDb().pool.query(
      `INSERT INTO "public"."Event" ("threadId", "seq", "id", "epoch", "type", "runId", "at",
        "prevHash", "hash", "canonical")
       VALUES ($1, 99, $2, $3, 'user-said', 'run-1', $4, $5, $6, '{}')`,
      [THREAD, `${secondThread}:1`, epoch, T0, GENESIS_HASH, 'planted'],
    )
    const events = mint({
      bodies: [said('clash')],
      epoch,
      threadId: secondThread,
      from: { seq: 0, hash: GENESIS_HASH },
    })

    const outcome = await plane.append({ threadId: secondThread, epoch, events })

    expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'seq-mismatch', expected: 1 } })
    const reads = await plane.readEvents({
      threadId: secondThread,
      afterSeq: 0,
      limit: 10,
      visible: false,
    })
    expect(reads.events).toEqual([])
    expect((await plane.head({ threadId: secondThread })).seq).toBe(0)
  })
})
