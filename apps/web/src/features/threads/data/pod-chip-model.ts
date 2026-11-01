import {
  EPodState as EUiPodState,
  type PodStatus as UiPodStatus,
} from '@dltech/atlas-ui/ai/pod-status-chip'
import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

const UI_STATE: Record<EPodState, EUiPodState | null> = {
  [EPodState.None]: null,
  [EPodState.Booting]: EUiPodState.Starting,
  [EPodState.Running]: EUiPodState.Running,
  [EPodState.Parked]: EUiPodState.Parked,
  [EPodState.Failed]: EUiPodState.Stopped,
}

const hasEarlierAttempt = (pod: PodStatus): boolean => (pod.history?.length ?? 0) > pod.steps.length

export function chipStatusOf(pod: PodStatus | null): UiPodStatus | null {
  if (pod === null) return null
  const mapped = UI_STATE[pod.state]
  if (mapped === null) return null
  const state =
    mapped === EUiPodState.Starting && hasEarlierAttempt(pod) ? EUiPodState.Resuming : mapped
  if (state === EUiPodState.Parked || state === EUiPodState.Stopped) return { state }
  const resources = pod.resources
  if (resources?.vcpus === undefined) return null
  return {
    state,
    vcpus: resources.vcpus,
    podId: resources.sandboxId,
    region: resources.region,
    ...(resources.pendingVcpus === undefined ? {} : { pendingVcpus: resources.pendingVcpus }),
  }
}
