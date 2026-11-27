import { describe, expect, it } from 'bun:test'

import { EUploadState, toThreadId, type SaidMediaFile, type SaidUpload } from '@dltech/atlas-core'

import { SandboxSaidUploads } from '../sandbox-said-uploads'
import type { UploadBlobs } from '../upload-blobs'

const USER = 'user-1'
const HOME = '/atlas/home'
const threadId = toThreadId('thread-1')

const uploadOf = (id: string, name = 'a.sh'): SaidUpload => ({
  uploadId: id,
  pathname: `composer-uploads/${USER}/${id}/${name}`,
  name,
  size: 5,
  mediaType: 'text/plain',
})

const ID_A = '0b9f3c1e-5d2a-4c8e-9a41-7e6d2f8b1a30'
const ID_B = '1c0a4d2f-6e3b-4d9f-8b52-8f7e3a9c2b41'

const urlOf = (pathname: string): string => `https://blob.fake/${pathname}?sig=1`

const setup = (args: { gone?: ReadonlySet<string>; fetchFails?: boolean; blobs?: null } = {}) => {
  const gone = args.gone ?? new Set<string>()
  const log = { fetch: [] as { url: string; path: string; size: number }[] }
  const blobCalls = { ready: 0, urlOf: [] as string[], sizeOf: [] as string[] }
  const blobs: UploadBlobs = {
    ready: async () => {
      blobCalls.ready += 1
    },
    urlOf: async (pathname) => {
      blobCalls.urlOf.push(pathname)
      return urlOf(pathname)
    },
    sizeOf: async (pathname) => {
      blobCalls.sizeOf.push(pathname)
      return gone.has(pathname) ? null : 5
    },
  }
  const files = {
    fetchToFile: async (call: { url: string; path: string; size: number }) => {
      log.fetch.push(call)
      if ([...gone].some((pathname) => call.url === urlOf(pathname))) {
        throw new Error('fetching failed with status 404')
      }
      if (args.fetchFails === true) throw new Error('boom')
    },
  }
  const uploads = new SandboxSaidUploads({
    userId: USER,
    home: HOME,
    files,
    blobs: args.blobs === null ? null : blobs,
  })
  return { uploads, log, blobCalls }
}

const placeOf = async (args: {
  uploads: SandboxSaidUploads
  upload: SaidUpload
  current?: ReadonlySet<string>
}) => {
  const placed = await args.uploads.place({
    threadId,
    uploads: [args.upload],
    ...(args.current === undefined ? {} : { currentFileIds: args.current }),
  })
  return placed.get(args.upload.uploadId)
}

describe('SandboxSaidUploads', () => {
  it('fetches a new upload with a signed url, the absolute path and the posted size', async () => {
    const upload = uploadOf(ID_A)
    const { uploads, log, blobCalls } = setup()
    const path = `${HOME}/uploads/${ID_A}/a.sh`
    expect(await placeOf({ uploads, upload })).toEqual({ state: EUploadState.Ready, path })
    expect(log.fetch).toEqual([{ url: urlOf(upload.pathname), path, size: 5 }])
    expect(blobCalls.ready).toBe(1)
  })

  it('places a file with one sandbox call and no store lookup', async () => {
    const { uploads, log, blobCalls } = setup()
    await placeOf({ uploads, upload: uploadOf(ID_A) })
    expect(log.fetch).toHaveLength(1)
    expect(blobCalls.sizeOf).toEqual([])
  })

  it('asks the pod again on a second place, because it keeps no memory', async () => {
    const upload = uploadOf(ID_A)
    const { uploads, log } = setup()
    await placeOf({ uploads, upload })
    await placeOf({ uploads, upload })
    expect(log.fetch).toHaveLength(2)
  })

  it('marks a foreign or malformed upload missing without any call', async () => {
    const { uploads, log, blobCalls } = setup()
    const foreign = { ...uploadOf(ID_A), pathname: `composer-uploads/other/${ID_A}/a.sh` }
    const malformed = uploadOf('not-a-uuid')
    const traversal = uploadOf(ID_B, '..')
    for (const upload of [foreign, malformed, traversal]) {
      expect(await placeOf({ uploads, upload })).toEqual({ state: EUploadState.Missing })
    }
    expect(log.fetch).toEqual([])
    expect(blobCalls.sizeOf).toEqual([])
  })

  it('marks an upload missing when its blob is gone, current or not', async () => {
    const upload = uploadOf(ID_A)
    const { uploads, blobCalls } = setup({ gone: new Set([upload.pathname]) })
    expect(await placeOf({ uploads, upload, current: new Set([ID_A]) })).toEqual({
      state: EUploadState.Missing,
    })
    expect(await placeOf({ uploads, upload, current: new Set() })).toEqual({
      state: EUploadState.Missing,
    })
    expect(blobCalls.sizeOf).toEqual([upload.pathname, upload.pathname])
  })

  it('marks every upload missing when there is no blob access', async () => {
    const { uploads, log } = setup({ blobs: null })
    expect(await placeOf({ uploads, upload: uploadOf(ID_A) })).toEqual({
      state: EUploadState.Missing,
    })
    expect(log.fetch).toEqual([])
  })

  it('throws a fetch failure for a current upload whose blob is still stored', async () => {
    const upload = uploadOf(ID_A)
    const current = setup({ fetchFails: true })
    await expect(
      placeOf({ uploads: current.uploads, upload, current: new Set([ID_A]) }),
    ).rejects.toThrow('boom')
  })

  it('leaves an older upload unsettled when its fetch fails, so no outcome is recorded', async () => {
    const upload = uploadOf(ID_A)
    const older = setup({ fetchFails: true })
    const placed = await older.uploads.place({
      threadId,
      uploads: [upload],
      currentFileIds: new Set(),
    })
    expect(placed.has(ID_A)).toBe(false)
  })

  it('places several uploads in one call', async () => {
    const [a, b] = [uploadOf(ID_A), uploadOf(ID_B, 'b.txt')]
    const { uploads } = setup()
    const placed = await uploads.place({ threadId, uploads: [a, b] })
    expect(placed.get(ID_A)?.state).toBe(EUploadState.Ready)
    expect(placed.get(ID_B)?.state).toBe(EUploadState.Ready)
  })
})

