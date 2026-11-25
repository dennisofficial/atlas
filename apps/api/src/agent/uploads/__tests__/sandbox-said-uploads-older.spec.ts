import { describe, expect, it } from 'bun:test'

import { EUploadState, toThreadId, type SaidMediaFile } from '@dltech/atlas-core'

import { SandboxSaidUploads } from '../sandbox-said-uploads'
import type { UploadBlobs } from '../upload-blobs'

const USER = 'user-1'
const HOME = '/atlas/home'
const threadId = toThreadId('thread-1')
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const pathOf = (hash: string): string => `${HOME}/uploads/${hash}/shot.png`
const pictureOf = (hash: string): SaidMediaFile => ({
  hash,
  name: 'shot.png',
  size: 9,
  mediaType: 'image/png',
})

const enoent = (): Error => Object.assign(new Error('ENOENT: nope'), { code: 'ENOENT' })
const FILE_STAT = { size: 9, mode: 0, mtimeMs: 0, isFile: () => true, isDirectory: () => false }

type Gate = { open(): void; opened: Promise<void> }
const gateOf = (): Gate => {
  let open = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

const drained = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const setup = (args: { present?: Set<string>; fetchFails?: boolean } = {}) => {
  const present = args.present ?? new Set<string>()
  const pod = gateOf()
  const log = { stat: [] as string[], fetch: [] as string[] }
  const blobs: UploadBlobs = {
    ready: async () => undefined,
    urlOf: async (pathname) => `https://blob.fake/${pathname}`,
    sizeOf: async () => 9,
  }
  const files = {
    stat: async ({ path }: { path: string }) => {
      log.stat.push(path)
      await pod.opened
      if (!present.has(path)) throw enoent()
      return FILE_STAT
    },
    fetchToFile: async (call: { path: string }) => {
      log.fetch.push(call.path)
      if (args.fetchFails === true) throw new Error('boom')
      present.add(call.path)
    },
  }
  const uploads = new SandboxSaidUploads({ userId: USER, home: HOME, files, blobs })
  return { uploads, log, pod }
}

const placeOf = (args: {
  uploads: SandboxSaidUploads
  files: SaidMediaFile[]
  current: ReadonlySet<string>
}) =>
  args.uploads.place({
    threadId,
    uploads: [],
    mediaFiles: args.files,
    currentFileIds: args.current,
  })

describe('SandboxSaidUploads older files', () => {
  it('names an older file at its sandbox path without waiting on the pod', async () => {
    const { uploads, log } = setup({ present: new Set([pathOf(HASH_A)]) })

    const placed = await placeOf({ uploads, files: [pictureOf(HASH_A)], current: new Set() })

    expect(placed.get(HASH_A)).toEqual({ state: EUploadState.Ready, path: pathOf(HASH_A) })
    expect(log.stat).toEqual([pathOf(HASH_A)])
  })

  it('still waits on the pod for a file of the current message', async () => {
    const { uploads, pod } = setup({ present: new Set([pathOf(HASH_A)]) })
    let settled = false

    const placing = placeOf({
      uploads,
      files: [pictureOf(HASH_A)],
      current: new Set([HASH_A]),
    }).then((placed) => {
      settled = true
      return placed
    })
    await drained()
    expect(settled).toBe(false)

    pod.open()
    expect((await placing).get(HASH_A)?.state).toBe(EUploadState.Ready)
  })

  it('checks an older file once and remembers it', async () => {
    const { uploads, log, pod } = setup({ present: new Set([pathOf(HASH_A)]) })
    const older = { uploads, files: [pictureOf(HASH_A)], current: new Set<string>() }

    await placeOf(older)
    await placeOf(older)
    expect(log.stat).toHaveLength(1)

    pod.open()
    await drained()
    await placeOf(older)
    expect(log.stat).toHaveLength(1)
  })

  it('fetches an older file the sandbox lost in the background', async () => {
    const { uploads, log, pod } = setup()
    pod.open()

    const placed = await placeOf({
      uploads,
      files: [pictureOf(HASH_A), pictureOf(HASH_B)],
      current: new Set(),
    })
    await drained()

    expect(placed.get(HASH_B)).toEqual({ state: EUploadState.Ready, path: pathOf(HASH_B) })
    expect(log.fetch).toEqual([pathOf(HASH_A), pathOf(HASH_B)])
  })

  it('checks an older file again after a failed background fetch', async () => {
    const { uploads, log, pod } = setup({ fetchFails: true })
    pod.open()
    const older = { uploads, files: [pictureOf(HASH_A)], current: new Set<string>() }

    expect((await placeOf(older)).get(HASH_A)?.state).toBe(EUploadState.Ready)
    await drained()
    await placeOf(older)
    await drained()

    expect(log.fetch).toHaveLength(2)
  })
})
