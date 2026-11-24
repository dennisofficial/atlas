import { contextFileKindOf, contextMediaKindOf, contextMimeOf } from '@dltech/atlas-core'
import type { ContextContentStore, ContextFileWrite, ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { newKey, type RemoteCalls } from '../../calls/remote-calls'
import { DaemonFileSystemPort } from '../../calls/ports/filesystem'
import {
  contextFilePathOf,
  contextRemovableFrom,
  scanContextDir,
  type ScannedFile,
} from './daemon-context'

const WATCH_DEBOUNCE_MS = 1000
const PRESIGN_PUT_TTL_MS = 15 * 60 * 1000

export enum EContextMirrorPhase {
  Scan = 'scan',
  Upload = 'upload',
  Store = 'store',
  Announce = 'announce',
}

export type ContextMirrorArgs = {
  sessionId: string
  root: string
  plane: ControlPlane
  content: ContextContentStore
  remoteCalls: RemoteCalls
  announce(paths: readonly string[]): Promise<void>
  log?: LogPort | undefined
  now(): number
}

export class ContextMirror {
  private readonly args: ContextMirrorArgs
  private readonly watchId: string
  private readonly files: DaemonFileSystemPort
  private turning: Promise<void> | undefined
  private queued = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private arming: Promise<void> | undefined
  private unsubscribe: (() => void) | undefined
  private stopped = false

  constructor(args: ContextMirrorArgs) {
    this.args = args
    this.watchId = `context-${args.sessionId}`
    this.files = new DaemonFileSystemPort({ calls: args.remoteCalls })
  }

  start(): void {
    if (this.unsubscribe !== undefined) return
    this.unsubscribe = this.args.remoteCalls.onEvent((frame) => {
      if (frame.event.type !== 'watch.changed') return
      if (frame.event.watchId !== this.watchId) return
      this.schedule()
    })
    this.arm()
    void this.rescanNow()
  }

  quiesce(): void {
    if (this.stopped) return
    this.stopped = true
    this.queued = false
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.clearTimer()
  }

  async stop(): Promise<void> {
    this.quiesce()
    await this.arming
    await this.disarm()
    await this.turning
  }

  rescanNow(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    this.queued = true
    if (this.turning === undefined) this.turning = this.turn()
    return this.turning
  }

  private async turn(): Promise<void> {
    try {
      while (this.queued && !this.stopped) {
        this.queued = false
        await this.rescan().catch((error: unknown) =>
          this.fail({ phase: EContextMirrorPhase.Scan, error }),
        )
      }
    } finally {
      this.turning = undefined
    }
  }

  private schedule(): void {
    if (this.stopped) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.rescanNow()
    }, WATCH_DEBOUNCE_MS)
  }

  private async rescan(): Promise<void> {
    const scan = await scanContextDir({ files: this.files, root: this.args.root })
    const rows = await this.args.plane.listContextFiles({ sessionId: this.args.sessionId })
    const byPath = new Map(rows.map((row) => [row.path, row]))
    const scannedPaths = new Set(scan.files.map((file) => file.path))
    const changed = scan.files.filter((file) => {
      const row = byPath.get(file.path)
      if (row === undefined || row.size !== file.size || row.mtimeMs !== file.mtimeMs) return true
      if (row.mime !== contextMimeOf(file.path)) return true
      const mediaKind = contextMediaKindOf(file.path)
      return mediaKind !== null && row.kind !== mediaKind
    })
    const mirrored: string[] = []
    for (const file of changed) {
      if (this.stopped) return
      const path = await this.publish(file)
      if (path !== undefined) mirrored.push(path)
    }
    const removed = rows
      .filter(
        (row) => !scannedPaths.has(row.path) && contextRemovableFrom({ scan, path: row.path }),
      )
      .map((row) => row.path)
    if (removed.length > 0) {
      await this.args.plane.removeContextFiles({ sessionId: this.args.sessionId, paths: removed })
    }
    const touched = [...mirrored, ...removed]
    if (touched.length === 0) return
    await this.args
      .announce(touched)
      .catch((error: unknown) => this.fail({ phase: EContextMirrorPhase.Announce, error }))
  }

  private async publish(file: ScannedFile): Promise<string | undefined> {
    const path = contextFilePathOf({ root: this.args.root, path: file.path })
    const write = await this.mirror(file, path).catch((error: unknown) => {
      this.fail({ phase: EContextMirrorPhase.Upload, path: file.path, error })
      return undefined
    })
    if (write === undefined) return undefined
    try {
      const committed = await this.args.plane.commitContextFile({
        sessionId: this.args.sessionId,
        write,
        content: this.args.content,
      })
      return committed ? write.path : undefined
    } catch (error: unknown) {
      this.fail({ phase: EContextMirrorPhase.Store, path: file.path, error })
      return undefined
    }
  }

  private async mirror(file: ScannedFile, path: string): Promise<ContextFileWrite> {
    const digest = await this.files.digestFile({ path })
    if (!(await this.args.content.exists({ hash: digest.sha256 }))) {
      const url = await this.args.content.presignPut({
        hash: digest.sha256,
        ttlMs: PRESIGN_PUT_TTL_MS,
      })
      const put = await this.files.putFile({ path, url, size: digest.size })
      if (put.sha256 !== digest.sha256) {
        await this.args.content.removing([digest.sha256])
        throw new Error(`the store kept ${put.sha256} where the file hashes to ${digest.sha256}`)
      }
    }
    return {
      path: file.path,
      digest: digest.sha256,
      size: digest.size,
      mime: contextMimeOf(file.path),
      kind: contextFileKindOf({ path: file.path, head: digest.head }),
      mtimeMs: file.mtimeMs,
    }
  }

  private arm(): void {
    if (this.stopped) return
    this.arming = this.args.remoteCalls
      .invoke({
        key: newKey(),
        op: {
          op: 'watch.start',
          watchId: this.watchId,
          roots: [this.args.root],
          debounceMs: WATCH_DEBOUNCE_MS,
        },
      })
      .then(() => undefined)
      .catch((error: unknown) => this.fail({ phase: EContextMirrorPhase.Scan, error }))
  }

  private async disarm(): Promise<void> {
    await this.args.remoteCalls
      .invoke({ key: newKey(), op: { op: 'watch.stop', watchId: this.watchId } })
      .catch(() => undefined)
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private fail(args: {
    phase: EContextMirrorPhase
    path?: string | undefined
    digest?: string | undefined
    error: unknown
  }): void {
    this.args.log?.error({
      source: 'holder.context',
      message: `context mirror for ${this.args.sessionId} failed`,
      data: {
        sessionId: this.args.sessionId,
        phase: args.phase,
        path: args.path,
        digest: args.digest,
        at: this.args.now(),
      },
      ...logFieldsOf({ error: args.error }),
    })
  }
}
