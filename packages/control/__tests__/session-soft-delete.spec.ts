import { expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore, softDeleteArchivedSessionsIn } from '../src/postgres'
import { createSessionParams } from '../src/testing/conformance/support'

const testDb = useTestDatabase()

const GRACE_MS = 24 * 60 * 60 * 1_000
const NOW = new Date('2026-11-03T12:00:00.000Z')
const CUTOFF = new Date(NOW.getTime() - GRACE_MS)
const hoursBefore = (hours: number): Date => new Date(NOW.getTime() - hours * 60 * 60 * 1_000)

const planeOf = (): ControlPlane =>
  new ControlPlane({ store: new PostgresControlStore(testDb().db) })

const seedSessions = async (ids: readonly string[]): Promise<void> => {
  const plane = planeOf()
  for (const id of ids) {
    await plane.createSession(createSessionParams({ sessionId: id, mainThreadId: `thr-${id}` }))
  }
}

const setArchived = async (args: {
  ids: readonly string[]
  archivedAt: Date
  deletedAt?: Date | undefined
}): Promise<void> => {
  await testDb()
    .db.orm.v2.V2Session.where((session) => session.id.in([...args.ids]))
    .updateAndCount({
      archivedAt: args.archivedAt,
      ...(args.deletedAt === undefined ? {} : { deletedAt: args.deletedAt }),
    })
}

const deletedAtOf = async (sessionId: string): Promise<Date | null> =>
  (await testDb().db.orm.v2.V2Session.where({ id: sessionId }).select('deletedAt').first())
    ?.deletedAt ?? null

it('surfaces deletedAt and keeps a soft-deleted session out of every listing', async () => {
  await seedSessions(['kept', 'gone'])
  const plane = planeOf()
  await setArchived({ ids: ['gone'], archivedAt: hoursBefore(30), deletedAt: NOW })

  expect((await plane.readSession({ sessionId: 'gone' }))?.deletedAt).toBe(NOW.toISOString())
  expect((await plane.readSession({ sessionId: 'kept' }))?.deletedAt).toBeNull()
  expect(
    (await plane.listSessions({ userId: 'user-1', limit: 10 })).map((row) => row.sessionId),
  ).toEqual(['kept'])
  expect(
    (await plane.listSessionDigests({ userId: 'user-1', limit: 10 })).map((row) => row.sessionId),
  ).toEqual(['kept'])
})

it('soft-deletes only the sessions archived past the cutoff and not deleted yet', async () => {
  await seedSessions(['old', 'fresh', 'already'])
  await setArchived({ ids: ['old'], archivedAt: hoursBefore(30) })
  await setArchived({ ids: ['fresh'], archivedAt: hoursBefore(1) })
  await setArchived({ ids: ['already'], archivedAt: hoursBefore(30), deletedAt: CUTOFF })

  const softDeleted = await testDb().db.transaction((tx) =>
    softDeleteArchivedSessionsIn({ tx, cutoff: CUTOFF, at: NOW }),
  )

  expect(softDeleted).toBe(1)
  expect(await deletedAtOf('old')).toEqual(NOW)
  expect(await deletedAtOf('fresh')).toBeNull()
  expect(await deletedAtOf('already')).toEqual(CUTOFF)
})

it('skips an archived session while a teammate on its pod is still unarchived', async () => {
  await seedSessions(['lead', 'teammate', 'solo'])
  await testDb().db.orm.v2.V2Session.where({ id: 'teammate' }).updateAndCount({
    podSessionId: 'lead',
  })
  await setArchived({ ids: ['lead', 'solo'], archivedAt: hoursBefore(30) })

  const softDeleted = await testDb().db.transaction((tx) =>
    softDeleteArchivedSessionsIn({ tx, cutoff: CUTOFF, at: NOW }),
  )

  expect(softDeleted).toBe(1)
  expect(await deletedAtOf('lead')).toBeNull()
  expect(await deletedAtOf('solo')).toEqual(NOW)
})

it('skips an archived teammate while the session that owns its pod is unarchived', async () => {
  await seedSessions(['root', 'peer'])
  await testDb().db.orm.v2.V2Session.where({ id: 'peer' }).updateAndCount({
    podSessionId: 'root',
  })
  await setArchived({ ids: ['peer'], archivedAt: hoursBefore(30) })

  const softDeleted = await testDb().db.transaction((tx) =>
    softDeleteArchivedSessionsIn({ tx, cutoff: CUTOFF, at: NOW }),
  )

  expect(softDeleted).toBe(0)
  expect(await deletedAtOf('peer')).toBeNull()
})

it('leaves an unarchived session alone whatever its age', async () => {
  await seedSessions(['live'])

  const softDeleted = await testDb().db.transaction((tx) =>
    softDeleteArchivedSessionsIn({ tx, cutoff: CUTOFF, at: NOW }),
  )

  expect(softDeleted).toBe(0)
  expect(await deletedAtOf('live')).toBeNull()
})
