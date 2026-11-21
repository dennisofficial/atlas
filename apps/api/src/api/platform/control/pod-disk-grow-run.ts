import { podDiskGrowthOf } from '@dltech/atlas-core'

import { failureText } from './pod-resize-run'

export type PodDisk = {
  podSessionId: string
  instanceId: string
  usedBytes: number
  limitBytes: number
}

export type PodDiskGrowDeps = {
  pods(): Promise<readonly PodDisk[]>
  busy(args: { podSessionId: string }): Promise<boolean | undefined>
  closeRun(args: { podSessionId: string }): Promise<void>
  grow(args: { instanceId: string; diskGb: number }): Promise<void>
  held(args: { podSessionId: string }): Promise<boolean>
  rewake(args: { podSessionId: string }): Promise<void>
  log(line: string): void
}

export type PodDiskGrowSummary = { checked: number; grown: number; waiting: number }

type PodDiskGrowOutcome = 'grown' | 'waiting' | 'skipped'

const growOne = async (args: {
  deps: PodDiskGrowDeps
  pod: PodDisk
  maxGb: number
}): Promise<PodDiskGrowOutcome> => {
  const { deps, pod } = args
  const diskGb = podDiskGrowthOf({
    usedBytes: pod.usedBytes,
    limitBytes: pod.limitBytes,
    maxGb: args.maxGb,
  })
  if (diskGb === undefined) return 'skipped'
  const busy = await deps.busy({ podSessionId: pod.podSessionId })
  if (busy === undefined) {
    deps.log(`pod-disk-grow: no session ${pod.podSessionId}, leaving ${pod.instanceId} alone`)
    return 'skipped'
  }
  // https://www.agent37.com/docs/agents-api/instances/resize — a disk grow reboots the vm, so the
  // next sweep tries again while a turn, shell or service is using the pod.
  if (busy) {
    deps.log(`pod-disk-grow: ${pod.podSessionId} is busy, waiting to grow to ${diskGb} GB`)
    return 'waiting'
  }
  await deps.closeRun({ podSessionId: pod.podSessionId })
  await deps.grow({ instanceId: pod.instanceId, diskGb })
  if (await deps.held({ podSessionId: pod.podSessionId })) {
    await deps.rewake({ podSessionId: pod.podSessionId })
  }
  deps.log(`pod-disk-grow: grew ${pod.instanceId} for ${pod.podSessionId} to ${diskGb} GB`)
  return 'grown'
}

export const runPodDiskGrow = async (args: {
  deps: PodDiskGrowDeps
  maxGb: number
}): Promise<PodDiskGrowSummary> => {
  const summary: PodDiskGrowSummary = { checked: 0, grown: 0, waiting: 0 }
  for (const pod of await args.deps.pods()) {
    summary.checked += 1
    try {
      const outcome = await growOne({ deps: args.deps, pod, maxGb: args.maxGb })
      if (outcome === 'grown') summary.grown += 1
      if (outcome === 'waiting') summary.waiting += 1
    } catch (failure) {
      args.deps.log(
        `pod-disk-grow: growing ${pod.instanceId} for ${pod.podSessionId} failed: ${failureText(failure)}`,
      )
    }
  }
  return summary
}
