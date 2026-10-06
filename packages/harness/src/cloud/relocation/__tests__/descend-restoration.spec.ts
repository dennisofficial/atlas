import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EExecutionLocation } from '@dltech/atlas-core'
import { PlacementController } from '../../../composition/placement-controller'
import { EClientRequest } from '../../channel-wire'
import { cloudArchiveOf, descend, fakeSurface, useDescendHome, CHILD } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { CLOUD_THREAD, fakeBridge, type FakeCloudChannel } from './fixture'
import { fakeRestorer } from './workspace-fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const cloudSetup = async (texts: readonly string[] = ['cloud words']) => {
  const home = useDescendHome()
  const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: texts.map(said) }]) })
  const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
  return { home, bridge, channel }
}

const trailOf = (channel: FakeCloudChannel, trail: string[]): void => {
  const served = channel.request.bind(channel)
  channel.request = async (given) => {
    trail.push(given.op)
    return served(given)
  }
  const resume = channel.resume.bind(channel)
  channel.resume = () => {
    trail.push('resume-source')
    resume()
  }
}

const seedOriginal = async (home: Awaited<ReturnType<typeof cloudSetup>>['home']) => {
  await home.threads.createWithFirstEvents({
    threadId: CLOUD_THREAD,
    runId: home.ids.nextRunId(),
    drafts: [said('original local words')],
    workspace: '/work',
    executionLocation: EExecutionLocation.Cloud,
  })
}

describe('the workspace restoration a descend holds until the move settles', () => {
  it('rolls the restoration back before the source resumes when the local open fails', async () => {
    const { home, bridge, channel } = await cloudSetup()
    const trail: string[] = []
    trailOf(channel, trail)
    const restorer = fakeRestorer({ transactional: true, trail })
    const surface = fakeSurface()
    surface.surface.openLocal = async () => {
      throw new Error('the local conversation would not open')
    }

    await expect(
      descend({ bridge, home, channel, surface, restoreWorkspace: restorer.restore }),
    ).rejects.toThrow('would not open')

    expect(restorer.rollbacks).toBe(1)
    expect(restorer.commits).toBe(0)
    expect(trail.indexOf('rollback')).toBeGreaterThan(trail.indexOf('restore'))
    expect(trail.indexOf('resume-source')).toBeGreaterThan(trail.indexOf('rollback'))
    expect(bridge.destroyed).toEqual([])
  })

  it('puts the original transcript back, with no imported or spawned events, after a rolled-back open failure', async () => {
    const { home, bridge, channel } = await cloudSetup()
    await seedOriginal(home)
    const restorer = fakeRestorer({ transactional: true })
    const surface = fakeSurface()
    surface.surface.openLocal = async () => {
      throw new Error('the local conversation would not open')
    }

    await expect(
      descend({ bridge, home, channel, surface, restoreWorkspace: restorer.restore }),
    ).rejects.toThrow('would not open')

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(events.map((event) => event.type)).toEqual(['user-said'])
    expect(events[0]?.type === 'user-said' && events[0].text).toBe('original local words')
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
  })

  it('commits the restoration exactly once after a successful descend', async () => {
    const { home, bridge, channel } = await cloudSetup()
    const restorer = fakeRestorer({ transactional: true })

    await descend({ bridge, home, channel, restoreWorkspace: restorer.restore })

    expect(restorer.commits).toBe(1)
    expect(restorer.rollbacks).toBe(0)
    expect(channel.paused).toBe(true)
  })

  it('commits exactly once when the move committed and only cleanup failed afterwards', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({
      archive: await cloudArchiveOf([
        { drafts: [said('cloud words')] },
        { threadId: CHILD, drafts: [said('child was mid-task')], spawnedBy: CLOUD_THREAD },
      ]),
    })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const controller = new PlacementController(EExecutionLocation.Cloud)
    controller.bind({ threads: home.threads, workspace: '/work', repo: '/work' })
    const restorer = fakeRestorer({ transactional: true })
    const surface = fakeSurface()
    home.agents.place(
      fakeAgentSnapshot({ agentId: CHILD, spawnedBy: CLOUD_THREAD, status: EAgentStatus.Stopped }),
    )
    home.agents.resume = async () => {
      throw new Error('the child would not resume')
    }

    await descend({ bridge, home, channel, surface, placement: controller, restoreWorkspace: restorer.restore })

    expect(controller.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(restorer.commits).toBe(1)
    expect(restorer.rollbacks).toBe(0)
    expect(surface.notices.posts.some((post) => post.key === 'descend-cleanup-pending')).toBe(true)
  })

  it('warns instead of failing the descend when the restoration commit fails', async () => {
    const { home, bridge, channel } = await cloudSetup()
    const restorer = fakeRestorer({ transactional: true, commitFails: new Error('backup directory is locked') })
    const surface = fakeSurface()

    const opened = await descend({ bridge, home, channel, surface, restoreWorkspace: restorer.restore })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    const warning = surface.notices.posts.find((post) => post.key === 'descend-workspace-cleanup')
    expect(warning?.text).toContain('backup directory is locked')
  })

  it('has nothing to roll back when the restorer itself fails', async () => {
    const { home, bridge, channel } = await cloudSetup()
    const restorer = fakeRestorer({ transactional: true, fails: new Error('the destination branch moved') })

    await expect(
      descend({ bridge, home, channel, restoreWorkspace: restorer.restore }),
    ).rejects.toThrow('the destination branch moved')

    expect(restorer.rollbacks).toBe(0)
    expect(restorer.commits).toBe(0)
  })

  it('treats a plain restored workspace as a restoration with nothing to commit or undo', async () => {
    const { home, bridge, channel } = await cloudSetup()
    const restorer = fakeRestorer()

    const opened = await descend({ bridge, home, channel, restoreWorkspace: restorer.restore })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(restorer.calls).toHaveLength(1)
  })

  it('re-reads the cloud transcript just before restoring so the latest endings are the ones kept', async () => {
    const home = useDescendHome()
    const first = await cloudArchiveOf([{ drafts: [said('cloud words')] }])
    const second = await cloudArchiveOf([{ drafts: [said('cloud words'), said('final shell ending')] }])
    const bridge = fakeBridge({ archive: first })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const trail: string[] = []
    const served = channel.request.bind(channel)
    let reads = 0
    channel.request = async (given) => {
      trail.push(given.op)
      if (given.op === EClientRequest.ReadSessionArchive) {
        reads += 1
        if (reads === 2) return { archive: second }
      }
      return served(given)
    }
    const restorer = fakeRestorer({ trail })

    await descend({ bridge, home, channel, restoreWorkspace: restorer.restore })

    expect(reads).toBe(2)
    expect(trail.lastIndexOf(EClientRequest.ReadSessionArchive)).toBeGreaterThan(
      trail.indexOf(EClientRequest.PrepareWorkspaceArchive),
    )
    expect(trail.lastIndexOf(EClientRequest.ReadSessionArchive)).toBeLessThan(trail.indexOf('restore'))
    const texts = (await home.log.read({ threadId: CLOUD_THREAD }))
      .filter((event) => event.type === 'user-said')
      .map((event) => event.text)
    expect(texts).toEqual(['cloud words', 'final shell ending'])
  })
})
