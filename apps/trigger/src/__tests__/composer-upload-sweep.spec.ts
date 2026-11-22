import { describe, expect, it, mock } from 'bun:test'
import { triggerSdkFake } from './trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

import type { ComposerUploadSweepStore } from '../trigger/composer-uploads/composer-upload-sweep'

const { COMPOSER_UPLOAD_MAX_AGE_MS, composerUploadSweepStoreOf, sweepComposerUploads } =
  await import('../trigger/composer-uploads/composer-upload-sweep')
const { composerUploadSweepTask } = await import(
  '../trigger/composer-uploads/composer-upload-sweep.task'
)

const NOW = new Date('2026-10-30T04:17:00Z')

class FakeSweepStore implements ComposerUploadSweepStore {
  readonly uploads = new Map<string, Date>()
  readonly batches: number[] = []
  readonly reads: Array<{ prefix: string; before: Date }> = []

  async listOlderThan(args: { prefix: string; before: Date }): Promise<string[]> {
    this.reads.push(args)
    return [...this.uploads]
      .filter(([pathname, at]) => pathname.startsWith(args.prefix) && at < args.before)
      .map(([pathname]) => pathname)
  }

  async delete(args: { pathnames: string[] }): Promise<void> {
    this.batches.push(args.pathnames.length)
    for (const pathname of args.pathnames) this.uploads.delete(pathname)
  }
}

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000)

describe('sweepComposerUploads', () => {
  it('deletes only composer uploads older than 30 days, in batches of 100', async () => {
    const store = new FakeSweepStore()
    for (let i = 0; i < 250; i++) {
      store.uploads.set(`composer-uploads/u/old-${i}/f`, daysAgo(31))
    }
    store.uploads.set('composer-uploads/u/new/f', daysAgo(29))
    store.uploads.set('bundles/u/old.tar.gz', daysAgo(90))

    const result = await sweepComposerUploads({ store, now: () => NOW })

    expect(result).toEqual({ deleted: 250 })
    expect(store.batches).toEqual([100, 100, 50])
    expect([...store.uploads.keys()].sort()).toEqual([
      'bundles/u/old.tar.gz',
      'composer-uploads/u/new/f',
    ])
  })

  it('lists the composer prefix up to the 30 day cutoff', async () => {
    const store = new FakeSweepStore()

    await sweepComposerUploads({ store, now: () => NOW })

    expect(COMPOSER_UPLOAD_MAX_AGE_MS).toBe(30 * 86_400_000)
    expect(store.reads).toEqual([
      { prefix: 'composer-uploads/', before: new Date(NOW.getTime() - 30 * 86_400_000) },
    ])
  })

  it('registers the daily schedule', () => {
    expect(composerUploadSweepTask).toMatchObject({
      id: 'composer-upload-sweep',
      cron: '17 4 * * *',
      retry: { maxAttempts: 3 },
    })
  })
})

describe('composerUploadSweepStoreOf', () => {
  it('refuses to build a store without a blob token', () => {
    expect(() => composerUploadSweepStoreOf({})).toThrow('upload storage is not configured')
  })

  it('builds a store that lists and deletes through the tier token', async () => {
    const store = composerUploadSweepStoreOf({ BLOB_READ_WRITE_TOKEN: 'blob-token' })

    await store.delete({ pathnames: [] })

    expect(typeof store.listOlderThan).toBe('function')
  })
})
