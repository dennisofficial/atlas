import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EClientRequest } from '../../channel-wire'

import { cloudArchiveOf, descend, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const homeWithArchive = async (
  texts: readonly string[],
): Promise<{ home: ReturnType<typeof useDescendHome>; bridge: ReturnType<typeof fakeBridge> }> => {
  const home = useDescendHome()
  const archive = await cloudArchiveOf([{ drafts: texts.map(said) }])
  return { home, bridge: fakeBridge({ archive }) }
}

describe('bringing the cloud workspace home', () => {
  it('merges the ref the sandbox published into the local tree', async () => {
    const { home, bridge } = await homeWithArchive(['work happened in the cloud'])
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const served = channel.request.bind(channel)
    let publishCalls = 0
    channel.request = async (args) => {
      if (args.op === EClientRequest.PublishWorkspace) {
        publishCalls += 1
        return {
          ref: 'refs/atlas/descend/cloud-thread-0123456789ab',
          commit: '0123456789abcdef',
          base: 'ba51e1e0',
          baseTree: '7ee1ab1e',
          branch: 'dennis/feature',
        }
      }
      return served(args)
    }
    const merged: {
      cwd: string
      ref: string
      base: string | null
      baseTree: string | null
      branch: string | null
    }[] = []

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
      {
        cwd: '/work',
        ref: 'refs/atlas/descend/cloud-thread-0123456789ab',
        base: 'ba51e1e0',
        baseTree: '7ee1ab1e',
        branch: 'dennis/feature',
      },
    ])
    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(events.at(-1)?.type).toBe('location-changed')
  })

  it('skips the workspace merge when the cloud has nothing to send home', async () => {
    const { home, bridge } = await homeWithArchive(['clean cloud session'])
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel

    await descend({
      bridge,
      home,
      channel,
      mergeWorkspace: async () => {
        throw new Error('nothing to send home means nothing to merge')
      },
    })

    const publishes = channel.requests.filter(
      (entry) => entry.op === EClientRequest.PublishWorkspace,
    )
    expect(publishes).toHaveLength(1)
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
  })

  it('announces in the log when the merge leaves conflict markers behind', async () => {
    const { home, bridge } = await homeWithArchive(['both sides edited'])
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const served = channel.request.bind(channel)
    channel.request = async (args) => {
      if (args.op === EClientRequest.PublishWorkspace) {
        return {
          ref: 'refs/atlas/descend/cloud-thread-0123456789ab',
          commit: '0123456789abcdef',
          base: null,
        }
      }
      return served(args)
    }

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
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
  })

  it('tells the log when the host branch was superseded by origin while away', async () => {
    const { home, bridge } = await homeWithArchive(['shipped from the cloud'])
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const served = channel.request.bind(channel)
    channel.request = async (args) => {
      if (args.op === EClientRequest.PublishWorkspace) {
        return {
          ref: 'refs/atlas/descend/cloud-thread-0123456789ab',
          commit: '0123456789abcdef',
          base: 'ba51e1e0',
          baseTree: '7ee1ab1e',
          branch: 'dennis/feature',
        }
      }
      return served(args)
    }

    await descend({
      bridge,
      home,
      channel,
      mergeWorkspace: async () => ({
        conflicts: [],
        superseded: { branch: 'dennis/feature', localTip: 'ba51e1e0123456', originTip: 'ff0011223344' },
      }),
    })

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    const notice = events.find((event) => event.type === 'context-loaded')
    expect(notice).toBeDefined()
    expect(JSON.stringify(notice)).toContain('superseded by origin/dennis/feature')
    expect(JSON.stringify(notice)).toContain('git reset --hard origin/dennis/feature')
  })

  it('leaves the conversation in the cloud when the workspace would not publish', async () => {
    const { home, bridge } = await homeWithArchive(['stuck in the cloud'])
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const served = channel.request.bind(channel)
    channel.request = async (args) => {
      if (args.op === EClientRequest.PublishWorkspace) {
        throw new Error('the workspace would not push home: non-fast-forward')
      }
      return served(args)
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
    const row = await home.threads.find({ threadId: CLOUD_THREAD })
    expect(row?.executionLocation ?? EExecutionLocation.Cloud).toBe(EExecutionLocation.Cloud)
  })
})
