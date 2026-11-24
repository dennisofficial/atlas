import type {
  ChangeContentStore,
  ChangeBlobWrite,
  ChangedFileWrite,
  ControlPlane,
} from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { ChangePathEntry, ChangesManifest } from '@dltech/atlas-protocol'
import { EChangeSide } from '@dltech/atlas-protocol'

import { newKey, type RemoteCalls } from '../../calls/remote-calls'
import { readScan, readSide } from './daemon-changes'
import { fingerprintOf } from './fingerprint'
import { changeCheckoutId, changeRepoOf } from './identity'

const WATCH_DEBOUNCE_MS = 1500

export enum ESnapshotTrigger {
  Start = 'start',
  TurnEnd = 'turn-end',
  Watch = 'watch',
  Rearm = 'rearm',
}

export type ChangesCheckout = { repoPath: string; originUrl: string; base: string | null }

export type ChangesSnapshotterArgs = {
  sessionId: string
  plane: ControlPlane
  content: ChangeContentStore
  remoteCalls: RemoteCalls
  checkouts(): Promise<readonly ChangesCheckout[]>
  log?: LogPort | undefined
  now(): number
}

type Wanted = { path: string; oldPath: string | null; side: EChangeSide }

const fileOf = (file: ChangePathEntry): ChangedFileWrite => ({
  path: file.path,
  oldPath: file.oldPath,
  status: file.status,
  additions: file.additions,
  deletions: file.deletions,
  binary: file.binary,
  baseHash: file.baseHash,
  currentHash: file.currentHash,
  size: file.currentSize,
})

export class ChangesSnapshotter {
  private readonly args: ChangesSnapshotterArgs
  private readonly watchId: string
  private running: Promise<void> | undefined
  private readonly arming = new Set<Promise<void>>()
  private queued: ESnapshotTrigger | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private unsubscribe: (() => void) | undefined
  private stopped = false

  constructor(args: ChangesSnapshotterArgs) {
    this.args = args
    this.watchId = `changes-${args.sessionId}`
  }

  start(): void {
    if (this.unsubscribe !== undefined) return
    this.unsubscribe = this.args.remoteCalls.onEvent((frame) => {
      if (frame.event.type !== 'watch.changed') return
      if (frame.event.watchId !== this.watchId) return
      this.schedule()
    })
    this.startArming()
    void this.snapshotNow(ESnapshotTrigger.Start)
  }

  rearm(): void {
    if (this.stopped) return
    this.startArming()
    void this.snapshotNow(ESnapshotTrigger.Rearm)
  }

  quiesce(): void {
    if (this.stopped) return
    this.stopped = true
    this.queued = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.clearTimer()
  }

  async stop(): Promise<void> {
    this.quiesce()
    await Promise.all([...this.arming])
    await this.disarmWatches()
    await this.running
  }

