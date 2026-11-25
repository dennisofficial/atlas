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
  private readonly checking = new Set<string>()

  constructor(private readonly deps: SandboxSaidUploadsDeps) {
    super()
  }

  async place(args: PlaceArgs): Promise<ReadonlyMap<string, UploadPlacement>> {
    const placements = new Map<string, UploadPlacement>()
    const current: PlaceableFile[] = []
    const older: PlaceableFile[] = []
    for (const file of this.filesOf(args)) {
      const known = this.knownPlacementOf(file)
      if (known !== undefined) placements.set(file.fileId, known)
      else if (args.currentFileIds?.has(file.fileId) ?? true) current.push(file)
      else placements.set(file.fileId, this.assumePlaced({ args, file, older }))
    }
    this.checkInBackground({ args, files: older })
    await this.placeAll({ args, files: current, placements })
    return placements
  }

  private knownPlacementOf(file: PlaceableFile): UploadPlacement | undefined {
    if (!file.owned || this.deps.blobs === null) return MISSING
    return this.settled.get(file.fileId)
  }

  private assumePlaced(args: {
    args: PlaceArgs
    file: PlaceableFile
    older: PlaceableFile[]
  }): UploadPlacement {
    if (!this.checking.has(args.file.fileId)) {
      this.checking.add(args.file.fileId)
      args.older.push(args.file)
    }
    return { state: EUploadState.Ready, path: this.targetOf(args.file) }
  }

  private checkInBackground(args: { args: PlaceArgs; files: PlaceableFile[] }): void {
    if (args.files.length === 0) return
    void this.placeAll({
      args: { ...args.args, signal: undefined },
      files: args.files,
      placements: new Map(),
    })
      .catch(() => undefined)
      .finally(() => {
        for (const file of args.files) this.checking.delete(file.fileId)
      })
  }

  private async placeAll(args: {
    args: PlaceArgs
    files: PlaceableFile[]
    placements: Map<string, UploadPlacement>
  }): Promise<void> {
    const queue = [...args.files]
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        args.placements.set(next.fileId, await this.placeOne({ ...args.args, file: next }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
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
    const known = this.knownPlacementOf(file)
    if (known !== undefined) return known
    const { blobs } = this.deps
    if (blobs === null) return MISSING

    const target = this.targetOf(file)
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
