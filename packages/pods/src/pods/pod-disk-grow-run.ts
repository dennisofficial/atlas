import {
  EPodDiskPressure,
  podDiskGrowthOf,
  podDiskPressureOf,
  podRebootSafeOf,
  type PodRebootFacts,
} from '@dltech/atlas-core'

import { failureText } from './pod-resize-run'

export type PodDisk = {
  podSessionId: string
  instanceId: string
  usedBytes: number | undefined
  limitBytes: number | undefined
  sizeGb?: number | undefined
}

export type PodDiskGrowDeps = {
  facts(args: { podSessionId: string }): Promise<PodRebootFacts | undefined>
  closeRun(args: { podSessionId: string }): Promise<void>
  grow(args: { instanceId: string; diskGb: number }): Promise<void>
  log(line: string): void
}

export type PodDiskSweepDeps = PodDiskGrowDeps & {
  pods(): Promise<readonly PodDisk[]>
}

export type PodDiskGrowSummary = { checked: number; grown: number; waiting: number }

export const POD_DISK_GROWN_LIFETIME_STEPS = 2

export const podDiskGrownNotice = (diskGb: number): string =>
  `The pod restarted to grow its disk to ${diskGb} GB. Files are kept. Running shells, services and the last command stopped; restart what you need.`

export enum EPodDiskGrowOutcome {
  Grown = 'grown',
  Waiting = 'waiting',
  Skipped = 'skipped',
}

export type PodDiskGrowDecision = {
  outcome: EPodDiskGrowOutcome
  diskGb?: number | undefined
  reason?: string | undefined
}

const skipped = (reason: string): PodDiskGrowDecision => ({
  outcome: EPodDiskGrowOutcome.Skipped,
  reason,
})

const BYTES_PER_GB = 2 ** 30

const limitGbOf = (limitBytes: number): number => Math.round(limitBytes / BYTES_PER_GB)

export const growPodDisk = async (args: {
  deps: PodDiskGrowDeps
  pod: PodDisk
  maxGb: number
}): Promise<PodDiskGrowDecision> => {
  const { deps, pod } = args
  if (pod.usedBytes === undefined || pod.limitBytes === undefined) {
    return skipped('no disk figures yet')
  }
  const diskGb = podDiskGrowthOf({
    usedBytes: pod.usedBytes,
    limitBytes: pod.limitBytes,
    maxGb: args.maxGb,
    sizeGb: pod.sizeGb,
  })
  if (diskGb === undefined) {
    return skipped(`nothing to grow from ${limitGbOf(pod.limitBytes)} GB`)
  }
  // https://www.agent37.com/docs/agents-api/instances/resize — a disk grow reboots the vm and keeps /atlas.
  const pressure = podDiskPressureOf({ usedBytes: pod.usedBytes, limitBytes: pod.limitBytes })
  if (pressure !== EPodDiskPressure.Urgent) {
    const facts = await deps.facts({ podSessionId: pod.podSessionId })
    if (facts === undefined) return skipped('no session for this pod')
    const safety = podRebootSafeOf(facts)
    if (!safety.safe) {
      return { outcome: EPodDiskGrowOutcome.Waiting, reason: safety.holds.join(', ') }
    }
  }
  await deps.closeRun({ podSessionId: pod.podSessionId })
  await deps.grow({ instanceId: pod.instanceId, diskGb })
  return { outcome: EPodDiskGrowOutcome.Grown, diskGb }
}

const logDecision = (args: {
  log(line: string): void
  pod: PodDisk
  decision: PodDiskGrowDecision
}): void => {
  const { pod, decision } = args
  if (decision.outcome === EPodDiskGrowOutcome.Grown) {
    args.log(
      `pod-disk-grow: grew ${pod.instanceId} for ${pod.podSessionId} to ${decision.diskGb ?? 0} GB`,
    )
    return
  }
  if (decision.outcome === EPodDiskGrowOutcome.Waiting) {
    args.log(
      `pod-disk-grow: ${pod.podSessionId} is in use (${decision.reason ?? 'unknown'}), waiting to grow`,
    )
    return
  }
  args.log(
    `pod-disk-grow: left ${pod.instanceId} for ${pod.podSessionId} alone: ${decision.reason}`,
  )
}

export const runPodDiskGrow = async (args: {
  deps: PodDiskSweepDeps
  maxGb: number
}): Promise<PodDiskGrowSummary> => {
  const summary: PodDiskGrowSummary = { checked: 0, grown: 0, waiting: 0 }
  for (const pod of await args.deps.pods()) {
    summary.checked += 1
    try {
      const decision = await growPodDisk({ deps: args.deps, pod, maxGb: args.maxGb })
      if (decision.outcome === EPodDiskGrowOutcome.Grown) summary.grown += 1
      if (decision.outcome === EPodDiskGrowOutcome.Waiting) summary.waiting += 1
      logDecision({ log: args.deps.log, pod, decision })
    } catch (failure) {
      args.deps.log(
        `pod-disk-grow: growing ${pod.instanceId} for ${pod.podSessionId} failed: ${failureText(failure)}`,
      )
    }
  }
  return summary
}
