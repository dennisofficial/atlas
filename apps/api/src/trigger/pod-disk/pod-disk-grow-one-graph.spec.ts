import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import {
  EPodDiskGrowOneOutcome,
  type PodDiskGrowOnePayload,
} from '../../agent/host/pod-disk-grow-one.contract'
import { runPodDiskGrowOne, POD_DISK_GROW_MAX_WAITS } from './pod-disk-grow-one-graph'

const GB = 2 ** 30

const payloadOf = (over: Partial<PodDiskGrowOnePayload> = {}): PodDiskGrowOnePayload => ({
  podSessionId: 'pod-1',
  usedBytes: 17 * GB,
  limitBytes: 20 * GB,
  urgent: false,
  ...over,
})

const fakeDeps = (args: {
  diskGb?: number
  state?: ESessionStatus
  instance?: boolean
  session?: boolean
}) => {
  const calls: string[] = []
  const requeued: Array<{ waits: number | undefined; delaySeconds: number }> = []
  const noticed: number[] = []
  const deps = {
    session: async () => {
      calls.push('session')
      return args.session === false ? undefined : { sandboxInstanceId: 'inst-1' }
    },
    instance: async () => {
      calls.push('instance')
      return args.instance === false ? undefined : { diskGb: args.diskGb ?? 20 }
    },
    facts: async () => {
      calls.push('facts')
      return {
        state: args.state ?? ESessionStatus.Idle,
        shellsRunning: 0,
        servicesRunning: 0,
        backgroundAgents: 0,
        terminalsHeld: 0,
        peersPlaced: 0,
        setupRunning: false,
      }
    },
    closeRun: async () => {
      calls.push('closeRun')
    },
    grow: async (growArgs: { instanceId: string; diskGb: number }) => {
      calls.push(`grow:${growArgs.instanceId}:${growArgs.diskGb}`)
    },
    requeue: async (requeueArgs: { payload: PodDiskGrowOnePayload; delaySeconds: number }) => {
      calls.push('requeue')
      requeued.push({ waits: requeueArgs.payload.waits, delaySeconds: requeueArgs.delaySeconds })
    },
    notice: async (noticeArgs: { sessionId: string; diskGb: number }) => {
      calls.push('notice')
      noticed.push(noticeArgs.diskGb)
    },
    log: () => undefined,
  }
  return { deps, calls, requeued, noticed }
}

describe('runPodDiskGrowOne', () => {
  it('grows a pod that is thinking, then tells the session why it restarted', async () => {
    const { deps, calls, noticed } = fakeDeps({ state: ESessionStatus.Thinking })
    expect(await runPodDiskGrowOne({ payload: payloadOf(), deps, maxGb: 100 })).toEqual({
      outcome: EPodDiskGrowOneOutcome.Grown,
      diskGb: 40,
    })
    expect(calls).toEqual(['session', 'instance', 'facts', 'closeRun', 'grow:inst-1:40', 'notice'])
    expect(noticed).toEqual([40])
  })

  it('doubles the instance disk, not the smaller filesystem size the pod reported', async () => {
    const { deps, calls } = fakeDeps({ state: ESessionStatus.Thinking, diskGb: 40 })
    expect(
      await runPodDiskGrowOne({
        payload: payloadOf({ usedBytes: 34 * GB, limitBytes: 42_091_216_896 }),
        deps,
        maxGb: 100,
      }),
    ).toEqual({ outcome: EPodDiskGrowOneOutcome.Grown, diskGb: 80 })
    expect(calls).toContain('grow:inst-1:80')
  })

  it('grows an urgent pod without reading what it is running', async () => {
    const { deps, calls } = fakeDeps({ state: ESessionStatus.RunningTool })
    await runPodDiskGrowOne({
      payload: payloadOf({ urgent: true, usedBytes: 19.5 * GB }),
      deps,
      maxGb: 100,
    })
    expect(calls).toEqual(['session', 'instance', 'closeRun', 'grow:inst-1:40', 'notice'])
  })

  it('is done when the instance already has the disk it was reported to need', async () => {
    const { deps, calls } = fakeDeps({ diskGb: 40 })
    expect(await runPodDiskGrowOne({ payload: payloadOf(), deps, maxGb: 100 })).toEqual({
      outcome: EPodDiskGrowOneOutcome.Superseded,
    })
    expect(calls).toEqual(['session', 'instance'])
  })

  it('requeues itself in ten seconds while a tool call holds the pod', async () => {
    const { deps, calls, requeued } = fakeDeps({ state: ESessionStatus.RunningTool })
    expect(await runPodDiskGrowOne({ payload: payloadOf(), deps, maxGb: 100 })).toEqual({
      outcome: EPodDiskGrowOneOutcome.Waiting,
    })
    expect(calls).toEqual(['session', 'instance', 'facts', 'requeue'])
    expect(requeued).toEqual([{ waits: undefined, delaySeconds: 10 }])
  })

  it('stops waiting at the cap and leaves the sweep as the net', async () => {
    const { deps, calls, requeued } = fakeDeps({ state: ESessionStatus.RunningTool })
    const payload = payloadOf({ waits: POD_DISK_GROW_MAX_WAITS })
    expect(await runPodDiskGrowOne({ payload, deps, maxGb: 100 })).toEqual({
      outcome: EPodDiskGrowOneOutcome.Waiting,
    })
    expect(calls).toEqual(['session', 'instance', 'facts'])
    expect(requeued).toEqual([])
  })

  it('does nothing for a session with no instance', async () => {
    const { deps, calls } = fakeDeps({ session: false })
    expect(await runPodDiskGrowOne({ payload: payloadOf(), deps, maxGb: 100 })).toEqual({
      outcome: EPodDiskGrowOneOutcome.Skipped,
    })
    expect(calls).toEqual(['session'])
  })

  it('does nothing when the instance is gone', async () => {
    const { deps, calls } = fakeDeps({ instance: false })
    expect(await runPodDiskGrowOne({ payload: payloadOf(), deps, maxGb: 100 })).toEqual({
      outcome: EPodDiskGrowOneOutcome.Skipped,
    })
    expect(calls).toEqual(['session', 'instance'])
  })

  it('does nothing for a report below the grow line', async () => {
    const { deps, calls } = fakeDeps({})
    expect(
      await runPodDiskGrowOne({
        payload: payloadOf({ usedBytes: 10 * GB }),
        deps,
        maxGb: 100,
      }),
    ).toEqual({ outcome: EPodDiskGrowOneOutcome.Skipped })
    expect(calls).toEqual([])
  })
})
