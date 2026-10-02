import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EExecutionLocation, EPlacementMovePhase } from '@dltech/atlas-core'
import { PlacementController } from '@dltech/atlas-harness'

import { CHILD, cloudArchiveOf, descend, fakeSurface, useDescendHome, type DescendHome } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { CLOUD_THREAD, fakeBridge } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const bindController = (home: DescendHome): PlacementController => {
  const controller = new PlacementController(EExecutionLocation.Cloud)
  controller.bind({ threads: home.threads, workspace: '/work', repo: '/work' })
  return controller
}

describe('a descend through the placement coordinator', () => {
  it('commits the home placement through the controller and clears the move', async () => {
    const home = useDescendHome()
    const controller = bindController(home)
    const archive = await cloudArchiveOf([{ drafts: [said('one'), said('two')] }])
    const bridge = fakeBridge({ archive })

    const opened = await descend({ bridge, home, placement: controller })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(controller.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(controller.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
  })

  it('records the preparing marker before the flip and the commit inside the move', async () => {
    const home = useDescendHome()
    const controller = bindController(home)
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const bridge = fakeBridge({ archive })
    const phases: (string | null)[] = []
    controller.subscribe(() => {
      phases.push(controller.snapshot(CLOUD_THREAD)?.move?.phase ?? null)
    })

    await descend({ bridge, home, placement: controller })

    expect(phases).toContain(EPlacementMovePhase.Preparing)
    expect(phases).toContain(EPlacementMovePhase.Committed)
    expect(controller.snapshot(CLOUD_THREAD)?.move).toBeNull()
  })

  it('keeps the cloud placement with no pending move when the reopen fails before the flip', async () => {
    const home = useDescendHome()
    const controller = bindController(home)
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const bridge = fakeBridge({ archive })
    const surface = fakeSurface()
    surface.surface.openLocal = async () => {
      throw new Error('the local conversation would not reopen')
    }

    await expect(
      descend({ bridge, home, surface, placement: controller }),
    ).rejects.toThrow('the local conversation would not reopen')

    expect(controller.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    expect(controller.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect(bridge.destroyed).toEqual([])
  })

  it('keeps the committed home placement when resuming a paused child fails after the flip', async () => {
    const home = useDescendHome()
    const controller = bindController(home)
    const archive = await cloudArchiveOf([
      { drafts: [said('one')] },
      { threadId: CHILD, drafts: [said('child was mid-task')], spawnedBy: CLOUD_THREAD },
    ])
    const bridge = fakeBridge({ archive })
    const surface = fakeSurface()
    home.agents.place(
      fakeAgentSnapshot({ agentId: CHILD, spawnedBy: CLOUD_THREAD, status: EAgentStatus.Stopped }),
    )
    home.agents.resume = async () => {
      throw new Error('the child would not resume')
    }

    await descend({ bridge, home, surface, placement: controller })

    expect(controller.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(controller.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect(surface.notices.posts.some((post) => post.key === 'descend-cleanup-pending')).toBe(true)
    expect(bridge.destroyed).toEqual([])
  })

  it('flips nothing when the transfer fails before the commit', async () => {
    const home = useDescendHome()
    const controller = bindController(home)
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const bridge = fakeBridge({ archive })
    await home.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: home.ids.nextRunId(),
      drafts: [said('only ever cloud')],
      workspace: '/work',
      executionLocation: EExecutionLocation.Cloud,
    })
    home.agents.place(fakeAgentSnapshot({ agentId: CHILD, spawnedBy: CLOUD_THREAD }))

    await expect(
      descend({
        bridge,
        home,
        placement: controller,
        afterTranscriptLanded: async () => {
          throw new Error('the disk filled up mid-landing')
        },
      }),
    ).rejects.toThrow('the disk filled up mid-landing')

    expect(controller.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    expect(controller.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
  })
})
