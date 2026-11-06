import type { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'

export type FreshHosts = {
  claimedByFreshHost(args: { plane: ControlPlane; limit: number }): Promise<string[]>
  releaseAll(): Promise<void>
}

export const freshHosts = (params: ConformanceParams): FreshHosts => {
  const releases: (() => Promise<void>)[] = []
  return {
    async claimedByFreshHost(args) {
      const hostId = await params.nextHostId()
      releases.push(await params.holdPresence(hostId))
      const claimed = await args.plane.claimNext({ hostId, limit: args.limit })
      return claimed.leases.map((lease) => lease.sessionId)
    },
    async releaseAll() {
      for (const release of releases.splice(0)) await release()
    },
  }
}
