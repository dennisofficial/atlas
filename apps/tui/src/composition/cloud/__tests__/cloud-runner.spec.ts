import { beforeEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { EChannelConnection, ETurnStatus } from '@dltech/atlas-harness'

import { currentNotices, dismissNotice, ENoticeTone } from '../../../ui/notice-store'
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
    handleRowActive: (id) => calls.push(`active:${id}`),
    handleRowLabel: (args) => calls.push(`label:${args.nodeId}:${args.text}`),
    handleExpand: (args) =>
      calls.push(`expand:${args.row.id}:${args.heading ?? ''}`),
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
    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    const move = fakeMove()
    const archive = Buffer.from('a fake tar.gz')
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      move,
      captureContext: async () => archive,
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: null }])
    expect(bridge.contextPuts).toEqual([{ threadId: CLOUD_THREAD, archive }])
    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])
    expect(move.calls).toEqual([
      `begin:${EExecutionLocation.Cloud}`,
      'active:attaching',
      'settle',
    ])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-1') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-1') })
  })

  it('skips capturing and uploading the context archive when the sandbox resumed with it', async () => {
    const bridge = fakeBridge({ sandbox: RESUMED })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    let captureCalls = 0
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      captureContext: async () => {
        captureCalls += 1
        return Buffer.from('a fake tar.gz')
      },
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(captureCalls).toBe(0)
    expect(bridge.contextPuts).toEqual([])
    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-4') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-4') })
  })

  it('touches nothing move-shaped when no move control was given', async () => {
    const bridge = fakeBridge({ sandbox: CREATED })
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

  it('warns rather than failing the wake when the context re-upload fails', async () => {
    const bridge = fakeBridge({
      sandbox: CREATED,
      putContextFails: new Error('the control plane fell over'),
    })
    const channel = fakeCloudChannel()
    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    const move = fakeMove()
    const archive = Buffer.from('a fake tar.gz')
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId: CLOUD_THREAD,
      move,
      captureContext: async () => archive,
    })

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(bridge.contextPuts).toEqual([{ threadId: CLOUD_THREAD, archive }])
    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])
    expect(move.calls.some((call) => call.startsWith('fail:'))).toBe(false)
    const notice = currentNotices().find((entry) => entry.key === 'wake-context-put-failed')
    expect(notice).toBeDefined()
    expect(notice?.tone).toBe(ENoticeTone.Warn)
    expect(notice?.text).toContain('the control plane fell over')

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-3') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-3') })
  })

  it('expands the drawer with a rotation step when the wake rotates a build-drifted sandbox', async () => {
    const bridge = fakeBridge({
      sandbox: { ...RESUMED, rotatedFrom: '1.19.1' },
    })
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

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(move.calls).toEqual([
      `begin:${EExecutionLocation.Cloud}`,
      `expand:rotating:UPDATING THE CLOUD SANDBOX`,
      'active:attaching',
      'settle',
    ])
    expect(channel.woken).toEqual([{ url: POLLED_URL, token: 'sandbox-token' }])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-5') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-5') })
  })

  it('expands the drawer with a rotation step when the wake rotates the sandbox', async () => {
    const bridge = fakeBridge({
      sandbox: { ...RESUMED, rotatedProtocol: 11 },
    })
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

    const turn = runner.runTurn({ threadId: CLOUD_THREAD })
    await Bun.sleep(1)

    expect(move.calls).toEqual([
      `begin:${EExecutionLocation.Cloud}`,
      `expand:rotating:UPDATING THE CLOUD SANDBOX`,
      'active:attaching',
      'settle',
    ])

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-6') })
    await expect(turn).resolves.toEqual({ status: ETurnStatus.Completed, runId: toRunId('run-6') })
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
      'fail:no capacity in iad1',
    ])
    expect(channel.woken).toEqual([])
    expect(channel.runs).toBe(0)
  })
})
