import { EPodState, type PodStatus } from '@dltech/atlas-ui/ai/pod-status-chip'
import type { SessionStatusOutput } from '@dltech/atlas-protocol'

export const podChipStatusOf = (args: {
  pod: SessionStatusOutput['pod']
  live: boolean
}): PodStatus | null => {
  const { pod, live } = args
  if (pod === undefined) return null
  const vcpus = pod.actualVcpus ?? pod.desiredVcpus
  const pending = pod.phase === 'steady' ? undefined : pod.desiredVcpus
  return {
    state: live ? EPodState.Running : EPodState.Parked,
    ...(vcpus === undefined ? {} : { vcpus }),
    ...(pending === undefined ? {} : { pendingVcpus: pending }),
    phase: pod.phase,
    ...(pod.error === undefined ? {} : { resizeError: pod.error }),
  }
}
