import { beforeEach, describe, expect, it } from 'bun:test'

import { EChangeFileStatus } from '@dltech/atlas-protocol'

import type { ChangedFileWrite, WorktreeChangesWrite } from '../../port'
import type { ConformanceParams } from './conformance'
import { makeHarness, seedGranted, SESSION, T0, type Harness } from './support'

const hashOf = (seed: string): string => seed.repeat(64).slice(0, 64)

const fileOf = (path: string, overrides: Partial<ChangedFileWrite> = {}): ChangedFileWrite => ({
  path,
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions: 1,
  deletions: 2,
  binary: false,
  baseHash: hashOf('a'),
  currentHash: hashOf('b'),
  size: 12,
  ...overrides,
})

const writeOf = (files: readonly ChangedFileWrite[]): WorktreeChangesWrite => ({
  checkoutId: 'checkout-1',
  sessionId: SESSION,
  repo: 'github.com/acme/repo',
  worktreePath: '/workspace/repo',
  base: 'origin/main',
  fingerprint: 'fingerprint-1',
  updatedAt: Date.parse(T0),
  files,
})

export function describeControlPlaneWorktreeChanges(params: ConformanceParams): void {
  describe(`ControlPlane worktree changes (${params.name})`, () => {
    let harness: Harness

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      await seedGranted(harness)
    })

    const write = (files: readonly ChangedFileWrite[], blobs = [{ hash: hashOf('a'), size: 4 }]) =>
      harness.plane.upsertChanges({ sessionId: SESSION, write: writeOf(files), blobs })

    it('reads a checkout back with its files sorted by path', async () => {
      await write([fileOf('src/b.ts'), fileOf('src/a.ts')])
      const [read] = await harness.plane.readChanges({ sessionId: SESSION })
      expect(read?.checkoutId).toBe('checkout-1')
      expect(read?.base).toBe('origin/main')
      expect(read?.updatedAt).toBe(Date.parse(T0))
      expect(read?.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
      expect(read?.files[0]).toEqual(fileOf('src/a.ts'))
    })

    it('reads the checkout rows without their files', async () => {
      await write([fileOf('src/b.ts'), fileOf('src/a.ts')])

      expect(await harness.plane.readChangesSummary({ sessionId: SESSION })).toEqual([
        {
          checkoutId: 'checkout-1',
          sessionId: SESSION,
          repo: 'github.com/acme/repo',
          worktreePath: '/workspace/repo',
          base: 'origin/main',
          fingerprint: 'fingerprint-1',
          updatedAt: Date.parse(T0),
        },
      ])
    })

    it('replaces rows and drops a path that left the manifest', async () => {
      await write([fileOf('src/a.ts'), fileOf('src/b.ts')])
      await write([fileOf('src/a.ts', { additions: 9 })])
      const [read] = await harness.plane.readChanges({ sessionId: SESSION })
      expect(read?.files).toEqual([fileOf('src/a.ts', { additions: 9 })])
    })

    it('inserts each blob row once and reports it present', async () => {
      await write([fileOf('src/a.ts')])
      await write([fileOf('src/a.ts')])
      expect([
        ...(await harness.plane.changeBlobsPresent({ hashes: [hashOf('a'), hashOf('c')] })),
      ]).toEqual([hashOf('a')])
      const referenced = await harness.plane.changeBlobsUnreferenced({
        olderThanMs: 0,
        limit: 10,
      })
      expect(referenced).toEqual([])
    })

    it('reports an old unreferenced blob and forgets it once deleted', async () => {
      const orphan = hashOf('c')
      await write([fileOf('src/a.ts')], [{ hash: orphan, size: 7 }])
      const young = await harness.plane.changeBlobsUnreferenced({ olderThanMs: 60_000, limit: 10 })
      expect(young).toEqual([])
      const rows = await harness.plane.changeBlobsUnreferenced({ olderThanMs: -1, limit: 10 })
      expect(rows.map((row) => row.hash)).toEqual([orphan])
      expect(rows[0]?.size).toBe(7)
      await harness.plane.deleteChangeBlobs({ hashes: [orphan] })
      expect([...(await harness.plane.changeBlobsPresent({ hashes: [orphan] }))]).toEqual([])
    })

    it('announces exactly one change with only the session id', async () => {
      const before = (await params.changes(SESSION)).length
      await write([fileOf('src/a.ts')])
      expect((await params.changes(SESSION)).slice(before)).toEqual([{ sessionId: SESSION }])
    })

    it('reads a file row and refuses a checkout from another session', async () => {
      await write([fileOf('src/a.ts')])
      expect(
        await harness.plane.readChangeFile({
          sessionId: SESSION,
          checkoutId: 'checkout-1',
          path: 'src/a.ts',
        }),
      ).toEqual(fileOf('src/a.ts'))
      expect(
        await harness.plane.readChangeFile({
          sessionId: 'other-session',
          checkoutId: 'checkout-1',
          path: 'src/a.ts',
        }),
      ).toBeUndefined()
      expect(await harness.plane.changesUpdatedAt({ sessionId: SESSION })).toBe(Date.parse(T0))
    })
  })
}
