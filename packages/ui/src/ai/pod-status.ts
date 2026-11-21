export enum EPodState {
  Starting = 'starting',
  Running = 'running',
  Resuming = 'resuming',
  Parked = 'parked',
  Stopped = 'stopped',
}

export class ResizeDeclinedError extends Error {
  constructor() {
    super('the resize was declined')
    this.name = 'ResizeDeclinedError'
  }
}

const RAM_PER_VCPU_GB = 2

export type EPodResizePhase = 'steady' | 'resizing' | 'waiting' | 'failed'

export interface PodStatus {
  state: EPodState
  label?: string
  reason?: string
  vcpus?: number
  podId?: string
  region?: string
  pendingVcpus?: number
  phase?: EPodResizePhase
  resizeError?: string
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
  const restarting = status.state !== EPodState.Parked && status.state !== EPodState.Stopped
  if (status.phase === 'failed') return 'Resize failed'
  if (status.label !== undefined) return status.label
  if (restarting && status.pendingVcpus !== undefined) {
    if (status.phase === 'waiting') return `Waiting to resize · ${sizeLabel(status.pendingVcpus)}`
    return status.phase === 'resizing'
      ? `Resizing · ${sizeLabel(status.pendingVcpus)}`
      : `Restarting · ${sizeLabel(status.pendingVcpus)}`
  }
  if (status.state === EPodState.Running) {
    return status.vcpus === undefined ? STATE_LABEL[status.state] : sizeLabel(status.vcpus)
  }
  const label = STATE_LABEL[status.state]
  return showsSize(status.state) && status.vcpus !== undefined
    ? `${label} · ${sizeLabel(status.vcpus)}`
    : label
}

export function canResize(state: EPodState): boolean {
  return state !== EPodState.Starting && state !== EPodState.Stopped
}
