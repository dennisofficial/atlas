import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { PlacementController } from '../../../composition/placement-controller'
import { EClientRequest } from '../../channel-wire'
import { cloudArchiveOf, descend, fakeSurface, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

describe('failed descend ownership', () => {
  it('keeps the cloud owner and allows retry when the workspace cannot be transferred', async () => {
    const home = useDescendHome()
    await home.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: home.ids.nextRunId(),
      executionLocation: EExecutionLocation.Cloud,
      drafts: [{ type: 'user-said', text: 'keep my cloud work' }],
    })
    const placement = new PlacementController(EExecutionLocation.Cloud)
    placement.bind({ threads: home.threads, workspace: '/work', repo: '/work' })
    await placement.activate({ threadId: CLOUD_THREAD })
    const archive = await cloudArchiveOf([{ drafts: [{ type: 'user-said', text: 'keep my cloud work' }] }])
    const bridge = fakeBridge({ archive })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const request = channel.request.bind(channel)
    let transferFails = true
    channel.request = async (args) => {
      if (args.op === EClientRequest.PrepareWorkspaceArchive && transferFails) {
        throw new Error('the nested worktree holds dirty files')
      }
      return request(args)
    }
    const surface = fakeSurface()
    let localOpens = 0
    surface.surface.openLocal = async (_home, threadId) => {
      localOpens += 1
      return { threadId }
    }

    await expect(descend({ home, bridge, channel, surface, placement })).rejects.toThrow('dirty files')

    expect(localOpens).toBe(0)
    expect(placement.current()).toBe(EExecutionLocation.Cloud)
    expect(placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(EExecutionLocation.Cloud)

    transferFails = false
    await descend({ home, bridge, channel, surface, placement })
    expect(localOpens).toBe(1)
    expect(placement.current()).toBe(EExecutionLocation.Host)
  })
})
