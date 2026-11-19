import { expect, it } from 'bun:test'

import { EChangeFileStatus } from '@dltech/atlas-protocol'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { CHANGES_GC_GRACE_MS, type ChangesGcStore, runChangesGc } from '../src/changes-gc'
import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { FakeChangeContentStore } from '../src/testing'
import { createSessionParams } from '../src/testing/conformance/support'

const testDb = useTestDatabase()

const DAY_MS = 24 * 60 * 60 * 1_000
const SESSION = 'session-1'
const CHECKOUT = 'checkout-1'

const hashOf = (seed: string): string => seed.repeat(64).slice(0, 64)

const REFERENCED = hashOf('a')
const CURRENT = hashOf('b')
const ORPHAN = hashOf('c')
const UNROWED = hashOf('d')
const YOUNG = hashOf('e')

const planeOf = (): ControlPlane =>
  new ControlPlane({ store: new PostgresControlStore(testDb().db) })

const seedCheckout = async (blobs: readonly { hash: string; size: number }[]): Promise<void> => {
  const plane = planeOf()
  await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: 'thread-1' }))
  await plane.upsertChanges({
    sessionId: SESSION,
    write: {
      checkoutId: CHECKOUT,
      sessionId: SESSION,
      repo: 'github.com/acme/repo',
      worktreePath: '/workspace/repo',
      base: 'origin/main',
      fingerprint: 'fingerprint-1',
      updatedAt: Date.parse('2026-11-19T09:00:00.000Z'),
      files: [
        {
          path: 'src/a.ts',
          oldPath: null,
          status: EChangeFileStatus.Modified,
          additions: 1,
          deletions: 2,
          binary: false,
          baseHash: REFERENCED,
          currentHash: CURRENT,
          size: 12,
        },
      ],
    },
    blobs,
  })
}

const ageRow = async (hash: string, ageMs: number): Promise<void> => {
  await testDb()
    .db.orm.v2.V2ChangeBlob.where({ hash })
    .updateAndCount({ createdAt: new Date(Date.now() - ageMs) })
}

const agedContent = (ageMs: number): FakeChangeContentStore => {
  const at = Date.now() - ageMs
  return new FakeChangeContentStore({ clock: () => at })
}

class RecordingContent extends FakeChangeContentStore {
  readonly events: string[] = []

  override removing(hashes: readonly string[]): Promise<void> {
    this.events.push('objects')
    return super.removing(hashes)
  }
}

class FailingContent extends FakeChangeContentStore {
  override removing(): Promise<void> {
    return Promise.reject(new Error('change storage refused the delete'))
  }
}

const recordingStore = (inner: ControlPlane, events: string[]): ChangesGcStore => ({
  changeBlobsUnreferenced: (params) => inner.changeBlobsUnreferenced(params),
  changeBlobsPresent: (params) => inner.changeBlobsPresent(params),
  deleteChangeBlobs: async (params) => {
    events.push('rows')
    await inner.deleteChangeBlobs(params)
  },
})

it('keeps a blob a changed file still references', async () => {
  await seedCheckout([{ hash: REFERENCED, size: 4 }])
  await ageRow(REFERENCED, 8 * DAY_MS)
  const content = agedContent(8 * DAY_MS)
  await content.put({ hash: REFERENCED, bytes: new Uint8Array([1, 2, 3, 4]) })

  expect(await runChangesGc({ store: planeOf(), content })).toEqual({
    rowsDeleted: 0,
    objectsDeleted: 0,
    failures: 0,
  })
  expect([...(await planeOf().changeBlobsPresent({ hashes: [REFERENCED] }))]).toEqual([REFERENCED])
  expect(await content.read({ hash: REFERENCED })).not.toBeNull()
})

it('keeps an unreferenced blob younger than the grace', async () => {
  await seedCheckout([{ hash: ORPHAN, size: 7 }])
  const content = agedContent(0)
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([5, 6, 7]) })

  expect(await runChangesGc({ store: planeOf(), content })).toEqual({
    rowsDeleted: 0,
    objectsDeleted: 0,
    failures: 0,
  })
  expect([...(await planeOf().changeBlobsPresent({ hashes: [ORPHAN] }))]).toEqual([ORPHAN])
  expect(await content.read({ hash: ORPHAN })).not.toBeNull()
})

it('deletes an old unreferenced row and then its object, and is safe to re-run', async () => {
  await seedCheckout([{ hash: ORPHAN, size: 7 }])
  await ageRow(ORPHAN, 8 * DAY_MS)
  const content = new RecordingContent({ clock: () => Date.now() - 8 * DAY_MS })
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([5, 6, 7]) })
  const events: string[] = []
  const store = recordingStore(planeOf(), events)

  expect(await runChangesGc({ store, content })).toEqual({
    rowsDeleted: 1,
    objectsDeleted: 1,
    failures: 0,
  })
  expect([...events, ...content.events]).toEqual(['rows', 'objects'])
  expect([...(await planeOf().changeBlobsPresent({ hashes: [ORPHAN] }))]).toEqual([])
  expect(await content.read({ hash: ORPHAN })).toBeNull()
  expect(await runChangesGc({ store, content })).toEqual({
    rowsDeleted: 0,
    objectsDeleted: 0,
    failures: 0,
  })
})

it('counts a failed object delete instead of throwing', async () => {
  await seedCheckout([{ hash: ORPHAN, size: 7 }])
  await ageRow(ORPHAN, 8 * DAY_MS)
  const content = new FailingContent({ clock: () => Date.now() - 8 * DAY_MS })
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([5, 6, 7]) })

  expect(await runChangesGc({ store: planeOf(), content })).toEqual({
    rowsDeleted: 1,
    objectsDeleted: 0,
    failures: 1,
  })
  expect([...(await planeOf().changeBlobsPresent({ hashes: [ORPHAN] }))]).toEqual([])
})

it('deletes an object with no row once it is past the grace', async () => {
  let at = Date.now() - 8 * DAY_MS
  const content = new FakeChangeContentStore({ clock: () => at })
  await content.put({ hash: UNROWED, bytes: new Uint8Array([8]) })
  at = Date.now()
  await content.put({ hash: YOUNG, bytes: new Uint8Array([9]) })

  expect(await runChangesGc({ store: planeOf(), content })).toEqual({
    rowsDeleted: 0,
    objectsDeleted: 1,
    failures: 0,
  })
  expect(await content.read({ hash: UNROWED })).toBeNull()
  expect(await content.read({ hash: YOUNG })).not.toBeNull()
})

it('keeps unreferenced content for a week by default', () => {
  expect(CHANGES_GC_GRACE_MS).toBe(7 * DAY_MS)
})
