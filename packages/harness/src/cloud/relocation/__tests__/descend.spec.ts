import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, ENoticeTone, toRunId } from '@dltech/atlas-core'

import { EDescendNode } from '../descend-plan'
import { fakeAgentSnapshot } from './fake-agents'
import { CHILD, cloudArchiveOf, descend, fakeSurface, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

describe('bringing a cloud conversation home', () => {
  it('unpacks the session archive into the local store and flips it home', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([{ drafts: ['one', 'two', 'three', 'four'].map(said) }])
    const bridge = fakeBridge({ archive })
    const surface = fakeSurface()

    const opened = await descend({ bridge, home, surface })

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(
      events.filter((event) => event.type === 'user-said').map((event) => event.text),
    ).toEqual(['one', 'two', 'three', 'four'])
    const arrival = events.find((event) => event.type === 'location-changed')
    expect(arrival).toMatchObject({ from: EExecutionLocation.Cloud, to: EExecutionLocation.Host, cwd: '/work' })
    expect(events.at(-1)?.type).toBe('context-loaded')
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(opened.resumeOnArrival).toBeUndefined()
    expect(surface.doneNodes).toContain(EDescendNode.ArchiveRemote)
    expect(surface.doneNodes).toContain(EDescendNode.ReopenLocal)
    expect(surface.doneNodes).toContain(EDescendNode.FlipHome)
    expect(surface.doneNodes.indexOf(EDescendNode.ReopenLocal)).toBeLessThan(
      surface.doneNodes.indexOf(EDescendNode.FlipHome),
    )
    expect(surface.protects).toBe(1)
    expect(surface.released).toBe(1)
  })

  it('creates the local thread when the conversation only ever lived in the cloud', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([{ drafts: [said('born up there')] }])
    const bridge = fakeBridge({ archive })

    const opened = await descend({ bridge, home })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    const created = await home.threads.find({ threadId: CLOUD_THREAD })
    expect(created?.executionLocation).toBe(EExecutionLocation.Host)
    const types = (await home.log.read({ threadId: CLOUD_THREAD })).map((event) => event.type)
    expect(types).toContain('user-said')
  })

  it('carries sub-agent threads down with the parent, in the same archive', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([
      { drafts: [said('parent says')] },
      { threadId: CHILD, drafts: [said('child says')], spawnedBy: CLOUD_THREAD },
    ])
    const bridge = fakeBridge({ archive })
    home.agents.place(fakeAgentSnapshot({ agentId: CHILD, spawnedBy: CLOUD_THREAD }))

    await descend({ bridge, home })

    const childEvents = await home.log.read({ threadId: CHILD })
    expect(childEvents.some((event) => event.type === 'user-said')).toBe(true)
    const childRow = await home.threads.find({ threadId: CHILD })
    expect(childRow?.executionLocation).toBe(EExecutionLocation.Host)
    expect(childRow?.agent?.spawnedBy).toBe(CLOUD_THREAD)
  })

  it('overwrites the local log wholesale when the two sides diverged while away', async () => {
    const home = useDescendHome()
    await home.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_stale_local'),
      drafts: [said('something else entirely')],
      workspace: '/work',
    })
    const archive = await cloudArchiveOf([{ drafts: [said('one'), said('two')] }])
    const bridge = fakeBridge({ archive })

    await descend({ bridge, home })

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(
      events.filter((event) => event.type === 'user-said').map((event) => event.text),
    ).toEqual(['one', 'two'])
  })

  it('refuses to wipe the local copy when the cloud holds no transcript', async () => {
    const home = useDescendHome()
    await home.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_stale_local'),
      drafts: [said('only ever local')],
      workspace: '/work',
    })
    await home.threads.chooseExecutionLocation({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Cloud,
    })
    const bridge = fakeBridge({ archive: null })

    await expect(descend({ bridge, home })).rejects.toThrow('the cloud holds no transcript')

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(events.map((event) => event.type)).toEqual(['user-said'])
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
    expect(bridge.destroyed).toEqual([])
  })

  it('destroys the cloud sandbox once the conversation is safely back on the host', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })

    await descend({ bridge, home })

    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
  })

  it('warns rather than failing the descend when the sandbox will not tear down', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({
      archive: await cloudArchiveOf([{ drafts: [said('one')] }]),
      destroyFails: new Error('the control plane fell over'),
    })
    const surface = fakeSurface()

    const opened = await descend({ bridge, home, surface })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
    const notice = surface.notices.posts.find((entry) => entry.key === 'descend-sandbox-destroy-failed')
    expect(notice).toBeDefined()
    expect(notice?.tone).toBe(ENoticeTone.Warn)
    expect(notice?.text).toContain('the control plane fell over')
  })

})
