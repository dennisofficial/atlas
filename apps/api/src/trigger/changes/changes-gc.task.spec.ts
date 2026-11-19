import { describe, expect, it, mock } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
  schedules: { task: <T>(definition: T): T => definition },
}))

const { ChangeContentStore, CHANGES_GC_GRACE_MS } = await import('@dltech/atlas-control')
const { FakeChangeContentStore } = await import('@dltech/atlas-control/testing')
const { EnvService } = await import('../../_core/config/env/env.service')
const { changesGcDepsOf, changesGcTask, CHANGES_GC_CRON, CHANGES_GC_TASK_ID, runChangesGcTask } =
  await import('./changes-gc.task')

const DAY_MS = 24 * 60 * 60 * 1_000

describe('changes gc task', () => {
  it('registers under its task id every half hour', () => {
    expect(changesGcTask).toMatchObject({
      id: 'changes-gc',
      cron: '*/30 * * * *',
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

  it('builds the worker dependencies from the tier env', () => {
    const env = new EnvService({
      SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      TRIGGER_SECRET_KEY: 'tr_dev_fixture',
      CHANGES_GC_GRACE_MS: 60_000,
    })

    const deps = changesGcDepsOf(env)

    expect(typeof deps.store.deleteChangeBlobs).toBe('function')
    expect(typeof deps.store.changeBlobsUnreferenced).toBe('function')
    expect(deps.content).toBeInstanceOf(ChangeContentStore)
    expect(deps.graceMs).toBe(60_000)
    expect(CHANGES_GC_GRACE_MS).toBe(7 * DAY_MS)
  })
})