describe('SandboxSaidUploads stored pictures', () => {
  const HASH = 'c'.repeat(64)
  const PATHNAME = `media/${USER}/${HASH}`

  const pictureOf = (overrides: Partial<SaidMediaFile> = {}): SaidMediaFile => ({
    hash: HASH,
    name: 'shot.png',
    size: 9,
    mediaType: 'image/png',
    ...overrides,
  })

  const placePicture = async (args: {
    uploads: SandboxSaidUploads
    file: SaidMediaFile
    current?: ReadonlySet<string>
  }) => {
    const placed = await args.uploads.place({
      threadId,
      uploads: [],
      mediaFiles: [args.file],
      ...(args.current === undefined ? {} : { currentFileIds: args.current }),
    })
    return placed.get(args.file.hash)
  }

  it('writes the stored picture where the sandbox keeps its files, from the media blob', async () => {
    const { uploads, log } = setup()
    const path = `${HOME}/uploads/${HASH}/shot.png`

    expect(await placePicture({ uploads, file: pictureOf() })).toEqual({
      state: EUploadState.Ready,
      path,
    })
    expect(log.fetch).toEqual([{ url: urlOf(PATHNAME), path, size: 9 }])
  })

  it('falls back to the hash when the name is not one a file may have', async () => {
    const { uploads, log } = setup()
    const file = pictureOf({ name: '../../etc/passwd' })

    expect(await placePicture({ uploads, file })).toEqual({
      state: EUploadState.Ready,
      path: `${HOME}/uploads/${HASH}/${HASH}`,
    })
    expect(log.fetch[0]?.path).toBe(`${HOME}/uploads/${HASH}/${HASH}`)
  })

  it('refuses a hash that is not one of ours', async () => {
    const { uploads, log, blobCalls } = setup()
    expect(await placePicture({ uploads, file: pictureOf({ hash: '../etc' }) })).toEqual({
      state: EUploadState.Missing,
    })
    expect(log.fetch).toEqual([])
    expect(blobCalls.sizeOf).toEqual([])
  })

  it('marks a picture the store no longer holds missing', async () => {
    const { uploads } = setup({ gone: new Set([PATHNAME]) })
    expect(await placePicture({ uploads, file: pictureOf() })).toEqual({
      state: EUploadState.Missing,
    })
  })

  it('places an upload and a stored picture in one call', async () => {
    const { uploads } = setup()

    const placed = await uploads.place({
      threadId,
      uploads: [uploadOf(ID_A)],
      mediaFiles: [pictureOf()],
    })

    expect(placed.get(ID_A)?.state).toBe(EUploadState.Ready)
    expect(placed.get(HASH)?.state).toBe(EUploadState.Ready)
  })
})
