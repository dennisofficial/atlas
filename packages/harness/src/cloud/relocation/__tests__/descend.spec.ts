import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, ENoticeTone, toRunId } from '@dltech/atlas-core'
import { ETurnStatus } from '../../../loop/turn-outcome'

import { EDescendStep } from '../descend'
import { ELiftStep } from '../lift'
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
    expect(events.at(-1)?.type).toBe('location-changed')
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(opened.resumeOnArrival).toBeUndefined()
    expect(surface.steps).toEqual([
      EDescendStep.Transferring,
      EDescendStep.Flipping,
      EDescendStep.Relocating,
    ])
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

  it('re-announces each child on the local log so the roster rebuilds after the move', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([
      { drafts: [said('parent says')] },
      {
        threadId: CHILD,
        title: 'check the thing',
        drafts: [said('child says')],
        spawnedBy: CLOUD_THREAD,
      },
    ])
    const bridge = fakeBridge({ archive })
    home.agents.place(fakeAgentSnapshot({ agentId: CHILD, spawnedBy: CLOUD_THREAD }))

    await descend({ bridge, home })

    const spawned = (await home.log.read({ threadId: CLOUD_THREAD })).filter(
      (event) => event.type === 'agent-spawned',
    )
    expect(spawned).toHaveLength(1)
    expect(JSON.stringify(spawned[0])).toContain(CHILD)
    expect(JSON.stringify(spawned[0])).toContain('check the thing')
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
    const bridge = fakeBridge({ archive: '' })

    await expect(descend({ bridge, home })).rejects.toThrow('the cloud holds no transcript')

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(events.map((event) => event.type)).toEqual(['user-said'])
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
    expect(bridge.destroyed).toEqual([])
  })

  it('interrupts a turn in flight on the sandbox and marks the descent to resume locally', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const bridge = fakeBridge({ archive })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    let interrupts = 0
    channel.interrupt = () => {
      interrupts += 1
      setTimeout(
        () =>
          channel.endTurn({
            status: ETurnStatus.Interrupted,
            runId: toRunId('run_remote'),
            committed: true,
          }),
        0,
      )
    }
    const surface = fakeSurface()

    const opened = await descend({ bridge, home, channel, surface, midTurn: true })

    expect(interrupts).toBe(1)
    expect(opened.resumeOnArrival).toBe(true)
    expect(surface.begun).toEqual([
      [ELiftStep.Interrupting, EDescendStep.Transferring, EDescendStep.Flipping, EDescendStep.Relocating],
    ])
  })

  it('gives up legibly when the remote turn will not stop', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })

    await expect(
      descend({ bridge, home, midTurn: true, interruptDeadlineMs: 20 }),
    ).rejects.toThrow('would not stop in time')
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))).toBeUndefined()
  })

  it('destroys the cloud sandbox once the conversation is safely back on the host', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })

    await descend({ bridge, home })

    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
  })

  it('never destroys the sandbox when the descent fails', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })

    await expect(
      descend({ bridge, home, midTurn: true, interruptDeadlineMs: 20 }),
    ).rejects.toThrow('would not stop in time')

    expect(bridge.destroyed).toEqual([])
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

  it('pulls the cloud memory down once the log and workspace are home', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    let pulls = 0

    const opened = await descend({
      bridge,
      home,
      pullMemory: async () => {
        pulls += 1
        return { replaced: 0, conflicts: [] }
      },
    })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(pulls).toBe(1)
    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
  })

  it('keeps the cloud versions of memory the local side won as a log entry, never dropped', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })

    await descend({
      bridge,
      home,
      pullMemory: async () => ({
        replaced: 0,
        conflicts: [{ key: 'user/notes.md', text: '# what the cloud learned' }],
      }),
    })

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    const note = events.find((event) => event.type === 'context-loaded')
    expect(note).toBeDefined()
    expect(JSON.stringify(note)).toContain('user/notes.md')
    expect(JSON.stringify(note)).toContain('# what the cloud learned')
  })

  it('warns rather than failing the descend when the memory pull fails', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const surface = fakeSurface()

    const opened = await descend({
      bridge,
      home,
      surface,
      pullMemory: async () => {
        throw new Error('the memory archive timed out')
      },
    })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    const notice = surface.notices.posts.find((entry) => entry.key === 'descend-memory-pull-failed')
    expect(notice).toBeDefined()
    expect(notice?.tone).toBe(ENoticeTone.Warn)
    expect(notice?.text).toContain('the memory archive timed out')
  })

  it('never pulls memory when the descent fails before the transfer lands', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    let pulls = 0

    await expect(
      descend({
        bridge,
        home,
        midTurn: true,
        interruptDeadlineMs: 20,
        pullMemory: async () => {
          pulls += 1
          return { replaced: 0, conflicts: [] }
        },
      }),
    ).rejects.toThrow('would not stop in time')

    expect(pulls).toBe(0)
  })
})
