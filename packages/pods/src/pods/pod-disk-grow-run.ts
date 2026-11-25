import {
  EPodDiskCeilingAction,
  EPodDiskPressure,
  podDiskCeilingNudgeOf,
  podDiskGrowthOf,
  podDiskPressureOf,
  podRebootSafeOf,
  type PodRebootFacts,
} from '@dltech/atlas-core'

import { reportPodStarted } from './pod-disk-grow-report'
import { failureText } from './pod-resize-run'

export type PodDisk = {
  podSessionId: string
  instanceId: string
  usedBytes: number | undefined
  limitBytes: number | undefined
  sizeGb?: number | undefined
  stale?: boolean | undefined
  nudgedPercent?: number | undefined
}

export type PodDiskGrowDeps = {
  facts(args: { podSessionId: string }): Promise<PodRebootFacts | undefined>
  closeRun(args: { podSessionId: string }): Promise<void>
  grow(args: { instanceId: string; diskGb: number }): Promise<void>
  recordDisk(args: { sessionId: string; diskGb: number }): Promise<void>
  started?(args: { sessionId: string; diskGbFrom: number; diskGbTo: number }): Promise<void>
  notice(args: { sessionId: string; diskGb: number }): Promise<void>
  ceilingNotice(args: {
    sessionId: string
    usedBytes: number
    limitBytes: number
    percent: number
  }): Promise<void>
  markNudged(args: {
    instanceId: string
    podSessionId: string
    percent: number | undefined
  }): Promise<void>
  log(line: string): void
}

export type PodDiskSweepDeps = PodDiskGrowDeps & {
  pods(): Promise<readonly PodDisk[]>
}

export type PodDiskGrowSummary = {
  checked: number
  grown: number
  waiting: number
  nudged: number
}

export const POD_DISK_GROWN_LIFETIME_STEPS = 2

export const podDiskGrownNotice = (diskGb: number): string =>
  `The pod restarted to grow its disk to ${diskGb} GB. Files are kept. Running shells, services and the last command stopped; restart what you need.`

export const POD_DISK_CEILING_LIFETIME_STEPS = 2

export enum EPodDiskGrowOutcome {
  Grown = 'grown',
  Waiting = 'waiting',
  Nudged = 'nudged',
  Skipped = 'skipped',
}

export type PodDiskGrowDecision = {
  outcome: EPodDiskGrowOutcome
  diskGb?: number | undefined
  percent?: number | undefined
  reason?: string | undefined
}

const skipped = (reason: string): PodDiskGrowDecision => ({
  outcome: EPodDiskGrowOutcome.Skipped,
  reason,
})

const BYTES_PER_GB = 2 ** 30

const limitGbOf = (limitBytes: number): number => Math.round(limitBytes / BYTES_PER_GB)

const gbText = (bytes: number): string => (bytes / BYTES_PER_GB).toFixed(1)

export const podDiskCeilingNotice = (args: {
  usedBytes: number
  limitBytes: number
  percent: number
}): string => {
  const freeBytes = Math.max(0, args.limitBytes - args.usedBytes)
  return `The pod disk is ${args.percent}% full: ${gbText(args.usedBytes)} of ${gbText(args.limitBytes)} GB, ${gbText(freeBytes)} GB free. It cannot grow past ${gbText(args.limitBytes)} GB. When it is full, writes fail. Free space now: remove worktrees you do not need (git worktree remove), node_modules in idle worktrees, build output and caches, and unused Docker data (docker system prune). Find the largest folders with: du -xh -d3 /atlas | sort -rh | head -30`
}

const noticeGrew = async (args: {
  deps: PodDiskGrowDeps
  sessionId: string
  diskGb: number
}): Promise<void> => {
  try {
    await args.deps.notice({ sessionId: args.sessionId, diskGb: args.diskGb })
  } catch (failure) {
    args.deps.log(
      `pod-disk-grow: notifying ${args.sessionId} of the grow failed: ${failureText(failure)}`,
    )
  }
}

const recordGrew = async (args: {
  deps: PodDiskGrowDeps
  sessionId: string
  diskGb: number
}): Promise<void> => {
  try {
    await args.deps.recordDisk({ sessionId: args.sessionId, diskGb: args.diskGb })
  } catch (failure) {
    args.deps.log(
      `pod-disk-grow: recording the ${args.diskGb} GB disk of ${args.sessionId} failed: ${failureText(failure)}`,
    )
  }
}

