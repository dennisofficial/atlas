import type { Lease } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { HolderSweep } from './holder-sweep'
import type { HostTimers } from './ports'

export type ClaimBatch = { leases: Lease[]; nextRetryAt: string | null }

const MIN_DUE_DELAY_MS = 50

export type ClaimLoopArgs = {
  timers: HostTimers
  tickMs: number
  hostId(): number | undefined
  draining(): boolean
  freeSlots(): number
  claimNext(args: { hostId: number; limit: number }): Promise<ClaimBatch>
  hold(args: { hostId: number; lease: Lease; claimMs: number }): Promise<void>
  onTick(): Promise<void>
  settlePending(): Promise<void>
  log: LogPort | undefined
}

export class ClaimLoop {
  private readonly args: ClaimLoopArgs
  private readonly sweep: HolderSweep
  private due: { at: number; timer: unknown } | undefined
  private running = false
  private queued = false
  private auditDue = false
  private stopped = true

  constructor(args: ClaimLoopArgs) {
    this.args = args
    this.sweep = new HolderSweep({
      timers: args.timers,
      intervalMs: args.tickMs,
      tick: async () => {
        this.auditDue = true
        this.ring()
      },
    })
  }

  start(): void {
    this.stopped = false
    this.sweep.start()
    this.ring()
  }

  stop(): void {
    this.stopped = true
    this.queued = false
    this.sweep.stop()
    this.clearDue()
  }

  ring(): void {
    if (this.stopped) return
    if (this.running) {
      this.queued = true
      return
    }
    this.running = true
    void this.runQueued()
  }

  ringAt(isoTime: string | null): void {
    if (isoTime === null || this.stopped) return
    const at = Date.parse(isoTime)
    if (this.due !== undefined && this.due.at <= at) return
    this.clearDue()
    const delay = Math.max(MIN_DUE_DELAY_MS, at - this.args.timers.now())
    const timer = this.args.timers.setTimeout(() => {
      this.due = undefined
      this.ring()
    }, delay)
    this.due = { at, timer }
  }

  private clearDue(): void {
    if (this.due === undefined) return
    this.args.timers.clearTimeout(this.due.timer)
    this.due = undefined
  }

  private async runQueued(): Promise<void> {
    try {
      do {
        this.queued = false
        await this.runOnce()
      } while (this.queued && !this.stopped)
    } finally {
      this.running = false
    }
  }

  private async runOnce(): Promise<void> {
    const hostId = this.args.hostId()
    if (this.args.draining() || hostId === undefined) return
    await this.args.settlePending()
    if (this.auditDue) {
      this.auditDue = false
      await this.args.onTick()
    }
    const limit = this.args.freeSlots()
    if (limit <= 0) return
    const startedAt = this.args.timers.now()
    let batch: ClaimBatch
    try {
      batch = await this.args.claimNext({ hostId, limit })
    } catch (error) {
      this.args.log?.error({
        source: 'holder.claim',
        message: 'claiming the next sessions failed',
        ...logFieldsOf({ error }),
      })
      return
    }
    const { leases } = batch
    this.ringAt(batch.nextRetryAt)
    const claimMs = this.args.timers.now() - startedAt
    for (const lease of leases) await this.holdOne({ hostId, lease, claimMs })
    if (leases.length === limit) this.queued = true
  }

  private async holdOne(args: { hostId: number; lease: Lease; claimMs: number }): Promise<void> {
    try {
      await this.args.hold(args)
    } catch (error) {
      this.args.log?.error({
        source: 'holder.claim',
        message: `holding ${args.lease.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
}
