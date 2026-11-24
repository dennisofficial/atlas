import { describe, expect, it, mock } from 'bun:test'
import { triggerSdkFake } from './trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { ChangeContentStore, CHANGES_GC_GRACE_MS } = await import('@dltech/atlas-control')
const { FakeChangeContentStore, FakeContextContentStore } = await import(
  '@dltech/atlas-control/testing'
)
const { changesGcDepsOf, CHANGES_GC_CRON, CHANGES_GC_TASK_ID, graceMsOf, runChangesGcTask } =
  await import('../changes/changes-gc')
const { contextFilesGcDepsOf, runContextFilesGcTask } = await import('../changes/context-files-gc')
const { changesGcTask } = await import('../changes/changes-gc.task')

const DAY_MS = 24 * 60 * 60 * 1_000

const s3Env = (overrides: Record<string, string> = {}): Record<string, string | undefined> => ({
  ARTIFACT_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  ARTIFACT_S3_REGION: 'auto',
  ARTIFACT_S3_BUCKET: 'atlas-artifacts',
  ARTIFACT_S3_ACCESS_KEY_ID: 'key',
  ARTIFACT_S3_SECRET_ACCESS_KEY: 'secret',
  ...overrides,
})

describe('changes gc task', () => {
  it('registers under its task id every half hour', () => {
    expect(changesGcTask).toMatchObject({
      id: 'changes-gc',
      cron: { pattern: '*/30 * * * *', window: '0m' },
      retry: { maxAttempts: 2 },
    })
    expect(CHANGES_GC_TASK_ID).toBe('changes-gc')
    expect(CHANGES_GC_CRON).toBe('*/30 * * * *')
  })

  it('delegates one run to runChangesGc over the injected dependencies', async () => {
    const hash = 'a'.repeat(64)
    const content = new FakeChangeContentStore({ clock: () => Date.now() - 8 * DAY_MS })
    await content.put({ hash, bytes: new Uint8Array([1]) })
    const rows = [{ hash, size: 1, createdAt: Date.now() - 8 * DAY_MS }]
    const deleted: string[][] = []

    const summary = await runChangesGcTask({
      store: {
        changeBlobsUnreferenced: async () => rows.splice(0, rows.length),
        changeBlobsPresent: async () => new Set<string>(),
        deleteChangeBlobs: async (params) => {
          deleted.push([...params.hashes])
        },
      },
      content,
    })

    expect(summary).toEqual({ rowsDeleted: 1, objectsDeleted: 1, failures: 0 })
    expect(deleted).toEqual([[hash]])
    expect(await content.read({ hash })).toBeNull()
  })

  it('builds the worker dependencies from the process env', () => {
    const deps = changesGcDepsOf(s3Env({ CHANGES_GC_GRACE_MS: '60000' }))

    expect(typeof deps.store.deleteChangeBlobs).toBe('function')
    expect(typeof deps.store.changeBlobsUnreferenced).toBe('function')
    expect(deps.content).toBeInstanceOf(ChangeContentStore)
    expect(deps.graceMs).toBe(60_000)
    expect(CHANGES_GC_GRACE_MS).toBe(7 * DAY_MS)
  })

  it('leaves the grace period to the core default when the tier omits it', () => {
    expect(changesGcDepsOf(s3Env()).graceMs).toBeUndefined()
    expect(graceMsOf({ CHANGES_GC_GRACE_MS: '' })).toBeUndefined()
    expect(graceMsOf({ CHANGES_GC_GRACE_MS: '0' })).toBe(0)
  })

  it('refuses a grace period that is not a number', () => {
    expect(() => graceMsOf({ CHANGES_GC_GRACE_MS: 'soon' })).toThrow(
      'CHANGES_GC_GRACE_MS must be a number, got soon',
    )
  })

  it('deletes context content that no index row references', async () => {
    const hash = 'b'.repeat(64)
    const content = new FakeContextContentStore({ clock: () => Date.now() - 8 * DAY_MS })
    await content.put({ hash, bytes: new Uint8Array([2]) })
    const asked: string[][] = []

    const summary = await runContextFilesGcTask({
      store: {
        contextDigestsReferenced: async (params) => {
          asked.push([...params.digests])
          return new Set<string>()
        },
        removeContextBytesIfUnreferenced: async (params) => {
          await params.content.removing([params.digest])
          return true
        },
      },
      content,
    })

    expect(summary).toEqual({ objectsDeleted: 1, failures: 0 })
    expect(asked).toEqual([[hash]])
    expect(await content.read({ hash })).toBeNull()
  })

  it('builds the context worker dependencies under the context prefix', () => {
    const deps = contextFilesGcDepsOf(s3Env({ CHANGES_GC_GRACE_MS: '0' }))

    expect(typeof deps.store.contextDigestsReferenced).toBe('function')
    expect(typeof deps.content.list).toBe('function')
    expect(deps.graceMs).toBe(0)
  })

  it('reports missing context storage when the tier has no bucket', async () => {
    const deps = contextFilesGcDepsOf({})
    await expect(deps.content.list()).rejects.toThrow('change storage is missing CHANGES_S3_BUCKET')
  })

  it('reports missing change storage when the tier has no bucket', async () => {
    const deps = changesGcDepsOf({})
    await expect(deps.content.list()).rejects.toThrow('change storage is missing CHANGES_S3_BUCKET')
  })
})
