import { EPodState, type PodStatus } from '@dltech/atlas-ui/ai/pod-status-chip'
import type { SessionPodResourcesOutput } from '@dltech/atlas-protocol'

export const podChipStatusOf = (args: {
  resources: SessionPodResourcesOutput
  live: boolean
}): PodStatus | null => {
  const { resources, live } = args
  if (resources === null) return null
  return {
    state: live ? EPodState.Running : EPodState.Parked,
    ...(resources.vcpus === undefined ? {} : { vcpus: resources.vcpus }),
    ...(resources.pendingVcpus === undefined ? {} : { pendingVcpus: resources.pendingVcpus }),
  }
}
