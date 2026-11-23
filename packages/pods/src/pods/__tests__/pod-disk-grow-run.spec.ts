import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import { type PodDiskSweepDeps, runPodDiskGrow } from '../pod-disk-grow-run'
import { factsOf, fakeDeps, podOf } from './pod-disk-grow-run.fixtures'

describe('runPodDiskGrow', () => {
  it('leaves a pod whose disk is under the threshold alone, without reading its session', async () => {
    const { deps, calls } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 13, limitGb: 20 })],
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

  it('waits for a background setup script that runs while the session is idle', async () => {
    const { deps, calls, lines } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 })],
      facts: async () => factsOf({ state: ESessionStatus.Idle, setupRunning: true }),
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 1,
    })
    expect(calls).toEqual(['facts:pod-1'])
    expect(lines.join('\n')).toContain('setup')
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
    expect(calls).toEqual([
      'facts:pod-1',
      'closeRun:pod-1',
      'grow:inst-pod-1:40',
      'recordDisk:pod-1:40',
      'notice:pod-1:40',
    ])
    expect(lines.join('\n')).toContain('grew inst-pod-1 for pod-1 to 40 GB')
  })

  it('grows an urgent pod at once, whatever it is running', async () => {
    const { deps, calls } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 19.5, limitGb: 20 })],
      facts: async () =>
        factsOf({
          state: ESessionStatus.RunningTool,
          setupRunning: true,
          shellsRunning: 3,
          peersPlaced: 1,
        }),
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 1,
      waiting: 0,
    })
    expect(calls).toEqual([
      'closeRun:pod-1',
      'grow:inst-pod-1:40',
      'recordDisk:pod-1:40',
      'notice:pod-1:40',
    ])
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
      recordDisk: async () => {
        order.push('recordDisk')
      },
      notice: async () => {
        order.push('notice')
      },
      log: () => undefined,
    }
    await runPodDiskGrow({ deps, maxGb: 100 })
    expect(order).toEqual(['closeRun', 'grow', 'recordDisk', 'notice'])
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

  it('skips a pod whose disk figures are stale, and says so', async () => {
    const { deps, calls, lines } = fakeDeps({
      pods: [
        {
          podSessionId: 'pod-1',
          instanceId: 'inst-pod-1',
          usedBytes: undefined,
          limitBytes: undefined,
          stale: true,
        },
      ],
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 0,
      waiting: 0,
    })
    expect(calls).toEqual([])
    expect(lines.join('\n')).toContain('disk figures are stale')
  })

  it('counts the grow as done when the notice fails, and logs the notice failure', async () => {
    const { deps, lines } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 })],
      facts: async () => factsOf({ state: ESessionStatus.Idle }),
      notice: async () => {
        throw new Error('inbox is down')
      },
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 1,
      waiting: 0,
    })
    expect(lines.join('\n')).toContain('inbox is down')
  })

  it('counts the grow as done when recording the disk fails, and logs it', async () => {
    const { deps, lines } = fakeDeps({
      pods: [podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 })],
      facts: async () => factsOf({ state: ESessionStatus.Idle }),
      recordDisk: async () => {
        throw new Error('the row is locked')
      },
    })
    expect(await runPodDiskGrow({ deps, maxGb: 100 })).toEqual({
      checked: 1,
      grown: 1,
      waiting: 0,
    })
    expect(lines.join('\n')).toContain('the row is locked')
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
