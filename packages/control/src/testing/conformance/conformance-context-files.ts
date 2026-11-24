import { beforeEach, describe, expect, it } from 'bun:test'

import { EContextFileKind } from '@dltech/atlas-core'

import type { ContextFileRow, ContextFileWrite } from '../../context-files'
import { FakeContextContentStore } from '../fake-context-content'
import type { ConformanceParams } from './conformance'
import { makeHarness, seedGranted, SESSION, T0, type Harness } from './support'

const OTHER_SESSION = 'session-2'

const BYTES = new Uint8Array([1, 2, 3])

const withoutStamp = (
  row: ContextFileRow | null | undefined,
): Omit<ContextFileRow, 'updatedAt'> | null | undefined => {
  if (row === null || row === undefined) return row
  const { updatedAt: _updatedAt, ...rest } = row
  return rest
}

const fileOf = (path: string, overrides: Partial<ContextFileWrite> = {}): ContextFileWrite => ({
  path,
  digest: 'a'.repeat(64),
  size: 12,
  mime: 'text/markdown',
  kind: EContextFileKind.Text,
  mtimeMs: Date.parse(T0),
  ...overrides,
})

export function describeControlPlaneContextFiles(params: ConformanceParams): void {
  describe(`ControlPlane context files (${params.name})`, () => {
    let harness: Harness

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      await seedGranted(harness)
    })

    const write = (files: readonly ContextFileWrite[], sessionId = SESSION) =>
      harness.plane.upsertContextFiles({ sessionId, files })

    it('reads the mirrored files back sorted by path', async () => {
      await write([fileOf('z/last.txt'), fileOf('a/first.md')])
      const rows = await harness.plane.listContextFiles({ sessionId: SESSION })
      expect(rows.map((row) => row.path)).toEqual(['a/first.md', 'z/last.txt'])
      expect(withoutStamp(rows[0])).toEqual(fileOf('a/first.md'))
      expect(rows[0]?.updatedAt).toBeGreaterThan(0)
    })

    it('upserts a known path in place and keeps the other rows', async () => {
      await write([fileOf('a/first.md'), fileOf('b/second.md')])
      const next = fileOf('a/first.md', {
        digest: 'b'.repeat(64),
        size: 40,
        mime: 'image/png',
        kind: EContextFileKind.Image,
        mtimeMs: 99,
      })
      await write([next])
      const rows = await harness.plane.listContextFiles({ sessionId: SESSION })
      expect(rows.map(withoutStamp)).toEqual([next, fileOf('b/second.md')])
    })

    it('keeps a path that is not stored yet with a null digest', async () => {
      await write([fileOf('huge.bin', { digest: null, size: 20_000_000 })])
      const [row] = await harness.plane.listContextFiles({ sessionId: SESSION })
      expect(row?.digest).toBeNull()
      expect(row?.size).toBe(20_000_000)
    })

    it('removes only the named paths', async () => {
      await write([fileOf('a/first.md'), fileOf('b/second.md')])
      await harness.plane.removeContextFiles({ sessionId: SESSION, paths: ['a/first.md'] })
      expect(
        (await harness.plane.listContextFiles({ sessionId: SESSION })).map((r) => r.path),
      ).toEqual(['b/second.md'])
    })

    it('leaves the store alone when there are no paths to remove', async () => {
      await write([fileOf('a/first.md')])
      await harness.plane.removeContextFiles({ sessionId: SESSION, paths: [] })
      expect(await harness.plane.listContextFiles({ sessionId: SESSION })).toHaveLength(1)
    })

    it('reads one file by path and answers null for a path it never mirrored', async () => {
      await write([fileOf('a/first.md')])
      expect(
        withoutStamp(await harness.plane.contextFileOf({ sessionId: SESSION, path: 'a/first.md' })),
      ).toEqual(fileOf('a/first.md'))
      expect(
        await harness.plane.contextFileOf({ sessionId: SESSION, path: 'a/missing.md' }),
      ).toBeNull()
    })

    it('keeps two sessions apart', async () => {
      await harness.plane.createSession({
        sessionId: OTHER_SESSION,
        userId: 'user-1',
        projectId: 'project-1',
        mainThreadId: 'thread-2',
      })
      await write([fileOf('a/first.md')])
      await write([fileOf('a/first.md', { digest: 'c'.repeat(64) })], OTHER_SESSION)
      expect(
        (await harness.plane.listContextFiles({ sessionId: SESSION })).map((row) => row.digest),
      ).toEqual(['a'.repeat(64)])
      expect(
        (await harness.plane.listContextFiles({ sessionId: OTHER_SESSION })).map(
          (row) => row.digest,
        ),
      ).toEqual(['c'.repeat(64)])
    })

    it('names the digests an index row still references and skips null digests', async () => {
      await harness.plane.createSession({
        sessionId: OTHER_SESSION,
        userId: 'user-1',
        projectId: 'project-1',
        mainThreadId: 'thread-2',
      })
      await write([
        fileOf('a/first.md', { digest: 'a'.repeat(64) }),
        fileOf('huge.bin', { digest: null }),
      ])
      await write([fileOf('b/second.md', { digest: 'b'.repeat(64) })], OTHER_SESSION)
      const referenced = await harness.plane.contextDigestsReferenced({
        digests: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
      })
      expect([...referenced].sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    })

    it('answers an empty set when asked about no digests', async () => {
      await write([fileOf('a/first.md')])
      expect([...(await harness.plane.contextDigestsReferenced({ digests: [] }))]).toEqual([])
    })

    it('writes the row of a digest the store already holds', async () => {
      const content = new FakeContextContentStore()
      const digest = FakeContextContentStore.hashOf(BYTES)
      await content.put({ hash: digest, bytes: BYTES })
      const write = fileOf('a/first.md', { digest })
      expect(
        await harness.plane.commitContextFile({ sessionId: SESSION, write, content }),
      ).toBeTrue()
      expect(
        withoutStamp(await harness.plane.contextFileOf({ sessionId: SESSION, path: write.path })),
      ).toEqual(write)
    })

    it('writes a row that reuses bytes another row already points at', async () => {
      const content = new FakeContextContentStore()
      const digest = FakeContextContentStore.hashOf(BYTES)
      await content.put({ hash: digest, bytes: BYTES })
      await write([fileOf('a/first.md', { digest })])
      const committed = await harness.plane.commitContextFile({
        sessionId: SESSION,
        write: fileOf('b/second.md', { digest }),
        content,
      })
      expect(committed).toBeTrue()
      expect(content.puts).toEqual([digest])
      expect(
        (await harness.plane.listContextFiles({ sessionId: SESSION })).map((row) => row.digest),
      ).toEqual([digest, digest])
    })

    it('skips the row of a digest the store does not hold', async () => {
      const content = new FakeContextContentStore()
      const write = fileOf('a/first.md', { digest: FakeContextContentStore.hashOf(BYTES) })
      const committed = await harness.plane.commitContextFile({
        sessionId: SESSION,
        write,
        content,
      })
      expect(committed).toBeFalse()
      expect(await harness.plane.listContextFiles({ sessionId: SESSION })).toEqual([])
    })

    it('writes the row of a file that is not stored yet with a null digest', async () => {
      const content = new FakeContextContentStore()
      const write = fileOf('huge.bin', { digest: null, size: 20_000_000 })
      expect(
        await harness.plane.commitContextFile({ sessionId: SESSION, write, content }),
      ).toBeTrue()
      expect(
        (await harness.plane.listContextFiles({ sessionId: SESSION })).map(withoutStamp),
      ).toEqual([write])
      expect(content.puts).toEqual([])
    })

    it('removes the bytes of a digest no row uses and reports it', async () => {
      const content = new FakeContextContentStore()
      const digest = FakeContextContentStore.hashOf(BYTES)
      await content.put({ hash: digest, bytes: BYTES })
      expect(await harness.plane.removeContextBytesIfUnreferenced({ digest, content })).toBeTrue()
      expect(await content.read({ hash: digest })).toBeNull()
    })

    it('keeps the bytes of a digest a row still uses and reports it', async () => {
      const content = new FakeContextContentStore()
      const digest = FakeContextContentStore.hashOf(BYTES)
      await content.put({ hash: digest, bytes: BYTES })
      await write([fileOf('a/first.md', { digest })])
      expect(await harness.plane.removeContextBytesIfUnreferenced({ digest, content })).toBeFalse()
      expect(await content.read({ hash: digest })).toEqual(BYTES)
    })
  })
}
