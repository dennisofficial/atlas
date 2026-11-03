import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'

export class LeaseRenewal {
  private renewTimer: unknown
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

  schedule(): void {
    this.renewTimer = this.deps.timers.setTimeout(() => {
      void this.renew()
    }, this.deps.renewEveryMs)
  }

  stop(): void {
    this.stopped = true
    if (this.renewTimer !== undefined) this.deps.timers.clearTimeout(this.renewTimer)
  }

  private async renew(): Promise<void> {
    const deps = this.deps
    try {
      const result = await deps.plane.renew({
        sessionId: deps.sessionId,
        holderId: deps.holderId,
        epoch: this.args.epoch,
      })
      if (result.ok) {
        this.lastRenewOk = deps.timers.now()
      } else {
        this.args.onLost()
        return
      }
    } catch (error) {
      deps.log?.warn({
        source: 'holder.renew',
        message: `renewing ${deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
    const silentMs = deps.timers.now() - this.lastRenewOk
    if (silentMs >= deps.ttlMs - deps.fenceMarginMs) {
      deps.log?.error({
        source: 'holder.fence',
        message: `session ${deps.sessionId} self-fenced after ${silentMs}ms without a renew`,
      })
      this.selfFenced = true
      this.args.onLost()
      return
    }
    if (!this.stopped) this.schedule()
  }
}
