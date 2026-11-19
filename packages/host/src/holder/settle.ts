import { settleWrite, type HeldOutcome, type Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HostTimers } from './ports'

const RETRY_BASE_MS = 1_000
const RETRY_CAP_MS = 30_000

type Settling = { lease: Lease; outcome: HeldOutcome; failures: number }

export class LeaseSettler {
  private readonly settling = new Map<string, Settling>()

  constructor(
    private readonly args: {
      plane: ControlPlane
      timers: HostTimers
      log: LogPort | undefined
      ring(): void
      ringAt(isoTime: string | null): void
    },
  ) {}

  has(sessionId: string): boolean {
    return this.settling.has(sessionId)
  }

  clear(): void {
    this.settling.clear()
  }

  async settle(args: { lease: Lease; outcome: HeldOutcome }): Promise<boolean> {
    const { lease, outcome } = args
    const write = settleWrite(outcome)
    if (write.kind === 'none') {
      this.settling.delete(lease.sessionId)
      this.args.ring()
      return true
    }
    const failures = (this.settling.get(lease.sessionId)?.failures ?? 0) + 1
    this.settling.set(lease.sessionId, { lease, outcome, failures })
    try {
      await this.args.plane.revoke({
        sessionId: lease.sessionId,
        epoch: lease.epoch,
        wantsHolder: write.wantsHolder,
        resetRetry: write.resetRetry,
      })
    } catch (error) {
      this.args.log?.error({
        source: 'holder.settle',
        message: `settling ${lease.sessionId} failed; the claim loop retries it`,
        ...logFieldsOf({ error }),
      })
      const delay = Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_CAP_MS)
      this.args.ringAt(new Date(this.args.timers.now() + delay).toISOString())
      return false
    }
    this.settling.delete(lease.sessionId)
    if (write.retryDue) this.args.ringAt(lease.retryAfter)
    this.args.ring()
    return true
  }

  async retryPending(): Promise<void> {
    for (const entry of [...this.settling.values()]) await this.settle(entry)
  }
}
