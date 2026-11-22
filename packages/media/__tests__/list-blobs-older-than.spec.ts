import { describe, expect, it, mock } from 'bun:test'

type BlobPage = {
  blobs: Array<{ pathname: string; uploadedAt: Date }>
  hasMore: boolean
  cursor?: string
}

const pages: BlobPage[] = []
const calls: Array<{ prefix: string; token: string; cursor?: string }> = []

mock.module('@vercel/blob', () => ({
  list: async (args: { prefix: string; token: string; cursor?: string }) => {
    calls.push(args)
    return pages.shift() ?? { blobs: [], hasMore: false }
  },
}))

const { listBlobsOlderThan } = await import('../src/list-blobs-older-than')

const BEFORE = new Date('2026-10-01T00:00:00.000Z')

describe('listBlobsOlderThan', () => {
  it('returns only the pathnames uploaded before the cutoff, across every page', async () => {
    pages.push(
      {
        blobs: [
          { pathname: 'composer-uploads/u/old', uploadedAt: new Date('2026-09-01T00:00:00.000Z') },
          { pathname: 'composer-uploads/u/new', uploadedAt: new Date('2026-10-02T00:00:00.000Z') },
        ],
        hasMore: true,
        cursor: 'page-2',
      },
      {
        blobs: [
          {
            pathname: 'composer-uploads/u/older',
            uploadedAt: new Date('2026-08-01T00:00:00.000Z'),
          },
        ],
        hasMore: false,
      },
    )

    const found = await listBlobsOlderThan({
      token: 'blob-token',
      prefix: 'composer-uploads/',
      before: BEFORE,
    })

    expect(found).toEqual(['composer-uploads/u/old', 'composer-uploads/u/older'])
    expect(calls).toEqual([
      { prefix: 'composer-uploads/', token: 'blob-token' },
      { prefix: 'composer-uploads/', token: 'blob-token', cursor: 'page-2' },
    ])
  })

  it('returns nothing when the store is empty', async () => {
    expect(
      await listBlobsOlderThan({
        token: 'blob-token',
        prefix: 'composer-uploads/',
        before: BEFORE,
      }),
    ).toEqual([])
  })
})
