import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-harness'

import { descend, localHome, said, seedCloud } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

describe('bringing the cloud workspace home', () => {
  it('merges the ref the sandbox published into the local tree', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['work happened in the cloud'])
    const home = localHome({
      events: [said({ seq: 1, text: 'work happened in the cloud' })],
    })

    bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' })
    const channel = bridge.channel
    let publishCalls = 0
    channel.request = async (args) => {
      if (args.op === EClientRequest.PublishWorkspace) {
        publishCalls += 1
        return {
          ref: 'refs/atlas/descend/cloud-thread-0123456789ab',
          commit: '0123456789abcdef',
          base: 'ba51e1e0',
        }
      }
      return null
    }
    const merged: { cwd: string; ref: string; base: string | null }[] = []

    await descend({
      bridge,
      home,
      channel,
      mergeWorkspace: async (args) => {
        merged.push(args)
        return { conflicts: [] }
      },
    })

    expect(publishCalls).toBe(1)
    expect(merged).toEqual([
      { cwd: '/work', ref: 'refs/atlas/descend/cloud-thread-0123456789ab', base: 'ba51e1e0' },
    ])
    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(events.at(-1)?.type).toBe('location-changed')
  })

  it('skips the workspace merge when the cloud has nothing to send home', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['clean cloud session'])
    const home = localHome({ events: [said({ seq: 1, text: 'clean cloud session' })] })

    bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' })
    const channel = bridge.channel
    let publishCalls = 0
    channel.request = async (args) => {
      if (args.op === EClientRequest.PublishWorkspace) publishCalls += 1
      return null
    }

    await descend({
      bridge,
      home,
      channel,
      mergeWorkspace: async () => {
        throw new Error('nothing to send home means nothing to merge')
      },
    })

    expect(publishCalls).toBe(1)
    expect(
      (await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Host)
  })

  it('announces in the log when the merge leaves conflict markers behind', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['both sides edited'])
    const home = localHome({ events: [said({ seq: 1, text: 'both sides edited' })] })

    bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' })
    const channel = bridge.channel
    channel.request = async () => ({
      ref: 'refs/atlas/descend/cloud-thread-0123456789ab',
      commit: '0123456789abcdef',
      base: null,
    })

    await descend({
      bridge,
      home,
      channel,
      mergeWorkspace: async () => ({ conflicts: ['app.ts', 'lib.ts'] }),
    })

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    const notice = events.find((event) => event.type === 'context-loaded')
    expect(notice).toBeDefined()
    expect(JSON.stringify(notice)).toContain('app.ts')
    expect(JSON.stringify(notice)).toContain('lib.ts')
    expect(
      (await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Host)
  })

  it('leaves the conversation in the cloud when the workspace would not publish', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['stuck in the cloud'])
    const home = localHome({ events: [said({ seq: 1, text: 'stuck in the cloud' })] })

    bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' })
    const channel = bridge.channel
    channel.request = async () => {
      throw new Error('the workspace would not push home: non-fast-forward')
    }

    await expect(
      descend({
        bridge,
        home,
        channel,
        mergeWorkspace: async () => {
          throw new Error('nothing published means nothing to merge')
        },
      }),
    ).rejects.toThrow('would not push home')
    expect(
      (await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Cloud)
  })
})
