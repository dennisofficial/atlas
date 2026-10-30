import { describe, expect, it, mock } from 'bun:test'
import { FakeComposerUploadBlobStore } from '../../api/cloud/composer-uploads/composer-uploads.fakes'
import { sweepComposerUploads } from './composer-upload-sweep'

mock.module('@trigger.dev/sdk', () => ({
  schedules: { task: <T>(definition: T): T => definition },
}))

const NOW = new Date('2026-10-30T04:17:00Z')
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000)

describe('sweepComposerUploads', () => {
  it('deletes only uploads older than 30 days, in batches of 100', async () => {
    const store = new FakeComposerUploadBlobStore()
    for (let i = 0; i < 250; i++) {
      store.uploaded.set(`composer-uploads/u/old-${i}/f`, {
        size: 1,
        uploadedAt: daysAgo(31),
      })
    }
    store.uploaded.set('composer-uploads/u/new/f', {
      size: 1,
      uploadedAt: daysAgo(29),
    })
    store.uploaded.set('bundles/u/old.tar.gz', {
      size: 1,
      uploadedAt: daysAgo(90),
    })
    const batches: number[] = []
    const originalDelete = store.delete.bind(store)
    store.delete = async (args) => {
      batches.push(args.pathnames.length)
      await originalDelete(args)
    }

    const result = await sweepComposerUploads({ store, now: () => NOW })

    expect(result).toEqual({ deleted: 250 })
    expect(batches).toEqual([100, 100, 50])
    expect([...store.uploaded.keys()].sort()).toEqual([
      'bundles/u/old.tar.gz',
      'composer-uploads/u/new/f',
    ])
  })

  it('registers the daily schedule', async () => {
    const { composerUploadSweepTask } = await import('./composer-upload-sweep.task')
    expect(composerUploadSweepTask).toMatchObject({
      id: 'composer-upload-sweep',
      cron: '17 4 * * *',
      retry: { maxAttempts: 3 },
    })
  })
})
