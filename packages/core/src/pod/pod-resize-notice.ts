export enum EPodResizeNotice {
  Applied = 'applied',
  Failed = 'failed',
}

export type PodResizeStarted = { vcpus: number; memoryGb: number; generation: number }

export type PodResizeNotice = {
  vcpus: number
  memoryGb: number
  generation: number
  outcome: EPodResizeNotice
  error?: string | undefined
}

export const podResizedLine = (notice: PodResizeNotice): string =>
  notice.outcome === EPodResizeNotice.Applied
    ? `The pod was resized to ${notice.vcpus} vCPU / ${notice.memoryGb} GB of memory.`
    : `Resizing the pod to ${notice.vcpus} vCPU / ${notice.memoryGb} GB failed: ${notice.error ?? 'unknown error'}. The pod keeps its previous size.`
