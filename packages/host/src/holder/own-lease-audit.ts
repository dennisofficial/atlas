import type { Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

const AUDIT_LIMIT = 100

export const auditOwnLeases = async (args: {
  plane: ControlPlane
  hostId: number
  isRunning: (sessionId: string) => boolean
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
    try {
      const revoked = await args.plane.revoke({
        sessionId: lease.sessionId,
        wantsHolder: true,
        epoch: lease.epoch,
      })
      if (!revoked.ok) continue
      args.log?.warn({
        source: 'holder.sweep',
        message: `revoked lease on ${lease.sessionId} that this host held without running`,
        data: { sessionId: lease.sessionId, hostId: args.hostId, epoch: lease.epoch },
      })
    } catch (error) {
      args.log?.error({
        source: 'holder.sweep',
        message: `revoking the idle lease on ${lease.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
}
