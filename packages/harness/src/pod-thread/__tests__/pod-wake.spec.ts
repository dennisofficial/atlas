import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { ESettleWait } from '@dltech/atlas-wire'

import { createPodWake } from '../pod-wake'
import { fakeSandboxes, fakeWakeChannel, recordingNarration, RUNNING_POD } from './pod-fakes'

const THREAD = toThreadId('brn_pod')

const deferred = () => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('waking a pod', () => {
  it('provisions with the thread project and dials the channel with the fresh url and token', async () => {
    const sandboxes = fakeSandboxes()
    const channel = fakeWakeChannel()
    const wake = createPodWake({
      bridge: { sandboxes },
      channel,
      threadId: THREAD,
      projectId: 'proj_1',
    })

    await wake()

    expect(sandboxes.created).toEqual([{ threadId: THREAD, projectId: 'proj_1' }])
    expect(channel.woken).toEqual([{ url: RUNNING_POD.url, token: RUNNING_POD.token }])
  })

  it('narrates begin, attaching and settled around a plain wake', async () => {
    const narration = recordingNarration()
    const wake = createPodWake({
      bridge: { sandboxes: fakeSandboxes() },
      channel: fakeWakeChannel(),
      threadId: THREAD,
      projectId: null,
      narration,
    })

    await wake()

    expect(narration.calls).toEqual(['begin', 'attaching', 'settled'])
  })

  it('tells the channel and the narration when the wake rotates the pod', async () => {
    const narration = recordingNarration()
    const channel = fakeWakeChannel()
    const wake = createPodWake({
      bridge: { sandboxes: fakeSandboxes({ rotates: true }) },
      channel,
      threadId: THREAD,
      projectId: null,
      narration,
    })

    await wake()

    expect(channel.rotations).toBe(1)
    expect(narration.calls).toEqual(['begin', 'rotating', 'attaching', 'settled'])
  })

  it('narrates a provider settle wait as it happens', async () => {
    const narration = recordingNarration()
    const wake = createPodWake({
      bridge: {
        sandboxes: fakeSandboxes({
          settleWait: { reason: ESettleWait.NameConflict, attempt: 2, attempts: 5 },
        }),
      },
      channel: fakeWakeChannel(),
      threadId: THREAD,
      projectId: null,
      narration,
    })

    await wake()

    expect(narration.calls).toContain('settle-wait:2/5')
  })

  it('narrates the failure and rejects when the pod cannot be provisioned', async () => {
    const narration = recordingNarration()
    const channel = fakeWakeChannel()
    const wake = createPodWake({
      bridge: { sandboxes: fakeSandboxes({ createFails: new Error('no capacity in iad1') }) },
      channel,
      threadId: THREAD,
      projectId: null,
      narration,
    })

    await expect(wake()).rejects.toThrow('no capacity in iad1')

    expect(narration.calls).toEqual(['begin', 'failed:no capacity in iad1'])
    expect(channel.woken).toEqual([])
  })

  it('joins a wake already in flight instead of provisioning twice', async () => {
    const gate = deferred()
    const sandboxes = fakeSandboxes({ gate: gate.promise })
    const wake = createPodWake({
      bridge: { sandboxes },
      channel: fakeWakeChannel(),
      threadId: THREAD,
      projectId: null,
    })

    const first = wake()
    const second = wake()
    gate.resolve()
    await Promise.all([first, second])

    expect(sandboxes.created).toHaveLength(1)
  })

  it('provisions again once the previous wake has finished', async () => {
    const sandboxes = fakeSandboxes()
    const wake = createPodWake({
      bridge: { sandboxes },
      channel: fakeWakeChannel(),
      threadId: THREAD,
      projectId: null,
    })

    await wake()
    await wake()

    expect(sandboxes.created).toHaveLength(2)
  })
})
