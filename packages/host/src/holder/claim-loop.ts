import type { Lease } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { HolderSweep } from './holder-sweep'
import type { HostTimers } from './ports'

export type ClaimLoopArgs = {
  timers: HostTimers
  tickMs: number
  hostId(): number | undefined
  draining(): boolean
  freeSlots(): number
  claimNext(args: { hostId: number; limit: number }): Promise<Lease[]>
  hold(args: { hostId: number; lease: Lease; claimMs: number }): Promise<void>
  onTick(): Promise<void>
  log: LogPort | undefined
}

export class ClaimLoop {
  private readonly args: ClaimLoopArgs
  private readonly sweep: HolderSweep
  private readonly dueTimers = new Set<unknown>()
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
    for (const timer of this.dueTimers) this.args.timers.clearTimeout(timer)
    this.dueTimers.clear()
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
    const delay = Math.max(0, Date.parse(isoTime) - this.args.timers.now())
    const timer = this.args.timers.setTimeout(() => {
      this.dueTimers.delete(timer)
      this.ring()
    }, delay)
    this.dueTimers.add(timer)
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
    if (this.auditDue) {
      this.auditDue = false
      await this.args.onTick()
    }
    const limit = this.args.freeSlots()
    if (limit <= 0) return
    const startedAt = this.args.timers.now()
    let leases: Lease[]
    try {
      leases = await this.args.claimNext({ hostId, limit })
    } catch (error) {
      this.args.log?.error({
        source: 'holder.claim',
        message: 'claiming the next sessions failed',
        ...logFieldsOf({ error }),
      })
      return
    }
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
