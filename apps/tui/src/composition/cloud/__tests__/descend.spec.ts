import { describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'
import { EClientRequest, ETurnStatus } from '@dltech/atlas-harness'

import {
  fakeEventLog,
  fakeLedger,
  fakeThreadStore,
  type FakeEventLog,
  type FakeThreadStore,
} from '../../__tests__/fake-backend'
import { fakeAgentRegistry } from '../../__tests__/fake-agents'
import { fakeServiceRegistry } from '../../__tests__/fake-services'
import { ELocalMoveStep, type MoveStepId } from '../../container-move'
import type { ContainerMoveControl } from '../../use-container-move'
import { descendFromCloud, type DescendLocalHome } from '../descend'
import { ELiftStep } from '../lift'
import { CLOUD_THREAD, fakeBridge, type FakeBridge, type FakeCloudChannel } from './fixture'

const AT = '2026-09-17T12:00:00.000Z'
const CHILD = toThreadId('brn_child-1')

let runs = 0
const fakeIds = (): IdPort => ({
  nextThreadId: () => toThreadId('brn_unused'),
  nextRunId: () => toRunId(`run_descend_${(runs += 1)}`),
  nextEventId: () => {
    throw new Error('unused')
  },
  nextCallId: () => {
    throw new Error('unused')
  },
})

const said = (args: { seq: number; text: string; threadId?: ThreadId }): Event => ({
  type: 'user-said',
  text: args.text,
  id: toEventId(`evt_local_${args.seq}`),
  seq: args.seq,
  threadId: args.threadId ?? CLOUD_THREAD,
  runId: toRunId('run_local'),
  depth: 0,
  at: AT,
})

const fakeMove = (): ContainerMoveControl & { readonly begun: MoveStepId[] | null; readonly steps: readonly MoveStepId[] } => {
  let begun: MoveStepId[] | null = null
  const steps: MoveStepId[] = []
  return {
    move: null,
    now: 0,
    handleBegin: ({ plan }) => {
      begun = [...(plan ?? [])]
    },
    handleAdvance: (step) => {
      steps.push(step)
    },
    handleSettle: () => undefined,
    handleFail: () => undefined,
    handleDismiss: () => undefined,
    handleKey: () => undefined,
    get begun() {
      return begun
    },
    get steps() {
      return steps
    },
  }
}

type Home = DescendLocalHome & { threads: FakeThreadStore; log: FakeEventLog }

const localHome = (args: { withThread?: boolean; events?: Event[] } = {}): Home => {
  const log = fakeEventLog(args.events ?? [])
  const threads = fakeThreadStore({
    log,
    existing: args.withThread === false ? [] : [CLOUD_THREAD],
  })
  if (args.withThread !== false) {
    void threads.chooseExecutionLocation({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Cloud,
    })
  }
  return {
    threads,
    log,
    ledger: fakeLedger(),
    agents: fakeAgentRegistry({ threads }),
    services: fakeServiceRegistry(),
    ids: fakeIds(),
    workspace: { workspace: '/work', repo: '/work' },
  }
}

const seedCloud = async (
  bridge: FakeBridge,
  texts: readonly string[],
  args: { threadId?: ThreadId; spawnedBy?: ThreadId } = {},
): Promise<void> => {
  await bridge.threads.createWithFirstEvents({
    threadId: args.threadId ?? CLOUD_THREAD,
    runId: toRunId('run_cloud_seed'),
    drafts: texts.map((text) => ({ type: 'user-said' as const, text })),
    workspace: '/work',
    executionLocation: EExecutionLocation.Cloud,
    ...(args.spawnedBy === undefined
      ? {}
      : { agent: { spawnedBy: args.spawnedBy, type: 'explore' } }),
  })
}

const descend = (args: {
  bridge: FakeBridge
  home: Home
  channel?: FakeCloudChannel
  move?: ContainerMoveControl
  midTurn?: boolean
  interruptDeadlineMs?: number
}) =>
  descendFromCloud({
    threadId: CLOUD_THREAD,
    target: EExecutionLocation.Host,
    midTurn: args.midTurn ?? false,
    bridge: args.bridge,
    channel: args.channel ?? args.bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }),
    localApp: args.home,
    move: args.move ?? fakeMove(),
    ...(args.interruptDeadlineMs === undefined
      ? {}
      : { interruptDeadlineMs: args.interruptDeadlineMs }),
  })

describe('bringing a cloud conversation home', () => {
  it('rebuilds the local log from the cloud and flips both stores', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one', 'two', 'three', 'four'])
    const home = localHome({
      events: [said({ seq: 1, text: 'one' }), said({ seq: 2, text: 'two' })],
    })
    const move = fakeMove()

    const opened = await descendFromCloud({
      threadId: CLOUD_THREAD,
      target: EExecutionLocation.Host,
      midTurn: false,
      bridge,
      channel: bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }),
      localApp: home,
      move,
    })

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

    const opened = await descendFromCloud({
      threadId: CLOUD_THREAD,
      target: EExecutionLocation.Host,
      midTurn: true,
      bridge,
      channel,
      localApp: home,
      move,
    })

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

  it('captures the workspace patch from the cloud', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['work happened in the cloud'])
    const home = localHome({
      events: [said({ seq: 1, text: 'work happened in the cloud' })],
    })

    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' })
    let capturedCwd: string | undefined
    channel.request = async (args) => {
      if (args.op === EClientRequest.CaptureWorkspace) {
        capturedCwd = (args.params as { cwd: string }).cwd
        return {
          remoteUrl: null,
          branch: null,
          commit: null,
          patch: '',
        }
      }
      return undefined
    }

    await descendFromCloud({
      threadId: CLOUD_THREAD,
      target: EExecutionLocation.Host,
      midTurn: false,
      bridge,
      channel,
      localApp: home,
      move: fakeMove(),
    })

    expect(capturedCwd).toBe('/work')
  })

  it('skips workspace transfer when the cloud has no uncommitted changes', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['clean cloud session'])
    const home = localHome({ events: [said({ seq: 1, text: 'clean cloud session' })] })

    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' })
    let captureCalled = false
    channel.request = async (args) => {
      if (args.op === EClientRequest.CaptureWorkspace) {
        captureCalled = true
        return {
          remoteUrl: null,
          branch: null,
          commit: null,
          patch: '',
        }
      }
      return undefined
    }

    await descendFromCloud({
      threadId: CLOUD_THREAD,
      target: EExecutionLocation.Host,
      midTurn: false,
      bridge,
      channel,
      localApp: home,
      move: fakeMove(),
    })

    expect(captureCalled).toBe(true)
  })
})
