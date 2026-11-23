import { CONTEXT_MIRROR_MAX_BYTES, contextFileKindOf, contextMimeOf } from '@dltech/atlas-core'
import {
  changeHashOf,
  type ContextContentStore,
  type ContextFileWrite,
  type ControlPlane,
} from '@dltech/atlas-control'
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
const KIND_HEAD_BYTES = 8192

export enum EContextMirrorPhase {
  Scan = 'scan',
  Read = 'read',
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

type MirroredWrite = { write: ContextFileWrite; bytes: Uint8Array | undefined }

const EMPTY = new Uint8Array()

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
      return row === undefined || row.size !== file.size || row.mtimeMs !== file.mtimeMs
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
    const mirrored = await this.readOne(file).catch((error: unknown) => {
      this.fail({ phase: EContextMirrorPhase.Read, path: file.path, error })
      return undefined
    })
    if (mirrored === undefined) return undefined
    try {
      await this.args.plane.publishContextFile({
        sessionId: this.args.sessionId,
        write: mirrored.write,
        bytes: mirrored.bytes,
        content: this.args.content,
      })
      return mirrored.write.path
    } catch (error: unknown) {
      this.fail({ phase: EContextMirrorPhase.Store, path: file.path, error })
      return undefined
    }
  }

  private async readOne(file: ScannedFile): Promise<MirroredWrite> {
    if (file.size > CONTEXT_MIRROR_MAX_BYTES) {
      return {
        write: {
          path: file.path,
          digest: null,
          size: file.size,
          mime: contextMimeOf(file.path),
          kind: contextFileKindOf({ path: file.path, head: EMPTY }),
          mtimeMs: file.mtimeMs,
        },
        bytes: undefined,
      }
    }
    const bytes = await this.files.readBytes({
      path: contextFilePathOf({ root: this.args.root, path: file.path }),
    })
    return {
      write: {
        path: file.path,
        digest: changeHashOf(bytes),
        size: bytes.byteLength,
        mime: contextMimeOf(file.path),
        kind: contextFileKindOf({ path: file.path, head: bytes.subarray(0, KIND_HEAD_BYTES) }),
        mtimeMs: file.mtimeMs,
      },
      bytes,
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
