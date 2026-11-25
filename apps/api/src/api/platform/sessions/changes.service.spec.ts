import { describe, expect, it } from 'bun:test'
import { NotFoundException } from '@nestjs/common'
import type { ControlPlane, ChangedFileWrite, WorktreeChangesRead } from '@dltech/atlas-control'
import { FakeChangeContentStore } from '@dltech/atlas-control/testing'
import { EChangeFileStatus, EChangeSide } from '@dltech/atlas-protocol'
import { CHANGE_CONTENT_TTL_MS, ChangesService } from './changes.service'
import type { SessionsService } from './sessions.service'

const HASH_BASE = 'a'.repeat(64)
const HASH_CURRENT = 'b'.repeat(64)

const fileOf = (overrides: Partial<ChangedFileWrite> = {}): ChangedFileWrite => ({
  path: 'src/a.ts',
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions: 2,
  deletions: 1,
  binary: false,
  baseHash: HASH_BASE,
  currentHash: HASH_CURRENT,
  size: 9,
  ...overrides,
})

const checkoutOf = (args: {
  files: readonly ChangedFileWrite[]
  checkoutId?: string
  updatedAt?: number
}): WorktreeChangesRead => ({
  checkoutId: args.checkoutId ?? 'checkout-1',
  sessionId: 'ses-1',
  repo: 'github.com/acme/repo',
  worktreePath: '/workspace/repo',
  base: 'origin/main',
  fingerprint: 'f1',
  updatedAt: args.updatedAt ?? 1_700_000_000_000,
  files: args.files,
})

const owned = (): SessionsService =>
  ({
    requireOwnedSession: async () => {
      throw new NotFoundException('session not found')
    },
  }) as unknown as SessionsService

const allows = (): SessionsService =>
  ({ requireOwnedSession: async () => ({}) }) as unknown as SessionsService

const planeOf = (args: {
  checkouts?: readonly WorktreeChangesRead[]
  file?: ChangedFileWrite | undefined
}): ControlPlane =>
  ({
    readChanges: async () => args.checkouts ?? [],
    readChangeFile: async () => args.file,
  }) as unknown as ControlPlane

const serviceOf = (args: {
  plane: ControlPlane
  sessions: SessionsService
  content?: FakeChangeContentStore
}): ChangesService =>
  new ChangesService(args.plane, args.content ?? new FakeChangeContentStore(), args.sessions)

describe('ChangesService', () => {
  it('refuses a session the user does not own before reading rows', async () => {
    const service = serviceOf({ plane: planeOf({}), sessions: owned() })
    await expect(service.changes({ userId: 'user-a', sessionId: 'ses-1' })).rejects.toThrow(
      NotFoundException,
    )
  })

  it('returns every checkout of the session with its files', async () => {
    const service = serviceOf({
      plane: planeOf({ checkouts: [checkoutOf({ files: [fileOf()] })] }),
      sessions: allows(),
    })
    const output = await service.changes({ userId: 'user-a', sessionId: 'ses-1' })
    expect(output.checkouts).toHaveLength(1)
    expect(output.checkouts[0]?.files).toEqual([fileOf()])
    expect(output.checkouts[0]?.updatedAt).toBe(1_700_000_000_000)
  })

  it('keeps only the newest row for a worktree written under two checkout ids', async () => {
    const service = serviceOf({
      plane: planeOf({
        checkouts: [
          checkoutOf({ checkoutId: 'legacy', files: [fileOf({ path: 'gone.ts' })], updatedAt: 5 }),
          checkoutOf({ checkoutId: 'fresh', files: [fileOf()], updatedAt: 9 }),
        ],
      }),
      sessions: allows(),
    })
    const output = await service.changes({ userId: 'user-a', sessionId: 'ses-1' })
    expect(output.checkouts.map((checkout) => checkout.checkoutId)).toEqual(['fresh'])
    expect(output.checkouts[0]?.files).toEqual([fileOf()])
  })

  it('signs a GET for the requested side and reports its hash', async () => {
    const service = serviceOf({ plane: planeOf({ file: fileOf() }), sessions: allows() })
    const base = await service.content({
      userId: 'user-a',
      sessionId: 'ses-1',
      checkoutId: 'checkout-1',
      path: 'src/a.ts',
      side: EChangeSide.Base,
    })
    expect(base.hash).toBe(HASH_BASE)
    expect(base.url).toContain(HASH_BASE)
    expect(base.validUntil).toBeGreaterThan(Date.now())
    const current = await service.content({
      userId: 'user-a',
      sessionId: 'ses-1',
      checkoutId: 'checkout-1',
      path: 'src/a.ts',
      side: EChangeSide.Current,
    })
    expect(current.hash).toBe(HASH_CURRENT)
    expect(current.size).toBe(9)
    expect(current.validUntil).toBeGreaterThan(Date.now() + CHANGE_CONTENT_TTL_MS - 5_000)
  })

  it('refuses a file row that does not exist and a side with no content', async () => {
    const missing = serviceOf({ plane: planeOf({ file: undefined }), sessions: allows() })
    await expect(
      missing.content({
        userId: 'user-a',
        sessionId: 'ses-1',
        checkoutId: 'checkout-1',
        path: 'gone.ts',
        side: EChangeSide.Current,
      }),
    ).rejects.toThrow(NotFoundException)
    const deleted = serviceOf({
      plane: planeOf({ file: fileOf({ currentHash: null, size: null }) }),
      sessions: allows(),
    })
    await expect(
      deleted.content({
        userId: 'user-a',
        sessionId: 'ses-1',
        checkoutId: 'checkout-1',
        path: 'src/a.ts',
        side: EChangeSide.Current,
      }),
    ).rejects.toThrow(NotFoundException)
  })
})
