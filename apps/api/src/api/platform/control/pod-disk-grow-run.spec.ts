import { describe, expect, it } from 'bun:test'

import { runPodDiskGrow, type PodDisk, type PodDiskGrowDeps } from './pod-disk-grow-run'

const GB = 2 ** 30

const podOf = (args: { podSessionId: string; usedGb: number; limitGb: number }): PodDisk => ({
  podSessionId: args.podSessionId,
  instanceId: `inst-${args.podSessionId}`,
  usedBytes: args.usedGb * GB,
  limitBytes: args.limitGb * GB,
})

type FakeArgs = {
  pods: readonly PodDisk[]
  busy?: (podSessionId: string) => Promise<boolean | undefined>
  held?: (podSessionId: string) => Promise<boolean>
  grow?: (args: { instanceId: string; diskGb: number }) => Promise<void>
}

const fakeDeps = (args: FakeArgs) => {
  const calls: string[] = []
  const grown: Array<{ instanceId: string; diskGb: number }> = []
  const lines: string[] = []
  const deps: PodDiskGrowDeps = {
    pods: async () => args.pods,
    busy: async ({ podSessionId }) => {
      calls.push(`busy:${podSessionId}`)
      return await (args.busy ?? (async () => false))(podSessionId)
    },
    closeRun: async ({ podSessionId }) => {
      calls.push(`closeRun:${podSessionId}`)
    },
    grow: async (growArgs) => {
      calls.push(`grow:${growArgs.instanceId}:${growArgs.diskGb}`)
      await (args.grow ?? (async () => undefined))(growArgs)
      grown.push(growArgs)
    },
    held: async ({ podSessionId }) => {
      calls.push(`held:${podSessionId}`)
      return await (args.held ?? (async () => true))(podSessionId)
    },
    rewake: async ({ podSessionId }) => {
      calls.push(`rewake:${podSessionId}`)
    },
    log: (line) => lines.push(line),
  }
  return { deps, calls, grown, lines }
}

describe('runPodDiskGrow', () => {
  it('leaves a pod whose disk is under the threshold alone', async () => {
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

  it('waits for a busy pod instead of rebooting it mid-turn', async () => {
    const { deps, calls, grown, lines } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 16, limitGb: 20 })],
      busy: async () => true,
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 1,
    })
    expect(calls).toEqual(['busy:pod-1'])
    expect(grown).toEqual([])
    expect(lines.join('\n')).toContain('busy')
  })

  it('skips a pod whose session the control plane no longer has', async () => {
    const { deps, calls } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 16, limitGb: 20 })],
      busy: async () => undefined,
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 0,
    })
    expect(calls).toEqual(['busy:pod-1'])
  })

  it('closes the open run before growing, then re-wakes a held pod', async () => {
    const { deps, calls, grown } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 })],
      held: async () => true,
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 1,
      waiting: 0,
    })
    expect(calls).toEqual([
      'busy:pod-1',
      'closeRun:pod-1',
      'grow:inst-pod-1:30',
      'held:pod-1',
      'rewake:pod-1',
    ])
    expect(grown).toEqual([{ instanceId: 'inst-pod-1', diskGb: 30 }])
  })

  it('leaves a parked pod parked', async () => {
    const { deps, calls } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 52, limitGb: 64 })],
      held: async () => false,
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 1,
      waiting: 0,
    })
    expect(calls).toEqual(['busy:pod-1', 'closeRun:pod-1', 'grow:inst-pod-1:96', 'held:pod-1'])
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
    const { deps, grown, lines } = fakeDeps({
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
    expect(grown).toEqual([{ instanceId: 'inst-pod-2', diskGb: 30 }])
    expect(lines.join('\n')).toContain('a host move is in flight')
  })
})
