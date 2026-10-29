import { EPodState, type PodStatus } from '@dltech/atlas-ui/ai/pod-status-chip'

const RESIZE_DELAY_MS = 700

export const RUNNING_POD: PodStatus = {
  state: EPodState.Running,
  vcpus: 4,
  podId: 'pod_8f3k2a91',
  region: 'iad1',
}

export function simulateResize(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RESIZE_DELAY_MS))
}
