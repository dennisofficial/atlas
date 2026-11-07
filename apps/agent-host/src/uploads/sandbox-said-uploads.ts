import { SaidUploadsPort } from '@dltech/atlas-agent'
import {
  EUploadState,
  isOwnedUpload,
  uploadPathOf,
  type SaidUpload,
  type ThreadId,
  type UploadPlacement,
} from '@dltech/atlas-core'
import type { DaemonFileSystemPort } from '@dltech/atlas-host'

import type { UploadBlobs } from './upload-blobs'

const CONCURRENCY = 4
const MISSING: UploadPlacement = { state: EUploadState.Missing }

type PlaceArgs = {
  threadId: ThreadId
  uploads: readonly SaidUpload[]
  currentUploadIds?: ReadonlySet<string> | undefined
  signal?: AbortSignal | undefined
}

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
    const queue = [...args.uploads]
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        placements.set(next.uploadId, await this.placeOne({ ...args, upload: next }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    return placements
  }

  private async placeOne(args: PlaceArgs & { upload: SaidUpload }): Promise<UploadPlacement> {
    const { upload } = args
    if (!isOwnedUpload({ upload, userId: this.deps.userId })) return MISSING
    const remembered = this.settled.get(upload.uploadId)
    if (remembered !== undefined) return remembered
    const { blobs } = this.deps
    if (blobs === null) return MISSING

    const target = `${this.deps.home}/${uploadPathOf(upload)}`
    try {
      const placement = (await this.isPresent(target))
        ? { state: EUploadState.Ready as const, path: target }
        : await this.fetchTo({ upload, target, blobs, signal: args.signal })
      this.settled.set(upload.uploadId, placement)
      return placement
    } catch (error) {
      const current = args.currentUploadIds?.has(upload.uploadId) ?? true
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
    upload: SaidUpload
    target: string
    blobs: UploadBlobs
    signal: AbortSignal | undefined
  }): Promise<UploadPlacement> {
    const { upload, target, blobs, signal } = args
    const size = await blobs.sizeOf(upload.pathname)
    if (size === null) {
      this.settled.set(upload.uploadId, MISSING)
      return MISSING
    }
    await blobs.ready()
    const url = await blobs.urlOf(upload.pathname)
    await this.deps.files.fetchToFile({
      url,
      path: target,
      size,
      ...(signal === undefined ? {} : { signal }),
    })
    return { state: EUploadState.Ready, path: target }
  }
}
