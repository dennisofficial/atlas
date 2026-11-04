import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'

export const DRAIN_APPEND_GRACE_MS = 10_000

export const drainRetryUntil = (args: {
  drainDeadline: number | undefined
  fenceDeadline(): number
}): number =>
  args.drainDeadline === undefined
    ? args.fenceDeadline()
    : Math.min(args.drainDeadline + DRAIN_APPEND_GRACE_MS, args.fenceDeadline())

export class LeaseRenewal {
  private renewTimer: unknown
  private fenceTimer: unknown
  private lastRenewOk: number
  private selfFenced = false
  private stopped = false

  constructor(
    private readonly deps: HeldSessionDeps,
    private readonly args: {
      epoch: number
      onLost(): void
    },
  ) {
    this.lastRenewOk = deps.timers.now()
  }

  get isSelfFenced(): boolean {
    return this.selfFenced
  }

  fenceDeadline(): number {
    return this.lastRenewOk + this.deps.ttlMs - this.deps.fenceMarginMs
  }

  private fenceAt(): number {
    return this.fenceDeadline() + this.deps.renewEveryMs
  }

  schedule(): void {
    this.armFenceWatchdog()
    this.scheduleNext()
  }

  stop(): void {
    this.stopped = true
    if (this.renewTimer !== undefined) this.deps.timers.clearTimeout(this.renewTimer)
    if (this.fenceTimer !== undefined) this.deps.timers.clearTimeout(this.fenceTimer)
  }

  private armFenceWatchdog(): void {
    if (this.fenceTimer !== undefined) this.deps.timers.clearTimeout(this.fenceTimer)
    const deadline = this.fenceAt()
    const remaining = deadline - this.deps.timers.now()
    this.fenceTimer = this.deps.timers.setTimeout(
      () => this.fence(deadline),
      Math.max(0, remaining),
    )
  }

  private fence(deadline: number): void {
    if (this.stopped || this.selfFenced) return
    if (this.fenceAt() > deadline) return
    this.selfFenced = true
    this.deps.log?.error({
      source: 'holder.fence',
      message: `session ${this.deps.sessionId} self-fenced: no renew settled within ttl−margin`,
    })
    this.args.onLost()
  }

  private scheduleNext(): void {
    this.renewTimer = this.deps.timers.setTimeout(() => {
      if (this.stopped) return
      this.scheduleNext()
      void this.attemptRenew()
    }, this.deps.renewEveryMs)
  }

  private async attemptRenew(): Promise<void> {
    const deps = this.deps
    try {
      const result = await deps.plane.renew({
        sessionId: deps.sessionId,
        holderId: deps.holderId,
        epoch: this.args.epoch,
      })
      if (result.ok) {
        this.lastRenewOk = deps.timers.now()
        this.armFenceWatchdog()
      } else {
        this.args.onLost()
      }
    } catch (error) {
      deps.log?.warn({
        source: 'holder.renew',
        message: `renewing ${deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
}
