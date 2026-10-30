import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EUploadState, toThreadId, type SaidUpload } from '@dltech/atlas-core'

import { ApiSaidUploads } from '../said-uploads'

const threadId = toThreadId('thread-1')
const BODY = 'hello world'
const ID = '8d3f0c1e-1111-4222-8333-444455556666'

const upload: SaidUpload = {
  uploadId: ID,
  pathname: `composer-uploads/user/${ID}/note.txt`,
  name: 'note.txt',
  size: BODY.length,
  mediaType: 'text/plain',
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'said-uploads-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function build({
  found = true,
  status = 200,
  body = BODY,
  blobSize = BODY.length,
  fetchFn,
}: {
  found?: boolean
  status?: number
  body?: string
  blobSize?: number
  fetchFn?: typeof fetch
} = {}) {
  const calls = { download: 0, fetch: 0 }
  const uploads = new ApiSaidUploads({
    sessionDirOf: async () => dir,
    download: async () => {
      calls.download += 1
      return found
        ? { found: true, downloadUrl: 'https://blob.test/x', size: blobSize }
        : { found: false }
    },
    fetchFn:
      fetchFn ??
      ((async () => {
        calls.fetch += 1
        return new Response(body, { status })
      }) as unknown as typeof fetch),
  })
  return { uploads, calls }
}

describe('ApiSaidUploads', () => {
  it('downloads once and memoises the placement', async () => {
    const { uploads, calls } = build()
    const first = await uploads.place({ threadId, uploads: [upload] })
    await uploads.place({ threadId, uploads: [upload] })

    const target = join(dir, 'uploads', ID, 'note.txt')
    expect(first.get(ID)).toEqual({ state: EUploadState.Ready, path: target })
    expect(await readFile(target, 'utf8')).toBe(BODY)
    expect(calls).toEqual({ download: 1, fetch: 1 })
  })

  it('leaves no .part file behind', async () => {
    await build().uploads.place({ threadId, uploads: [upload] })

    expect(await readdir(join(dir, 'uploads', ID))).toEqual(['note.txt'])
  })

  it('treats any existing file as ready', async () => {
    await mkdir(join(dir, 'uploads', ID), { recursive: true })
    await writeFile(join(dir, 'uploads', ID, 'note.txt'), 'different size')
    const { uploads, calls } = build()

    const placed = await uploads.place({ threadId, uploads: [upload] })

    expect(placed.get(ID)?.state).toBe(EUploadState.Ready)
    expect(calls).toEqual({ download: 0, fetch: 0 })
  })

  it('skips a file already present at the right size', async () => {
    await mkdir(join(dir, 'uploads', ID), { recursive: true })
    await writeFile(join(dir, 'uploads', ID, 'note.txt'), BODY)
    const { uploads, calls } = build()

    const placed = await uploads.place({ threadId, uploads: [upload] })

    expect(placed.get(ID)?.state).toBe(EUploadState.Ready)
    expect(calls).toEqual({ download: 0, fetch: 0 })
  })

  it('reports Missing when the blob is gone', async () => {
    const { uploads, calls } = build({ found: false })

    const placed = await uploads.place({ threadId, uploads: [upload] })

    expect(placed.get(ID)).toEqual({ state: EUploadState.Missing })
    expect(calls.fetch).toBe(0)
  })

  it('throws on a server error and retries on the next call', async () => {
    const { uploads } = build({ status: 500 })

    await expect(uploads.place({ threadId, uploads: [upload] })).rejects.toThrow(/status 500/)
    await expect(uploads.place({ threadId, uploads: [upload] })).rejects.toThrow(/status 500/)
  })

  it('throws when the byte count is wrong and removes the partial', async () => {
    const { uploads } = build({ body: 'abc' })

    await expect(uploads.place({ threadId, uploads: [upload] })).rejects.toThrow(/expected 11/)
    expect(await readdir(join(dir, 'uploads', ID))).toEqual([])
  })

  it('checks bytes against the size the API reported, not the event', async () => {
    const { uploads } = build({ body: 'abc', blobSize: 3 })

    const placed = await uploads.place({
      threadId,
      uploads: [{ ...upload, size: 999 }],
    })

    expect(placed.get(ID)?.state).toBe(EUploadState.Ready)
  })

  const hostile: Array<[string, Partial<SaidUpload>]> = [
    ['a non-uuid id', { uploadId: '../../etc', pathname: 'composer-uploads/u/../../etc/note.txt' }],
    [
      'a traversing name',
      { name: '../evil.txt', pathname: `composer-uploads/u/${ID}/../evil.txt` },
    ],
    [
      'a name that is not sanitised',
      { name: 'a/b.txt', pathname: `composer-uploads/u/${ID}/a/b.txt` },
    ],
    ['a pathname for another upload', { pathname: 'composer-uploads/u/other/note.txt' }],
  ]
  for (const [label, override] of hostile) {
    it(`reports Missing without touching disk or network for ${label}`, async () => {
      const { uploads, calls } = build()
      const bad = { ...upload, ...override }

      const placed = await uploads.place({ threadId, uploads: [bad] })

      expect(placed.get(bad.uploadId)).toEqual({ state: EUploadState.Missing })
      expect(calls).toEqual({ download: 0, fetch: 0 })
      expect(await readdir(dir)).toEqual([])
    })
  }

  it('aborts an in-flight download and removes the partial', async () => {
    const controller = new AbortController()
    const hanging = ((_url: string, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              init?.signal?.addEventListener('abort', () => stream.error(new Error('aborted')))
              queueMicrotask(() => controller.abort())
            },
          }),
        ),
      )) as unknown as typeof fetch
    const { uploads } = build({ fetchFn: hanging })

    await expect(
      uploads.place({ threadId, uploads: [upload], signal: controller.signal }),
    ).rejects.toThrow()
    expect(await readdir(join(dir, 'uploads', ID))).toEqual([])
  })

  describe('older uploads', () => {
    it('degrade to Missing on a transient error', async () => {
      const { uploads } = build({ status: 500 })

      const placed = await uploads.place({
        threadId,
        uploads: [upload],
        currentUploadIds: new Set(),
      })

      expect(placed.get(ID)).toEqual({ state: EUploadState.Missing })
    })

    it('are retried on the next call rather than remembered as Missing', async () => {
      const { uploads, calls } = build({ status: 500 })
      const args = { threadId, uploads: [upload], currentUploadIds: new Set<string>() }

      await uploads.place(args)
      await uploads.place(args)

      expect(calls.fetch).toBe(2)
    })

    it('still throw when the upload is current', async () => {
      const { uploads } = build({ status: 500 })

      await expect(
        uploads.place({ threadId, uploads: [upload], currentUploadIds: new Set([ID]) }),
      ).rejects.toThrow(/status 500/)
    })
  })
})
