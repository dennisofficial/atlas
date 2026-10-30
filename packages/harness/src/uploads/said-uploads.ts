import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  EUploadState,
  uploadPathOf,
  type SaidUpload,
  type ThreadId,
  type UploadPlacement,
} from '@dltech/atlas-core'
import { safeUploadName } from '@dltech/atlas-wire'

import { SaidUploadsPort } from './said-uploads.port'

const CONCURRENCY = 4
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isWellFormed(upload: SaidUpload): boolean {
  return (
    UUID.test(upload.uploadId) &&
    upload.name === safeUploadName(upload.name) &&
    upload.pathname.endsWith(`/${upload.uploadId}/${upload.name}`)
  )
}

export type UploadDownload = (args: {
  threadId: ThreadId
  pathname: string
}) => Promise<{ found: false } | { found: true; downloadUrl: string; size: number }>

export class ApiSaidUploads extends SaidUploadsPort {
  private readonly settled = new Map<string, UploadPlacement>()

  constructor(
    private readonly deps: {
      sessionDirOf: (threadId: ThreadId) => Promise<string>
      download: UploadDownload
      fetchFn: typeof fetch
    },
  ) {
    super()
  }

  async place(args: {
    threadId: ThreadId
    uploads: readonly SaidUpload[]
    currentUploadIds?: ReadonlySet<string> | undefined
    signal?: AbortSignal | undefined
  }): Promise<ReadonlyMap<string, UploadPlacement>> {
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

  private async placeOne(args: {
    threadId: ThreadId
    upload: SaidUpload
    currentUploadIds?: ReadonlySet<string> | undefined
    signal?: AbortSignal | undefined
  }): Promise<UploadPlacement> {
    if (!isWellFormed(args.upload)) return { state: EUploadState.Missing }
    const remembered = this.settled.get(args.upload.uploadId)
    if (remembered !== undefined) return remembered

    const sessionDir = await this.deps.sessionDirOf(args.threadId)
    const target = join(sessionDir, uploadPathOf(args.upload))
    try {
      const placement = (await this.isPresent(target))
        ? { state: EUploadState.Ready as const, path: target }
        : await this.fetchTo({ ...args, target })
      this.settled.set(args.upload.uploadId, placement)
      return placement
    } catch (error) {
      const current = args.currentUploadIds?.has(args.upload.uploadId) ?? true
      if (current || args.signal?.aborted === true) throw error
      return { state: EUploadState.Missing }
    }
  }

  private async isPresent(target: string): Promise<boolean> {
    const found = await stat(target).catch(() => undefined)
    return found?.isFile() === true
  }

  private async fetchTo(args: {
    threadId: ThreadId
    upload: SaidUpload
    target: string
    signal?: AbortSignal | undefined
  }): Promise<UploadPlacement> {
    const grant = await this.deps.download({
      threadId: args.threadId,
      pathname: args.upload.pathname,
    })
    if (!grant.found) return { state: EUploadState.Missing }

    const response = await this.deps.fetchFn(
      grant.downloadUrl,
      args.signal === undefined ? {} : { signal: args.signal },
    )
    if (!response.ok || response.body === null) {
      throw new Error(`Downloading ${args.upload.name} failed with status ${response.status}.`)
    }

    const partial = `${args.target}.part`
    await mkdir(dirname(args.target), { recursive: true })
    try {
      await Bun.write(partial, response)
      const written = await stat(partial)
      if (written.size !== grant.size) {
        throw new Error(
          `Downloaded ${written.size} bytes of ${args.upload.name}, expected ${grant.size}.`,
        )
      }
      await rename(partial, args.target)
    } catch (error) {
      await rm(partial, { force: true })
      throw error
    }
    return { state: EUploadState.Ready, path: args.target }
  }
}
