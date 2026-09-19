import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { EChannelConnection, ETurnStatus } from '@dltech/atlas-harness'

import type { ContainerMoveControl } from '../../use-container-move'
import { createCloudRunner } from '../cloud-runner'
import { ECloudSandboxState } from '../cloud-bridge'
import { ELiftStep } from '../lift'
import { CLOUD_THREAD, fakeBridge, fakeCloudChannel } from './fixture'

type FakeMove = ContainerMoveControl & { readonly calls: readonly string[] }

const fakeMove = (): FakeMove => {
  const calls: string[] = []
  return {
    move: null,
    now: 0,
    handleBegin: (args) => calls.push(`begin:${args.target}`),
    handleAdvance: (step) => calls.push(`advance:${step}`),
    handleSettle: () => calls.push('settle'),
    handleFail: (reason) => calls.push(`fail:${reason}`),
    handleDismiss: () => calls.push('dismiss'),
    handleKey: () => calls.push('key'),
    get calls() {
      return calls
    },
  }
}

const POLLED_URL = 'https://polled.example/thread'

describe('waking a cloud runner whose channel is not open', () => {
  it('re-provisions, polls, and wakes the channel with the fresh url and token', async () => {
    const bridge = fakeBridge({ status: { state: ECloudSandboxState.Running, url: POLLED_URL } })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    const move = fakeMove()
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      move,
      captureContext: async () => 'bundle-json',
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(bridge.created).toEqual([
      { threadId: CLOUD_THREAD, workspace: null, contextBundle: 'bundle-json' },
    ])
    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])
    expect(move.calls).toEqual([
      `begin:${EExecutionLocation.Cloud}`,
      `advance:${ELiftStep.Starting}`,
      `advance:${ELiftStep.Attaching}`,
      'settle',
    ])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-1') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-1') })
  })

  it('touches nothing move-shaped when no move control was given', async () => {
    const bridge = fakeBridge({ status: { state: ECloudSandboxState.Running, url: POLLED_URL } })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      captureContext: async () => undefined,
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-2') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-2') })
  })

  it('fails the move and propagates the error when waking cannot re-provision the sandbox', async () => {
    const bridge = fakeBridge({ createFails: new Error('no capacity in iad1') })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    const move = fakeMove()
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      move,
      captureContext: async () => undefined,
    })

    await expect(runner.runTurn({ threadId: CLOUD_THREAD })).rejects.toThrow('no capacity in iad1')

    expect(move.calls).toEqual([
      `begin:${EExecutionLocation.Cloud}`,
      `advance:${ELiftStep.Starting}`,
      'fail:no capacity in iad1',
    ])
    expect(channel.woken).toEqual([])
    expect(channel.runs).toBe(0)
  })
})
