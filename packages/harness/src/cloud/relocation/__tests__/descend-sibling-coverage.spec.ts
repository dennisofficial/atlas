import { describe, expect, it } from 'bun:test'

import { EAgentStart, EAgentStatus, EExecutionLocation, toThreadId } from '@dltech/atlas-core'

import { PlacementController } from '../../../composition/placement-controller'
import { EClientRequest } from '../../channel-wire'
import { cloudArchiveOf, descend, fakeSurface, useDescendHome } from './descend-fixture'
import { sessionDirBytes } from './descend-preserve-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const transcriptBytes = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(sessionDirBytes({ home: process.env['ATLAS_HOME'] ?? '' })).filter(([file]) =>
      file.endsWith('.events.jsonl'),
    ),
  )

describe('a workspace export that omits a registered sibling', () => {
  it('fails before the flip and puts the old local data back untouched', async () => {
    const home = useDescendHome()
    await home.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: home.ids.nextRunId(),
      executionLocation: EExecutionLocation.Cloud,
      drafts: [said('old local words')],
      workspace: '/work',
    })
    const placement = new PlacementController(EExecutionLocation.Cloud)
    placement.bind({ threads: home.threads, workspace: '/work', repo: '/work' })
    await placement.activate({ threadId: CLOUD_THREAD })
    const peer = toThreadId(`${CLOUD_THREAD}/peer`)
    const archive = await cloudArchiveOf([
      { drafts: [
        said('cloud words'),
        { type: 'agent-spawned', agentId: peer, agentType: 'teammate', intent: 'peer work', mode: EAgentStart.Fresh },
        { type: 'agent-ended', agentId: peer, agentType: 'teammate', intent: 'peer work', status: EAgentStatus.Finished, prose: 'peer work is complete', turns: 1, toolCalls: 1 },
      ] },
      { threadId: peer, drafts: [said('peer finished')], spawnedBy: CLOUD_THREAD, agentType: 'teammate' },
    ])
    const bridge = fakeBridge({ archive })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const request = channel.request.bind(channel)
    channel.request = async (given) => {
      if (given.op === EClientRequest.PrepareWorkspaceArchive) {
        throw new Error('the workspace export omits registered sibling worktree ../peer')
      }
      return request(given)
    }
    const surface = fakeSurface()
    let localOpens = 0
    surface.surface.openLocal = async (_home, threadId) => {
      localOpens += 1
      return { threadId }
    }
    const before = transcriptBytes()

    await expect(descend({ home, bridge, channel, surface, placement })).rejects.toThrow(
      'omits registered sibling worktree ../peer',
    )

    expect(transcriptBytes()).toEqual(before)
    expect(localOpens).toBe(0)
    expect(placement.current()).toBe(EExecutionLocation.Cloud)
    expect(placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
    expect(bridge.destroyed).toEqual([])
    expect(channel.paused).toBe(false)
  })
})
