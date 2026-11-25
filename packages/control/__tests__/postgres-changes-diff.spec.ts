import { beforeEach, expect, it } from 'bun:test'

import { countQueries, useTestDatabase } from '@dltech/atlas-db/testing'
import { EChangeFileStatus } from '@dltech/atlas-protocol'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import type { ChangedFileWrite, WorktreeChangesWrite } from '../src/port'
import { createSessionParams } from '../src/testing/conformance/support'

const testDb = useTestDatabase()

const SESSION = 'session-changes-diff'
const UPDATED_AT = Date.parse('2026-11-23T09:00:00.000Z')
const hashOf = (seed: string): string => seed.repeat(64).slice(0, 64)

const FILE_WRITE = /(insert into|delete from|update) "?public"?\."?WorktreeChangedFile/i

const planeOf = (): ControlPlane =>
  new ControlPlane({ store: new PostgresControlStore(testDb().db) })

beforeEach(async () => {
  await planeOf().createSession(
    createSessionParams({ sessionId: SESSION, mainThreadId: 'thread-1' }),
  )
})

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

const writeFiles = (params: {
  checkoutId: string
  files: readonly ChangedFileWrite[]
  fingerprint?: string
}): Promise<void> => {
  const write: WorktreeChangesWrite = {
    checkoutId: params.checkoutId,
    sessionId: SESSION,
    repo: 'github.com/acme/repo',
    worktreePath: '/workspace/repo',
    base: 'origin/main',
    fingerprint: params.fingerprint ?? 'fingerprint-1',
    updatedAt: UPDATED_AT,
    files: params.files,
  }
  return planeOf().upsertChanges({
    sessionId: SESSION,
    write,
    blobs: [{ hash: hashOf('a'), size: 4 }],
  })
}

const fileWriteStatementsDuring = async (work: () => Promise<void>): Promise<string[]> => {
  const counter = countQueries()
  try {
    await work()
  } finally {
    counter.stop()
  }
  return counter.statements.filter((statement) => FILE_WRITE.test(statement))
}

const filesOf = async (checkoutId: string): Promise<readonly ChangedFileWrite[]> => {
  const reads = await planeOf().readChanges({ sessionId: SESSION })
  return reads.find((read) => read.checkoutId === checkoutId)?.files ?? []
}

it('leaves the same rows as a fresh write after adds, edits, a rename and a removal', async () => {
  await writeFiles({
    checkoutId: 'checkout-diff',
    files: [
      fileOf('src/a.ts'),
      fileOf('src/b.ts'),
      fileOf('src/c.ts', { status: EChangeFileStatus.Added, baseHash: null }),
    ],
  })
  await writeFiles({
    checkoutId: 'checkout-diff',
    files: [
      fileOf('src/a.ts', { additions: 9, currentHash: hashOf('d') }),
      fileOf('src/b.ts', { deletions: 5 }),
      fileOf('src/c.ts', { status: EChangeFileStatus.Added, baseHash: null }),
    ],
  })
  const final = [
    fileOf('src/a.ts', { additions: 9, currentHash: hashOf('d') }),
    fileOf('src/c.ts', { status: EChangeFileStatus.Added, baseHash: null }),
    fileOf('src/d.ts', {
      oldPath: 'src/b.ts',
      status: EChangeFileStatus.Added,
      additions: 4,
      size: 44,
    }),
  ]
  await writeFiles({ checkoutId: 'checkout-diff', files: final })
  await writeFiles({ checkoutId: 'checkout-fresh', files: final })

  expect(await filesOf('checkout-diff')).toEqual(await filesOf('checkout-fresh'))
  expect((await filesOf('checkout-diff')).map((file) => file.path)).toEqual([
    'src/a.ts',
    'src/c.ts',
    'src/d.ts',
  ])
})

it('removes a path that left the manifest with one delete statement', async () => {
  await writeFiles({
    checkoutId: 'checkout-remove',
    files: [fileOf('src/a.ts'), fileOf('src/b.ts')],
  })
  const statements = await fileWriteStatementsDuring(() =>
    writeFiles({ checkoutId: 'checkout-remove', files: [fileOf('src/a.ts')] }),
  )
  expect(statements).toHaveLength(1)
  expect(statements[0]).toMatch(/^DELETE/i)
  expect((await filesOf('checkout-remove')).map((file) => file.path)).toEqual(['src/a.ts'])
})

it('issues no file writes when the manifest and the fingerprint are unchanged', async () => {
  const files = [fileOf('src/a.ts'), fileOf('src/b.ts', { status: EChangeFileStatus.Added })]
  await writeFiles({ checkoutId: 'checkout-same', files })
  expect(
    await fileWriteStatementsDuring(() => writeFiles({ checkoutId: 'checkout-same', files })),
  ).toEqual([])
  expect(
    await fileWriteStatementsDuring(() =>
      writeFiles({ checkoutId: 'checkout-same', files, fingerprint: 'fingerprint-2' }),
    ),
  ).toEqual([])
  expect(await filesOf('checkout-same')).toEqual(
    [...files].sort((left, right) => left.path.localeCompare(right.path)),
  )
})
