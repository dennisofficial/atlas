import { EHeldOutcome, type HeldOutcome, type Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

const AUDIT_LIMIT = 100

export const auditOwnLeases = async (args: {
  plane: ControlPlane
  hostId: number
  isRunning: (sessionId: string) => boolean
  settle(args: { lease: Lease; outcome: HeldOutcome }): Promise<boolean>
  log?: LogPort | undefined
}): Promise<void> => {
  let leases: Lease[]
  try {
    leases = await args.plane.leasesHeldBy({ hostId: args.hostId, limit: AUDIT_LIMIT })
  } catch (error) {
    args.log?.error({
      source: 'holder.sweep',
      message: 'listing the leases this host holds failed',
      ...logFieldsOf({ error }),
    })
    return
  }
  for (const lease of leases) {
    if (args.isRunning(lease.sessionId)) continue
    args.log?.error({
      source: 'holder.sweep',
      message: `held a lease on ${lease.sessionId} without running it — this is a bug`,
      data: { sessionId: lease.sessionId, hostId: args.hostId, epoch: lease.epoch },
    })
    await args.settle({ lease, outcome: { kind: EHeldOutcome.Faulted, needsHolder: true } })
  }
}
