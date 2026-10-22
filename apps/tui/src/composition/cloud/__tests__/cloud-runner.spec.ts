import { beforeEach, describe, expect, it } from 'vitest'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { EConnectionView, ETurnStatus } from '@dltech/atlas-harness'

import { dismissNotice } from '../../../ui/notice-store'
import type { ContainerMoveControl } from '../../use-container-move'
import { createCloudRunner } from '../cloud-runner'
import { ECloudSandboxState } from '@dltech/atlas-harness'
import { CLOUD_THREAD, fakeBridge, fakeCloudChannel } from './fixture'

beforeEach(() => {
  dismissNotice()
})

type FakeMove = ContainerMoveControl & { readonly calls: readonly string[] }

const fakeMove = (): FakeMove => {
  const calls: string[] = []
  return {
    move: null,
    now: 0,
    handleBegin: (args) => calls.push(`begin:${args.target}`),
    handleNodeStart: (nodeId) => calls.push(`start:${nodeId}`),
    handleNodeDone: (nodeId) => calls.push(`done:${nodeId}`),
    handleCancel: () => calls.push('cancel'),
    handleTransferProgress: (progress) =>
      calls.push(`transfer:${progress.nodeId}:${progress.transferId}`),
    handleRowActive: (id) => calls.push(`active:${id}`),
    handleRowLabel: (args) => calls.push(`label:${args.nodeId}:${args.text}`),
    handleExpand: (args) => calls.push(`expand:${args.row.id}:${args.heading ?? ''}`),
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

const RESUMED = {
  url: POLLED_URL,
  token: 'sandbox-token',
  state: ECloudSandboxState.Running,
  created: false,
} as const

const CREATED = { ...RESUMED, created: true } as const

describe('waking a cloud runner whose channel is not open', () => {
  it('re-provisions and wakes the channel with the fresh url and token', async () => {
    const bridge = fakeBridge({ sandbox: CREATED })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EConnectionView.Disconnected, detail: null })
    const move = fakeMove()
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      projectId: null,
      move,
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(bridge.created).toEqual([{ threadId: CLOUD_THREAD, projectId: null }])
    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])
    expect(move.calls).toEqual([`begin:${EExecutionLocation.Cloud}`, 'active:attaching', 'settle'])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-1') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-1') })
  })

  it('re-provisions with the project the thread was born on', async () => {
    const bridge = fakeBridge({ sandbox: CREATED })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EConnectionView.Disconnected, detail: null })
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      projectId: 'proj_1',
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(bridge.created).toEqual([{ threadId: CLOUD_THREAD, projectId: 'proj_1' }])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-p') })
    await turn
  })

  it('touches nothing move-shaped when no move control was given', async () => {
    const bridge = fakeBridge({ sandbox: CREATED })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EConnectionView.Disconnected, detail: null })
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      projectId: null,
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-2') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-2') })
  })

  it('expands the drawer with a rotation step when the wake rotates a build-drifted sandbox', async () => {
    const bridge = fakeBridge({
      sandbox: { ...RESUMED, rotatedFrom: '1.19.1' },
    })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EConnectionView.Disconnected, detail: null })
    const views: EConnectionView[] = []
    channel.onConnection((view) => views.push(view.state))
    const move = fakeMove()
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      projectId: null,
      move,
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(move.calls).toEqual([
      `begin:${EExecutionLocation.Cloud}`,
      `expand:rotating:UPDATING THE POD`,
      'active:attaching',
      'settle',
    ])
    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])
    expect(views).toEqual([EConnectionView.Waking, EConnectionView.Updating])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-5') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-5') })
  })

  it('expands the drawer with a rotation step when the wake rotates the sandbox', async () => {
    const bridge = fakeBridge({
      sandbox: { ...RESUMED, rotatedProtocol: 11 },
    })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EConnectionView.Disconnected, detail: null })
    const move = fakeMove()
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      projectId: null,
      move,
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(move.calls).toEqual([
      `begin:${EExecutionLocation.Cloud}`,
      `expand:rotating:UPDATING THE POD`,
      'active:attaching',
      'settle',
    ])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-6') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-6') })
  })

  it('fails the move and propagates the error when waking cannot re-provision the sandbox', async () => {
    const bridge = fakeBridge({ createFails: new Error('no capacity in iad1') })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EConnectionView.Disconnected, detail: null })
    const move = fakeMove()
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      projectId: null,
      move,
    })

    await expect(runner.runTurn({ threadId: CLOUD_THREAD })).rejects.toThrow('no capacity in iad1')

    expect(move.calls).toEqual([`begin:${EExecutionLocation.Cloud}`, 'fail:no capacity in iad1'])
    expect(channel.woken).toEqual([])
    expect(channel.runs).toBe(0)
  })
})
