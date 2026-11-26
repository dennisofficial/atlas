import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'

import type { Db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import {
  routineCreateOf,
  routineRemoveOf,
  routineRunNowOf,
  routineUpdateOf,
} from '../src/routine-service'

const currentDb = useTestDatabase()

const T0 = new Date('2026-11-19T10:00:00.000Z')

const receipt = { threadId: 'thr-1', stepKey: 'call-1.1' }

const input = {
  projectId: 'prj-1',
  name: 'standup',
  prompt: 'post the standup',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
}

const seedProject = async ({ db }: { db: Db }): Promise<void> => {
  await seedUser({ db, id: 'usr-1' })
  await db.orm.public.Project.create({
    id: 'prj-1',
    name: 'prj-1',
    ownerUserId: 'usr-1',
    createdById: 'usr-1',
    repo: null,
  })
}

const planeOf = (db: Db): ControlPlane => new ControlPlane({ store: new PostgresControlStore(db) })

describe('routine effects keyed by a step receipt', () => {
  afterEach(() => setSystemTime())

  it('creates one routine for a replayed create', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    const plane = planeOf(db)
    setSystemTime(T0)

    const first = await routineCreateOf({ plane, userId: 'usr-1', receipt, input })
    const second = await routineCreateOf({ plane, userId: 'usr-1', receipt, input })

    expect(second).toEqual(first)
    expect(await plane.listRoutines({ userId: 'usr-1', projectId: 'prj-1' })).toHaveLength(1)
  })

  it('leaves the routine alone for a replayed update', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    const plane = planeOf(db)
    setSystemTime(T0)

    const created = await routineCreateOf({ plane, userId: 'usr-1', input })
    const first = await routineUpdateOf({
      plane,
      userId: 'usr-1',
      projectId: 'prj-1',
      receipt,
      input: { routineId: created.routineId, name: 'renamed' },
    })
    setSystemTime(new Date(T0.getTime() + 60_000))
    const second = await routineUpdateOf({
      plane,
      userId: 'usr-1',
      projectId: 'prj-1',
      receipt,
      input: { routineId: created.routineId, name: 'renamed' },
    })

    expect(second).toEqual(first)
    expect(second.name).toBe('renamed')
    expect(second.updatedAt).toBe(first.updatedAt)
  })

  it('reports what the first remove reported, and removes once', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    const plane = planeOf(db)

    const created = await routineCreateOf({ plane, userId: 'usr-1', input })
    const first = await routineRemoveOf({
      plane,
      userId: 'usr-1',
      projectId: 'prj-1',
      routineId: created.routineId,
      receipt,
    })
    const second = await routineRemoveOf({
      plane,
      userId: 'usr-1',
      projectId: 'prj-1',
      routineId: created.routineId,
      receipt,
    })

    expect(first).toEqual({ removed: true })
    expect(second).toEqual({ removed: true })
    expect(await plane.listRoutines({ userId: 'usr-1', projectId: 'prj-1' })).toEqual([])
  })

  it('starts one session for a replayed run', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    const plane = planeOf(db)

    const created = await routineCreateOf({ plane, userId: 'usr-1', input })
    const first = await routineRunNowOf({
      plane,
      userId: 'usr-1',
      projectId: 'prj-1',
      routineId: created.routineId,
      receipt,
    })
    const second = await routineRunNowOf({
      plane,
      userId: 'usr-1',
      projectId: 'prj-1',
      routineId: created.routineId,
      receipt,
    })

    expect(second).toEqual(first)
    expect(await db.orm.public.Session.all()).toHaveLength(1)
  })

  it('returns the completed update receipt after the routine was removed', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    const plane = planeOf(db)
    setSystemTime(T0)

    const created = await routineCreateOf({ plane, userId: 'usr-1', input })
    const call = {
      plane,
      userId: 'usr-1',
      projectId: 'prj-1',
      input: { routineId: created.routineId, name: 'renamed' },
      receipt: { threadId: 'thr-1', stepKey: 'update-after-remove.0' },
    }
    const first = await routineUpdateOf(call)
    await routineRemoveOf({ plane, userId: 'usr-1', routineId: created.routineId })

    expect(await routineUpdateOf(call)).toEqual(first)
  })

  it('returns the completed run receipt after the routine was removed', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    const plane = planeOf(db)
    setSystemTime(T0)

    const created = await routineCreateOf({ plane, userId: 'usr-1', input })
    const call = {
      plane,
      userId: 'usr-1',
      projectId: 'prj-1',
      routineId: created.routineId,
      receipt: { threadId: 'thr-1', stepKey: 'run-after-remove.0' },
    }
    const first = await routineRunNowOf(call)
    await routineRemoveOf({ plane, userId: 'usr-1', routineId: created.routineId })

    expect(await routineRunNowOf(call)).toEqual(first)
  })

  it('leaves a routine in another project alone and reports it as not removed', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    const plane = planeOf(db)

    const created = await routineCreateOf({ plane, userId: 'usr-1', input })
    const removed = await routineRemoveOf({
      plane,
      userId: 'usr-1',
      projectId: 'prj-2',
      routineId: created.routineId,
      receipt,
    })

    expect(removed).toEqual({ removed: false })
    expect(await plane.listRoutines({ userId: 'usr-1', projectId: 'prj-1' })).toHaveLength(1)
  })
})
