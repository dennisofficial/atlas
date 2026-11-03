import { EPodState, type PodStatus } from '@dltech/atlas-ui/ai/pod-status-chip'

const RESIZE_DELAY_MS = 700

export const POD_SIZES = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]

export const RUNNING_POD: PodStatus = {
  state: EPodState.Running,
  vcpus: 4,
  podId: 'pod_8f3k2a91',
  region: 'iad1',
}

export function simulateResize(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RESIZE_DELAY_MS))
}
