import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { RemoteSessionActivity } from '../../activity/remote-session-activity'
import { EResizeApplies } from '../cloud-bridge'
import { podNameFor } from '../local-pod/pod-create'
import { ECloudSandboxState } from '../sandbox-client'
import { fakePodDriver, podBridgeWith } from './local-pod-bridge-fixture'

const threadId = toThreadId('thread-pod-ops')
const name = podNameFor({ threadId })

describe('createLocalPodBridge attach', () => {
  it('hands back the channel, remote stores and registered activity reader', () => {
    const { driver } = fakePodDriver({ created: false })
    const bridge = podBridgeWith({ driver })

    const attachment = bridge.attach({ threadId, url: 'http://127.0.0.1:1', token: 'tok' })

    expect(typeof attachment.channel.send).toBe('function')
    expect(Object.keys(attachment.stores).sort()).toEqual(['activity', 'ledger', 'log', 'threads'])
    expect(attachment.stores.activity).toBeInstanceOf(RemoteSessionActivity)
    attachment.channel.close?.()
  })
})

describe('createLocalPodBridge pass-through', () => {
  it('destroys the pod by name, forwarding the fence', async () => {
    const { driver, destroyed } = fakePodDriver({ created: false })

    await podBridgeWith({ driver }).sandboxes.destroy({
      threadId,
      expectedSandboxSessionId: 'session-1',
    })

    expect(destroyed).toEqual([{ name, sessionId: 'session-1' }])
  })

  it('reads resources from the driver', async () => {
    const { driver } = fakePodDriver({ created: false })

    expect(await podBridgeWith({ driver }).sandboxes.readResources({ threadId })).toEqual({
      vcpus: 2,
      memoryMb: 4096,
    })
  })

  it('resizes live and says so', async () => {
    const { driver, resized } = fakePodDriver({ created: false })

    const answer = await podBridgeWith({ driver }).sandboxes.updateResources({ threadId, vcpus: 4 })

    expect(answer).toEqual({ appliesAt: EResizeApplies.Live })
    expect(resized).toEqual([{ name, vcpus: 4 }])
  })

  it('finds a missing pod as stopped with no checkpoint', async () => {
    const { driver } = fakePodDriver({ created: false })

    expect(await podBridgeWith({ driver }).sandboxes.find({ threadId })).toEqual({
      state: ECloudSandboxState.Stopped,
      checkpoint: null,
    })
  })

  it('maps an observed pod through with no checkpoint', async () => {
    const { driver } = fakePodDriver({ created: false })
    driver.inspect = async () => ({ state: 'running', url: 'http://127.0.0.1:20111' })

    expect(await podBridgeWith({ driver }).sandboxes.find({ threadId })).toEqual({
      state: ECloudSandboxState.Running,
      url: 'http://127.0.0.1:20111',
      checkpoint: null,
    })
  })
})
