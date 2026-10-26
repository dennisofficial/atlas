export enum EPodState {
  Starting = 'starting',
  Running = 'running',
  Resuming = 'resuming',
  Parked = 'parked',
  Stopped = 'stopped',
}

export const VCPU_STEPS = [2, 4, 8]

const RAM_PER_VCPU_GB = 2

export interface PodStatus {
  state: EPodState
  vcpus: number
  podId: string
  region: string
  pendingVcpus?: number
}

export const STATE_LABEL: Record<EPodState, string> = {
  [EPodState.Starting]: 'Starting',
  [EPodState.Running]: 'Running',
  [EPodState.Resuming]: 'Resuming',
  [EPodState.Parked]: 'Parked',
  [EPodState.Stopped]: 'Stopped',
}

export function ramOf(vcpus: number): number {
  return vcpus * RAM_PER_VCPU_GB
}

export function sizeLabel(vcpus: number): string {
  return `${vcpus} vCPU · ${ramOf(vcpus)} GB`
}

export function showsSize(state: EPodState): boolean {
  return state === EPodState.Running || state === EPodState.Resuming
}

export function chipLabel(status: PodStatus): string {
  if (status.state === EPodState.Running) return sizeLabel(status.vcpus)
  const label = STATE_LABEL[status.state]
  return showsSize(status.state) ? `${label} · ${sizeLabel(status.vcpus)}` : label
}

export function canResize(state: EPodState): boolean {
  return state !== EPodState.Starting && state !== EPodState.Stopped
}
