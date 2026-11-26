import { describe, expect, it } from 'bun:test'

import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toThreadId } from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import type { ControlTx, RoutineRow } from '../src/port'

const SPAWNER = 'session-spawner'
const PEER = 'session-peer'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-26T10:00:00.000Z'
const CONFLICT = 'duplicate key value violates unique constraint "Session_pkey"'

class RacingStore extends InMemoryControlStore {
  private raced = false
  private armed = false

  constructor() {
    super({ clock: () => AT })
  }

  arm(): void {
    this.armed = true
  }

  override async transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    if (!this.armed || this.raced) return await super.transact(work)
    this.raced = true
    await super.transact(work)
    throw new Error(CONFLICT)
  }
}

class DuplicateRowStore extends InMemoryControlStore {
  constructor() {
    super({ clock: () => AT })
  }

  override async transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return await super.transact(
      async (tx) =>
        await work(
          new Proxy(tx, {
            get: (target, property) => {
              const value = Reflect.get(target, property)
              if (property !== 'insertRoutine') {
                return typeof value === 'function' ? value.bind(target) : value
              }
              return async (row: RoutineRow) => {
                if ((await target.readRoutine(row.routineId)) !== undefined)
                  throw new Error(CONFLICT)
                await (value as (given: RoutineRow) => Promise<void>).call(target, row)
              }
            },
          }),
        ),
    )
  }
}

const busyOf = async (store: InMemoryControlStore, others: readonly string[] = []) => {
  const plane = new ControlPlane({ store, clock: () => AT })
  await plane.createSession({
    sessionId: SPAWNER,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  for (const [index, sessionId] of others.entries()) {
    await plane.createSession({
      sessionId,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: toThreadId(`thread-other-${index}`),
    })
  }
  if (store instanceof RacingStore) store.arm()
  return plane
}

const routineRow = (routineId: string): RoutineRow => ({
  routineId,
  userId: 'user-1',
  projectId: 'project-1',
  name: 'nightly',
  prompt: 'review the diff',
  cron: '0 3 * * *',
  timezone: 'UTC',
  enabled: true,
  modelRef: null,
  modelEffort: null,
  modelFast: null,
  nextRunAt: AT,
  lastRunAt: null,
  lastSessionId: null,
  createdAt: AT,
  updatedAt: AT,
})

describe('a spawn whose target session another host created first', () => {
  it('returns the session the other host made instead of failing on the key', async () => {
    const store = new RacingStore()
    const plane = await busyOf(store)
    const spawned = await plane.spawnPeer({
      spawnerSessionId: SPAWNER,
      sessionId: PEER,
      mainThreadId: 'thread-peer',
      brief: 'read the port',
      clientId: 'client-1',
    })
    expect(spawned).not.toHaveProperty('refused')
    expect(await plane.readSession({ sessionId: PEER })).toMatchObject({
      sessionId: PEER,
      spawnedBySessionId: SPAWNER,
    })
    const briefs = (await plane.readInbox({ sessionId: PEER, afterId: 0, limit: 50 })).filter(
      (entry) => entry.payload.includes('read the port'),
    )
    expect(briefs).toHaveLength(1)
  })

  it('refuses a spawn whose session belongs to another spawner', async () => {
    const plane = await busyOf(new InMemoryControlStore({ clock: () => AT }), ['session-other'])
    await plane.spawnPeer({
      spawnerSessionId: 'session-other',
      sessionId: PEER,
      mainThreadId: 'thread-peer',
      brief: 'read the port',
      clientId: 'client-1',
    })
    const refused = await plane.spawnPeer({
      spawnerSessionId: SPAWNER,
      sessionId: PEER,
      mainThreadId: 'thread-peer',
      brief: 'read the port',
      clientId: 'client-1',
    })
    expect(refused).toEqual({ refused: `the session ${PEER} already exists` })
  })
})

describe('a routine create that another call already made', () => {
  it('returns the routine the other call wrote instead of failing on the key', async () => {
    const store = new RacingStore()
    const plane = await busyOf(store)
    const row = routineRow('routine-1')
    const created = await plane.createRoutine(row)
    expect(created).toEqual(row)
    expect(created.projectId).toBe('project-1')
  })

  it('passes the failure on when the row it found belongs to another project', async () => {
    const plane = await busyOf(new DuplicateRowStore())
    await plane.createRoutine(routineRow('routine-1'))
    const other = { ...routineRow('routine-1'), projectId: 'project-2' }
    await expect(plane.createRoutine(other)).rejects.toThrow(CONFLICT)
  })
})
