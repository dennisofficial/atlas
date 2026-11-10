import { SaidUploadsPort } from '@dltech/atlas-agent'
import {
  EUploadState,
  isOwnedUpload,
  isSafeFileName,
  mediaPathname,
  uploadPathOf,
  type SaidMediaFile,
  type SaidUpload,
  type ThreadId,
  type UploadPlacement,
} from '@dltech/atlas-core'
import type { DaemonFileSystemPort } from '@dltech/atlas-host'

import type { UploadBlobs } from './upload-blobs'

const CONCURRENCY = 4
const MISSING: UploadPlacement = { state: EUploadState.Missing }
const MEDIA_HASH = /^[0-9a-f]{64}$/

type PlaceArgs = {
  threadId: ThreadId
  uploads: readonly SaidUpload[]
  mediaFiles?: readonly SaidMediaFile[] | undefined
  currentFileIds?: ReadonlySet<string> | undefined
  signal?: AbortSignal | undefined
}

/** One file an attachment needs on disk: where the blob keeps it, and what to call it there. */
type PlaceableFile = { fileId: string; pathname: string; name: string; owned: boolean }

export type SandboxSaidUploadsDeps = {
  userId: string
  home: string
  files: Pick<DaemonFileSystemPort, 'stat' | 'fetchToFile'>
  blobs: UploadBlobs | null
}

export class SandboxSaidUploads extends SaidUploadsPort {
  private readonly settled = new Map<string, UploadPlacement>()

  constructor(private readonly deps: SandboxSaidUploadsDeps) {
    super()
  }

  async place(args: PlaceArgs): Promise<ReadonlyMap<string, UploadPlacement>> {
    const placements = new Map<string, UploadPlacement>()
    const queue = this.filesOf(args)
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        placements.set(next.fileId, await this.placeOne({ ...args, file: next }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    return placements
  }

  private filesOf(args: PlaceArgs): PlaceableFile[] {
    const userId = this.deps.userId
    return [
      ...args.uploads.map(
        (upload): PlaceableFile => ({
          fileId: upload.uploadId,
          pathname: upload.pathname,
          name: upload.name,
          owned: isOwnedUpload({ upload, userId }),
        }),
      ),
      ...(args.mediaFiles ?? []).map(
        (file): PlaceableFile => ({
          fileId: file.hash,
          pathname: mediaPathname({ userId, hash: file.hash }),
          name: isSafeFileName(file.name) ? file.name : file.hash,
          owned: MEDIA_HASH.test(file.hash),
        }),
      ),
    ]
  }

  private async placeOne(args: PlaceArgs & { file: PlaceableFile }): Promise<UploadPlacement> {
    const { file } = args
    if (!file.owned) return MISSING
    const remembered = this.settled.get(file.fileId)
    if (remembered !== undefined) return remembered
    const { blobs } = this.deps
    if (blobs === null) return MISSING

    const target = `${this.deps.home}/${uploadPathOf({ fileId: file.fileId, name: file.name })}`
    try {
      const placement = (await this.isPresent(target))
        ? { state: EUploadState.Ready as const, path: target }
        : await this.fetchTo({ file, target, blobs, signal: args.signal })
      this.settled.set(file.fileId, placement)
      return placement
    } catch (error) {
      const current = args.currentFileIds?.has(file.fileId) ?? true
      if (current || args.signal?.aborted === true) throw error
      return MISSING
    }
  }

  private async isPresent(target: string): Promise<boolean> {
    const found = await this.deps.files.stat({ path: target }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    return found?.isFile() === true
  }

  private async fetchTo(args: {
    file: PlaceableFile
    target: string
    blobs: UploadBlobs
    signal: AbortSignal | undefined
  }): Promise<UploadPlacement> {
    const { file, target, blobs, signal } = args
    const size = await blobs.sizeOf(file.pathname)
    if (size === null) {
      this.settled.set(file.fileId, MISSING)
      return MISSING
    }
    await blobs.ready()
    const url = await blobs.urlOf(file.pathname)
    await this.deps.files.fetchToFile({
      url,
      path: target,
      size,
      ...(signal === undefined ? {} : { signal }),
    })
    return { state: EUploadState.Ready, path: target }
  }
}