  schedule(): void {
    if (this.stopped) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.snapshotNow(ESnapshotTrigger.Watch)
    }, WATCH_DEBOUNCE_MS)
  }

  snapshotNow(trigger: ESnapshotTrigger): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running !== undefined) {
      this.queued = trigger
      return this.running
    }
    this.args.log?.info({
      source: 'holder.changes',
      message: `changes snapshot for ${this.args.sessionId} started`,
      data: { sessionId: this.args.sessionId, trigger },
    })
    this.running = this.snapshotAll().finally(() => {
      this.running = undefined
      const queued = this.queued
      this.queued = undefined
      if (queued === undefined) return
      void this.snapshotNow(queued)
    })
    return this.running
  }

  private async snapshotAll(): Promise<void> {
    let checkouts: readonly ChangesCheckout[]
    try {
      checkouts = await this.args.checkouts()
    } catch (error) {
      this.fail({ phase: 'checkouts', error })
      return
    }
    for (const checkout of checkouts) {
      if (this.stopped) return
      await this.snapshotCheckout(checkout)
    }
  }

  private async snapshotCheckout(checkout: ChangesCheckout): Promise<void> {
    const { repoPath } = checkout
    try {
      const manifest = await readScan({
        calls: this.args.remoteCalls,
        repoPath,
        base: checkout.base,
      })
      const repo = changeRepoOf({ originUrl: checkout.originUrl, repoPath })
      const checkoutId = changeCheckoutId({
        sessionId: this.args.sessionId,
        repo,
        worktreePath: repoPath,
      })
      const fingerprint = fingerprintOf(manifest.files)
      const stored = await this.args.plane.readChangesSummary({ sessionId: this.args.sessionId })
      const previous = stored.find((row) => row.checkoutId === checkoutId)
      if (previous !== undefined && previous.fingerprint === fingerprint) return
      const blobs = await this.uploadMissing(manifest)
      await this.args.plane.upsertChanges({
        sessionId: this.args.sessionId,
        write: {
          checkoutId,
          sessionId: this.args.sessionId,
          repo,
          worktreePath: repoPath,
          base: manifest.base,
          fingerprint,
          updatedAt: this.args.now(),
          files: manifest.files.map(fileOf),
        },
        blobs,
      })
    } catch (error) {
      this.fail({ repoPath, phase: 'snapshot', error })
    }
  }

  private async uploadMissing(manifest: ChangesManifest): Promise<ChangeBlobWrite[]> {
    const wanted = new Map<string, Wanted>()
    for (const file of manifest.files) {
      if (file.baseHash !== null && !wanted.has(file.baseHash))
        wanted.set(file.baseHash, {
          path: file.path,
          oldPath: file.oldPath,
          side: EChangeSide.Base,
        })
      if (file.currentHash !== null && !wanted.has(file.currentHash))
        wanted.set(file.currentHash, {
          path: file.path,
          oldPath: file.oldPath,
          side: EChangeSide.Current,
        })
    }
    const present = await this.args.plane.changeBlobsPresent({ hashes: [...wanted.keys()] })
    const written: ChangeBlobWrite[] = []
    for (const [hash, target] of wanted) {
      if (present.has(hash)) continue
      const content = await readSide({
        calls: this.args.remoteCalls,
        repoPath: manifest.repoPath,
        base: manifest.base,
        path: target.path,
        oldPath: target.oldPath,
        side: target.side,
      })
      if (content.hash !== hash) throw new Error(`${target.path} changed while it was read`)
      await this.args.content.put({
        hash,
        bytes: new Uint8Array(Buffer.from(content.base64, 'base64')),
      })
      written.push({ hash, size: content.size })
    }
    return written
  }

  private startArming(): void {
    if (this.stopped) return
    const arming = this.armWatches().finally(() => {
      this.arming.delete(arming)
    })
    this.arming.add(arming)
  }

  private async armWatches(): Promise<void> {
    const checkouts = await this.args.checkouts().catch(() => [])
    if (this.stopped || checkouts.length === 0) return
    await this.args.remoteCalls
      .invoke({
        key: newKey(),
        op: {
          op: 'watch.start',
          watchId: this.watchId,
          roots: checkouts.map((checkout) => checkout.repoPath),
          debounceMs: WATCH_DEBOUNCE_MS,
        },
      })
      .catch((error: unknown) => this.fail({ phase: 'watch', error }))
  }

  private async disarmWatches(): Promise<void> {
    await this.args.remoteCalls
      .invoke({ key: newKey(), op: { op: 'watch.stop', watchId: this.watchId } })
      .catch(() => undefined)
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private fail(args: { repoPath?: string | undefined; phase: string; error: unknown }): void {
    if (this.stopped) return
    this.args.log?.error({
      source: 'holder.changes',
      message: `changes snapshot for ${this.args.sessionId} failed`,
      data: { sessionId: this.args.sessionId, repoPath: args.repoPath, phase: args.phase },
      ...logFieldsOf({ error: args.error }),
    })
  }
}
