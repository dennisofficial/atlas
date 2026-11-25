import { ESessionStatus, type PodRebootFacts } from '@dltech/atlas-core'

import { type PodDisk, type PodDiskSweepDeps } from '../pod-disk-grow-run'

const GB = 2 ** 30

export const podOf = (args: {
  podSessionId: string
  usedGb?: number
  limitGb?: number
  nudgedPercent?: number
}): PodDisk => ({
  podSessionId: args.podSessionId,
  instanceId: `inst-${args.podSessionId}`,
  usedBytes: args.usedGb === undefined ? undefined : args.usedGb * GB,
  limitBytes: args.limitGb === undefined ? undefined : args.limitGb * GB,
  ...(args.nudgedPercent === undefined ? {} : { nudgedPercent: args.nudgedPercent }),
})

type FakeArgs = {
  pods: readonly PodDisk[]
  facts?: (podSessionId: string) => Promise<PodRebootFacts | undefined>
  grow?: (args: { instanceId: string; diskGb: number }) => Promise<void>
  recordDisk?: (args: { sessionId: string; diskGb: number }) => Promise<void>
  started?: (args: { sessionId: string; diskGbFrom: number; diskGbTo: number }) => Promise<void>
  notice?: (args: { sessionId: string; diskGb: number }) => Promise<void>
  ceilingNotice?: (args: {
    sessionId: string
    usedBytes: number
    limitBytes: number
    percent: number
  }) => Promise<void>
  markNudged?: (args: {
    instanceId: string
    podSessionId: string
    percent: number | undefined
  }) => Promise<void>
}

export const factsOf = (over: {
  state?: ESessionStatus
  setupRunning?: boolean
  shellsRunning?: number
  servicesRunning?: number
  backgroundAgents?: number
  terminalsHeld?: number
  peersPlaced?: number
}): PodRebootFacts => ({
  state: over.state,
  setupRunning: over.setupRunning ?? false,
  shellsRunning: over.shellsRunning ?? 0,
  servicesRunning: over.servicesRunning ?? 0,
  backgroundAgents: over.backgroundAgents ?? 0,
  terminalsHeld: over.terminalsHeld ?? 0,
  peersPlaced: over.peersPlaced ?? 0,
})

export const fakeDeps = (args: FakeArgs) => {
  const calls: string[] = []
  const lines: string[] = []
  const deps: PodDiskSweepDeps = {
    pods: async () => args.pods,
    facts: async ({ podSessionId }) => {
      calls.push(`facts:${podSessionId}`)
      return await (args.facts ?? (async () => factsOf({ state: ESessionStatus.Idle })))(
        podSessionId,
      )
    },
    closeRun: async ({ podSessionId }) => {
      calls.push(`closeRun:${podSessionId}`)
    },
    grow: async (growArgs) => {
      calls.push(`grow:${growArgs.instanceId}:${growArgs.diskGb}`)
      await (args.grow ?? (async () => undefined))(growArgs)
    },
    recordDisk: async (recordArgs) => {
      calls.push(`recordDisk:${recordArgs.sessionId}:${recordArgs.diskGb}`)
      await (args.recordDisk ?? (async () => undefined))(recordArgs)
    },
    started: async (startedArgs) => {
      await (args.started ?? (async () => undefined))(startedArgs)
    },
    notice: async (noticeArgs) => {
      calls.push(`notice:${noticeArgs.sessionId}:${noticeArgs.diskGb}`)
      await (args.notice ?? (async () => undefined))(noticeArgs)
    },
    ceilingNotice: async (ceilingArgs) => {
      calls.push(`ceilingNotice:${ceilingArgs.sessionId}:${ceilingArgs.percent}`)
      await (args.ceilingNotice ?? (async () => undefined))(ceilingArgs)
    },
    markNudged: async (markArgs) => {
      calls.push(
        `markNudged:${markArgs.instanceId}:${markArgs.percent === undefined ? 'clear' : markArgs.percent}`,
      )
      await (args.markNudged ?? (async () => undefined))(markArgs)
    },
    log: (line) => lines.push(line),
  }
  return { deps, calls, lines }
}
