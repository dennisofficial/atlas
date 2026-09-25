import { beforeEach, describe, expect, it } from 'bun:test'

import { EAgentStart, EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { ETurnStatus } from '@dltech/atlas-harness'

import { currentNotices, dismissNotice, ENoticeTone } from '../../../ui/notice-store'
import { ELocalMoveStep } from '../../container-move'
import { ELiftStep } from '../lift'
import {
  CHILD,
  descend,
  fakeMove,
  localHome,
  said,
  seedCloud,
} from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

beforeEach(() => {
  dismissNotice()
})

describe('bringing a cloud conversation home', () => {
  it('rebuilds the local log from the cloud and flips both stores', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one', 'two', 'three', 'four'])
    const home = localHome({
      events: [said({ seq: 1, text: 'one' }), said({ seq: 2, text: 'two' })],
    })
    const move = fakeMove()

    const opened = await descend({ bridge, home, move })

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(
      events.filter((event) => event.type === 'user-said').map((event) => event.text),
    ).toEqual(['one', 'two', 'three', 'four'])
    expect(events.at(-1)?.type).toBe('location-changed')
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
    expect(
      (await bridge.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Host)
    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(opened.resumeOnArrival).toBeUndefined()
    expect(move.steps).toEqual([
      ELiftStep.Transferring,
      ELiftStep.Flipping,
      ELocalMoveStep.Relocating,
    ])
  })

  it('creates the local thread when the conversation only ever lived in the cloud', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['born up there'])
    const home = localHome({ withThread: false })

    const opened = await descend({ bridge, home })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    const created = await home.threads.find({ threadId: CLOUD_THREAD })
    expect(created?.executionLocation).toBe(EExecutionLocation.Host)
    expect((await home.log.read({ threadId: CLOUD_THREAD })).map((e) => e.type)).toContain(
      'user-said',
    )
  })

  it('carries sub-agent threads down with the parent', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['parent says'])
    await seedCloud(bridge, ['child says'], { threadId: CHILD, spawnedBy: CLOUD_THREAD })
    const home = localHome({ events: [said({ seq: 1, text: 'parent says' })] })

    await descend({ bridge, home })

    const childEvents = await home.log.read({ threadId: CHILD })
    expect(childEvents.some((event) => event.type === 'user-said')).toBe(true)
    const childRow = await home.threads.find({ threadId: CHILD })
    expect(childRow?.executionLocation).toBe(EExecutionLocation.Host)
    expect(childRow?.agent?.spawnedBy).toBe(CLOUD_THREAD)
  })

  it('restores the agent roster so no child is reported lost', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['parent says'])
    await bridge.log.append({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_cloud_spawn'),
      drafts: [
        {
          type: 'agent-spawned',
          agentId: CHILD,
          agentType: 'explore',
          intent: 'check the thing',
          mode: 'fresh' as never,
        },
      ],
    })
    await seedCloud(bridge, ['child says'], { threadId: CHILD, spawnedBy: CLOUD_THREAD })
    const home = localHome({ events: [said({ seq: 1, text: 'parent says' })] })

    await descend({ bridge, home })

    const lost = await home.agents.recordLostAgents({ threadId: CLOUD_THREAD })
    expect(lost.settled).toEqual([])
    expect(lost.unlogged).toEqual([])
  })

  it('rebuilds the local log from the cloud when they diverged while away', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one', 'two'])
    const home = localHome({
      events: [said({ seq: 1, text: 'one' }), said({ seq: 2, text: 'something else entirely' })],
    })

    await descend({ bridge, home })

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(
      events.filter((event) => event.type === 'user-said').map((event) => event.text),
    ).toEqual(['one', 'two'])
  })

  it('refuses to wipe a local log the cloud has no events for', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_cloud_seed'),
      drafts: [],
      workspace: '/work',
      executionLocation: EExecutionLocation.Cloud,
    })
    const home = localHome({ events: [said({ seq: 1, text: 'only ever local' })] })

    await expect(descend({ bridge, home })).rejects.toThrow('refusing to wipe')
    expect(
      (await home.log.read({ threadId: CLOUD_THREAD })).map((event) => event.type),
    ).toEqual(['user-said'])
    expect(
      (await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Cloud)
  })

  it('interrupts a turn in flight on the sandbox and marks the descent to resume locally', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })
    bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' })
    const channel = bridge.channel
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
    const move = fakeMove()

    const opened = await descend({ bridge, home, channel, move, midTurn: true })

    expect(interrupts).toBe(1)
    expect(opened.resumeOnArrival).toBe(true)
    expect(move.begun).toEqual([
      ELiftStep.Interrupting,
      ELiftStep.Transferring,
      ELiftStep.Flipping,
      ELocalMoveStep.Relocating,
    ])
  })

  it('gives up legibly when the remote turn will not stop', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })

    await expect(
      descend({ bridge, home, midTurn: true, interruptDeadlineMs: 20 }),
    ).rejects.toThrow('would not stop in time')
    expect(await home.log.read({ threadId: CLOUD_THREAD })).toHaveLength(1)
    expect(
      (await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Cloud)
  })

  it('destroys the cloud sandbox once the conversation is safely back on the host', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })

    await descend({ bridge, home })

    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
  })

  it('never destroys the sandbox when the descent fails', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })

    await expect(
      descend({ bridge, home, midTurn: true, interruptDeadlineMs: 20 }),
    ).rejects.toThrow('would not stop in time')

    expect(bridge.destroyed).toEqual([])
  })

  it('warns rather than failing the descend when the sandbox will not tear down', async () => {
    const bridge = fakeBridge({ destroyFails: new Error('the control plane fell over') })
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })

    const opened = await descend({ bridge, home })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
    const notice = currentNotices().find((entry) => entry.key === 'descend-sandbox-destroy-failed')
    expect(notice).toBeDefined()
    expect(notice?.tone).toBe(ENoticeTone.Warn)
    expect(notice?.text).toContain('the control plane fell over')
  })

  it('pulls the cloud memory down once the log and workspace are home', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })
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
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })

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
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })

    const opened = await descend({
      bridge,
      home,
      pullMemory: async () => {
        throw new Error('the memory archive timed out')
      },
    })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    const notice = currentNotices().find((entry) => entry.key === 'descend-memory-pull-failed')
    expect(notice).toBeDefined()
    expect(notice?.tone).toBe(ENoticeTone.Warn)
    expect(notice?.text).toContain('the memory archive timed out')
  })

  it('never pulls memory when the descent fails before the transfer lands', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })
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
