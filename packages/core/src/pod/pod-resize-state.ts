export type PodResizeLogEvent = {
  type: string
  at: string
  generation?: number | undefined
  vcpus?: number | undefined
  memoryGb?: number | undefined
}

export enum EPodResizeProbe {
  Updating = 'updating',
  AtTarget = 'at-target',
  NotAtTarget = 'not-at-target',
  Unknown = 'unknown',
}

export enum EResizeWait {
  Wait = 'wait',
  Proceed = 'proceed',
}

export const POD_RESIZE_HARD_CAP_MS = 20 * 60_000
export const POD_RESIZE_ARM_PROBE_MS = 30_000
export const POD_RESIZE_SOFT_PROBE_MS = 5 * 60_000

export type PodResizeOpen = {
  generation: number
  vcpus: number
  memoryGb: number
  startedAt: number
}

export type ResizeWaitDecision =
  | { wait: EResizeWait.Proceed }
  | { wait: EResizeWait.Wait; checkAt: number; probe: boolean }

export const openPodResize = (events: readonly PodResizeLogEvent[]): PodResizeOpen | undefined => {
  let open: PodResizeOpen | undefined
  for (const event of events) {
    const { generation, vcpus, memoryGb } = event
    if (
      event.type === 'pod-resize-started' &&
      generation !== undefined &&
      vcpus !== undefined &&
      memoryGb !== undefined
    ) {
      open = { generation, vcpus, memoryGb, startedAt: Date.parse(event.at) }
      continue
    }
    if (
      event.type === 'pod-resized' &&
      open !== undefined &&
      generation !== undefined &&
      generation >= open.generation
    ) {
      open = undefined
    }
  }
  return open
}

export const settledPodResizes = (events: readonly PodResizeLogEvent[]): number[] =>
  events.flatMap((event) =>
    event.type === 'pod-resized' && event.generation !== undefined ? [event.generation] : [],
  )

export const resizeSettledIn = (args: {
  events: readonly PodResizeLogEvent[]
  generation: number
}): boolean => settledPodResizes(args.events).some((generation) => generation >= args.generation)

const probeDueAt = (args: { open: PodResizeOpen; probes: number }): number => {
  if (args.probes === 0) return args.open.startedAt + POD_RESIZE_ARM_PROBE_MS
  if (args.probes === 1) return args.open.startedAt + POD_RESIZE_SOFT_PROBE_MS
  return Number.POSITIVE_INFINITY
}

export const decideResizeWait = (args: {
  open: PodResizeOpen | undefined
  now: number
  probe: EPodResizeProbe | undefined
  probes: number
}): ResizeWaitDecision => {
  const { open, now, probe, probes } = args
  if (open === undefined || probe === EPodResizeProbe.AtTarget) return { wait: EResizeWait.Proceed }
  const cap = open.startedAt + POD_RESIZE_HARD_CAP_MS
  if (now >= cap) return { wait: EResizeWait.Proceed }
  const due = probeDueAt({ open, probes })
  if (now >= due) return { wait: EResizeWait.Wait, checkAt: now, probe: true }
  return { wait: EResizeWait.Wait, checkAt: Math.min(due, cap), probe: false }
}
