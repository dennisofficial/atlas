import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import {
  EPodDiskGrowOutcome,
  growPodDisk,
  runPodDiskGrow,
  type PodDisk,
  type PodDiskSweepDeps,
} from './pod-disk-grow-run'

const GB = 2 ** 30

const podOf = (args: { podSessionId: string; usedGb?: number; limitGb?: number }): PodDisk => ({
  podSessionId: args.podSessionId,
  instanceId: `inst-${args.podSessionId}`,
  usedBytes: args.usedGb === undefined ? undefined : args.usedGb * GB,
  limitBytes: args.limitGb === undefined ? undefined : args.limitGb * GB,
})

type FakeArgs = {
  pods: readonly PodDisk[]
  facts?: (podSessionId: string) => Promise<Parameters<typeof factsOf>[0] | undefined>
  grow?: (args: { instanceId: string; diskGb: number }) => Promise<void>
}

const factsOf = (over: {
  state?: ESessionStatus
  shellsRunning?: number
  servicesRunning?: number
  backgroundAgents?: number
  terminalsHeld?: number
  peersPlaced?: number
}) => ({
  state: over.state,
  shellsRunning: over.shellsRunning ?? 0,
  servicesRunning: over.servicesRunning ?? 0,
  backgroundAgents: over.backgroundAgents ?? 0,
  terminalsHeld: over.terminalsHeld ?? 0,
  peersPlaced: over.peersPlaced ?? 0,
})

const fakeDeps = (args: FakeArgs) => {
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
    log: (line) => lines.push(line),
  }
  return { deps, calls, lines }
}

describe('runPodDiskGrow', () => {
  it('leaves a pod whose disk is under the threshold alone, without reading its session', async () => {
    const { deps, calls } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 15, limitGb: 20 })],
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 0,
    })
    expect(calls).toEqual([])
  })

  it('waits for a pod in the middle of a tool call', async () => {
    const { deps, calls, lines } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 })],
      facts: async () => factsOf({ state: ESessionStatus.RunningTool }),
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 1,
    })
    expect(calls).toEqual(['facts:pod-1'])
    expect(lines.join('\n')).toContain('running-tool')
  })

  it('grows under a thinking turn, which does not live in the pod', async () => {
    const { deps, calls, lines } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 })],
      facts: async () => factsOf({ state: ESessionStatus.Thinking }),
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 1,
      waiting: 0,
    })
    expect(calls).toEqual(['facts:pod-1', 'closeRun:pod-1', 'grow:inst-pod-1:40'])
    expect(lines.join('\n')).toContain('grew inst-pod-1 for pod-1 to 40 GB')
  })

  it('grows an urgent pod at once, whatever it is running', async () => {
    const { deps, calls } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 19.5, limitGb: 20 })],
      facts: async () =>
        factsOf({ state: ESessionStatus.RunningTool, shellsRunning: 3, peersPlaced: 1 }),
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 1,
      waiting: 0,
    })
    expect(calls).toEqual(['closeRun:pod-1', 'grow:inst-pod-1:40'])
  })

  it('closes the open run with the sandbox stopped before it grows, and never revokes', async () => {
    const order: string[] = []
    const deps: PodDiskSweepDeps = {
      pods: async () => [podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 })],
      facts: async () => factsOf({ state: ESessionStatus.Idle }),
      closeRun: async () => {
        order.push('closeRun')
      },
      grow: async () => {
        order.push('grow')
      },
      log: () => undefined,
    }
    await runPodDiskGrow({ deps, maxGb: 100 })
    expect(order).toEqual(['closeRun', 'grow'])
  })

  it('skips a pod whose Agent37 metrics are still empty, and says so', async () => {
    const { deps, calls, lines } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1' })],
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 0,
    })
    expect(calls).toEqual([])
    expect(lines.join('\n')).toContain('no disk figures yet')
  })

  it('skips a pod whose session the control plane no longer has', async () => {
    const { deps, calls } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 })],
      facts: async () => undefined,
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 0,
    })
    expect(calls).toEqual(['facts:pod-1'])
  })

  it('leaves a pod already at the biggest disk alone', async () => {
    const { deps, calls } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 92, limitGb: 100 })],
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 0,
    })
    expect(calls).toEqual([])
  })

  it('carries on to the next pod when one fails', async () => {
    const { deps, lines } = fakeDeps({
      pods: [
        podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 }),
        podOf({ podSessionId: 'pod-2', usedGb: 18, limitGb: 20 }),
      ],
      grow: async ({ instanceId }) => {
        if (instanceId === 'inst-pod-1') throw new Error('a host move is in flight')
      },
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 2,
      grown: 1,
      waiting: 0,
    })
    expect(lines.join('\n')).toContain('a host move is in flight')
  })
})

describe('growPodDisk', () => {
  it('reports the decision a single pod earns on its own', async () => {
    const { deps } = fakeDeps({
      pods: [],
      facts: async () => factsOf({ state: ESessionStatus.WaitingToRetry }),
    })
    expect(
      await growPodDisk({
        deps,
        pod: podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 }),
        maxGb: 100,
      }),
    ).toEqual({ outcome: EPodDiskGrowOutcome.Grown, diskGb: 40 })
  })
})
