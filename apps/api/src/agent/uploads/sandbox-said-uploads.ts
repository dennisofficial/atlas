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
import { Sema } from 'async-sema'

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

type PlaceableFile = {
  fileId: string
  pathname: string
  name: string
  size: number
  owned: boolean
}

export type SandboxSaidUploadsDeps = {
  userId: string
  home: string
  files: Pick<DaemonFileSystemPort, 'fetchToFile'>
  blobs: UploadBlobs | null
}

export class SandboxSaidUploads extends SaidUploadsPort {
  constructor(private readonly deps: SandboxSaidUploadsDeps) {
    super()
  }

  async place(args: PlaceArgs): Promise<ReadonlyMap<string, UploadPlacement>> {
    const placements = new Map<string, UploadPlacement>()
    const sema = new Sema(CONCURRENCY)
    await Promise.all(
      this.filesOf(args).map(async (file) => {
        await sema.acquire()
        try {
          const placement = await this.placeOne({ ...args, file })
          if (placement !== undefined) placements.set(file.fileId, placement)
        } finally {
          sema.release()
        }
      }),
    )
    return placements
  }

  private targetOf(file: PlaceableFile): string {
    return `${this.deps.home}/${uploadPathOf({ fileId: file.fileId, name: file.name })}`
  }

  private filesOf(args: PlaceArgs): PlaceableFile[] {
    const userId = this.deps.userId
    return [
      ...args.uploads.map(
        (upload): PlaceableFile => ({
          fileId: upload.uploadId,
          pathname: upload.pathname,
          name: upload.name,
          size: upload.size,
          owned: isOwnedUpload({ upload, userId }),
        }),
      ),
      ...(args.mediaFiles ?? []).map(
        (file): PlaceableFile => ({
          fileId: file.hash,
          pathname: mediaPathname({ userId, hash: file.hash }),
          name: isSafeFileName(file.name) ? file.name : file.hash,
          size: file.size,
          owned: MEDIA_HASH.test(file.hash),
        }),
      ),
    ]
  }

  private async placeOne(
    args: PlaceArgs & { file: PlaceableFile },
  ): Promise<UploadPlacement | undefined> {
    const { file } = args
    const { blobs } = this.deps
    if (!file.owned || blobs === null) return MISSING

    const target = this.targetOf(file)
    try {
      await this.fetchTo({ file, target, blobs, signal: args.signal })
      return { state: EUploadState.Ready, path: target }
    } catch (error) {
      if (args.signal?.aborted === true) throw error
      if (await this.isGone({ file, blobs })) return MISSING
      const current = args.currentFileIds?.has(file.fileId) ?? true
      if (current) throw error
      return undefined
    }
  }

  private async isGone(args: { file: PlaceableFile; blobs: UploadBlobs }): Promise<boolean> {
    const size = await args.blobs.sizeOf(args.file.pathname).catch(() => undefined)
    return size === null
  }

  private async fetchTo(args: {
    file: PlaceableFile
    target: string
    blobs: UploadBlobs
    signal: AbortSignal | undefined
  }): Promise<void> {
    const { file, target, blobs, signal } = args
    await blobs.ready()
    const url = await blobs.urlOf(file.pathname)
    await this.deps.files.fetchToFile({
      url,
      path: target,
      size: file.size,
      ...(signal === undefined ? {} : { signal }),
    })
  }
}
