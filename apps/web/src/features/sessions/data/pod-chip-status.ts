import { EPodState, type PodStatus } from '@dltech/atlas-ui/ai/pod-status-chip'
import { ESandboxStatus, type SessionStatusOutput } from '@dltech/atlas-protocol'

export type SessionPodChipArgs = {
  pod: SessionStatusOutput['pod']
  live: boolean
  sandbox?: SessionStatusOutput['sandbox']
}

type DeclaredState = { state: EPodState; label?: string; reason?: string }

const declaredStateOf = (args: {
  status: ESandboxStatus
  reason: string | undefined
}): DeclaredState => {
  const { status, reason } = args
  const reasoned = reason === undefined ? {} : { reason }
  switch (status) {
    case ESandboxStatus.Running:
      return { state: EPodState.Running, ...reasoned }
    case ESandboxStatus.Waking:
      return { state: EPodState.Resuming, ...reasoned }
    case ESandboxStatus.Provisioning:
    case ESandboxStatus.Starting:
    case ESandboxStatus.Restarting:
    case ESandboxStatus.Updating:
      return { state: EPodState.Starting, ...reasoned }
    case ESandboxStatus.Sleeping:
      return { state: EPodState.Parked, label: 'Sleeping', ...reasoned }
    case ESandboxStatus.Failed:
      return { state: EPodState.Stopped, label: 'Failed', ...reasoned }
    case ESandboxStatus.Stopping:
      return { state: EPodState.Stopped, label: 'Stopping', ...reasoned }
    case ESandboxStatus.Stopped:
    case ESandboxStatus.Deleting:
    case ESandboxStatus.Deleted:
      return { state: EPodState.Stopped, ...reasoned }
  }
}

export const podChipStatusOf = (args: SessionPodChipArgs): PodStatus | null => {
  const { pod, live, sandbox } = args
  if (pod === undefined) return null
  const declared =
    sandbox === undefined || sandbox === null
      ? undefined
      : declaredStateOf({ status: sandbox.status, reason: sandbox.reason })
  const vcpus = pod.actualVcpus ?? pod.desiredVcpus
  const pending = pod.phase === 'steady' ? undefined : pod.desiredVcpus
  return {
    state: declared?.state ?? (live ? EPodState.Running : EPodState.Parked),
    ...(declared?.label === undefined ? {} : { label: declared.label }),
    ...(declared?.reason === undefined ? {} : { reason: declared.reason }),
    ...(vcpus === undefined ? {} : { vcpus }),
    ...(pending === undefined ? {} : { pendingVcpus: pending }),
    phase: pod.phase,
    ...(pod.error === undefined ? {} : { resizeError: pod.error }),
  }
}