const markNudged = async (args: {
  deps: PodDiskGrowDeps
  pod: PodDisk
  percent: number | undefined
}): Promise<void> => {
  try {
    await args.deps.markNudged({
      instanceId: args.pod.instanceId,
      podSessionId: args.pod.podSessionId,
      percent: args.percent,
    })
  } catch (failure) {
    const detail =
      args.percent === undefined
        ? 'clearing the ceiling nudge'
        : `recording the ${args.percent}% ceiling nudge`
    args.deps.log(
      `pod-disk-grow: ${detail} of ${args.pod.podSessionId} failed: ${failureText(failure)}`,
    )
  }
}

const ceilingDecisionOf = async (args: {
  deps: PodDiskGrowDeps
  pod: PodDisk
  ceilingGb: number
  usedBytes: number
  limitBytes: number
}): Promise<PodDiskGrowDecision> => {
  const { deps, pod } = args
  const decision = podDiskCeilingNudgeOf({
    usedBytes: args.usedBytes,
    limitBytes: args.limitBytes,
    nudgedPercent: pod.nudgedPercent,
  })
  if (decision.action === EPodDiskCeilingAction.Rearm) {
    await markNudged({ deps, pod, percent: undefined })
    return skipped('the disk fell back under 80 percent, so the ceiling nudge is armed again')
  }
  if (decision.action !== EPodDiskCeilingAction.Nudge || decision.percent === undefined) {
    return skipped(`nothing to grow from ${args.ceilingGb} GB`)
  }
  const percent = decision.percent
  try {
    await deps.ceilingNotice({
      sessionId: pod.podSessionId,
      usedBytes: args.usedBytes,
      limitBytes: args.limitBytes,
      percent,
    })
  } catch (failure) {
    deps.log(
      `pod-disk-grow: telling ${pod.podSessionId} its disk is at ${percent}% of the ${args.ceilingGb} GB ceiling failed: ${failureText(failure)}`,
    )
    return skipped(`telling ${pod.podSessionId} about the ${args.ceilingGb} GB ceiling failed`)
  }
  await markNudged({ deps, pod, percent })
  return { outcome: EPodDiskGrowOutcome.Nudged, diskGb: args.ceilingGb, percent }
}

export const growPodDisk = async (args: {
  deps: PodDiskGrowDeps
  pod: PodDisk
  maxGb: number
}): Promise<PodDiskGrowDecision> => {
  const { deps, pod } = args
  if (pod.stale === true) return skipped('disk figures are stale')
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
    const ceilingGb = pod.sizeGb ?? limitGbOf(pod.limitBytes)
    if (ceilingGb >= args.maxGb) {
      return await ceilingDecisionOf({
        deps,
        pod,
        ceilingGb,
        usedBytes: pod.usedBytes,
        limitBytes: pod.limitBytes,
      })
    }
    return skipped(`nothing to grow from ${ceilingGb} GB`)
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
  const diskGbFrom = pod.sizeGb ?? limitGbOf(pod.limitBytes)
  await deps.grow({ instanceId: pod.instanceId, diskGb })
  await recordGrew({ deps, sessionId: pod.podSessionId, diskGb })
  await reportPodStarted({
    deps,
    sessionId: pod.podSessionId,
    diskGbFrom,
    diskGbTo: diskGb,
  })
  await noticeGrew({ deps, sessionId: pod.podSessionId, diskGb })
  return { outcome: EPodDiskGrowOutcome.Grown, diskGb }
}

const logDecision = (args: {
  log(line: string): void
  pod: PodDisk
  decision: PodDiskGrowDecision
}): void => {
  const { pod, decision } = args
  if (decision.outcome === EPodDiskGrowOutcome.Nudged) {
    args.log(
      `pod-disk-grow: told ${pod.podSessionId} its disk is at ${decision.percent ?? 0}% of the ${decision.diskGb ?? 0} GB ceiling`,
    )
    return
  }
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
  const summary: PodDiskGrowSummary = { checked: 0, grown: 0, waiting: 0, nudged: 0 }
  for (const pod of await args.deps.pods()) {
    summary.checked += 1
    try {
      const decision = await growPodDisk({ deps: args.deps, pod, maxGb: args.maxGb })
      if (decision.outcome === EPodDiskGrowOutcome.Grown) summary.grown += 1
      if (decision.outcome === EPodDiskGrowOutcome.Waiting) summary.waiting += 1
      if (decision.outcome === EPodDiskGrowOutcome.Nudged) summary.nudged += 1
      logDecision({ log: args.deps.log, pod, decision })
    } catch (failure) {
      args.deps.log(
        `pod-disk-grow: growing ${pod.instanceId} for ${pod.podSessionId} failed: ${failureText(failure)}`,
      )
    }
  }
  return summary
}
