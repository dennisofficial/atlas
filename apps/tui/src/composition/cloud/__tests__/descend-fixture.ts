import {
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  fakeEventLog,
  fakeLedger,
  fakeThreadStore,
  type FakeEventLog,
  type FakeThreadStore,
} from '../../__tests__/fake-backend'
import { fakeAgentRegistry } from '../../__tests__/fake-agents'
import { fakeServiceRegistry } from '../../__tests__/fake-services'
import type { MoveStepId } from '../../container-move'
import type { ContainerMoveControl } from '../../use-container-move'
import { descendFromCloud, type DescendLocalHome, type WorkspaceMerger } from '../descend'
import type { RemoteMemoryMerge } from '../merge-remote-memory'
import { CLOUD_THREAD, type FakeBridge, type FakeCloudChannel } from './fixture'

export const AT = '2026-09-17T12:00:00.000Z'
export const CHILD = toThreadId('brn_child-1')

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

export const said = (args: { seq: number; text: string; threadId?: ThreadId }): Event => ({
  type: 'user-said',
  text: args.text,
  id: toEventId(`evt_local_${args.seq}`),
  seq: args.seq,
  threadId: args.threadId ?? CLOUD_THREAD,
  runId: toRunId('run_local'),
  depth: 0,
  at: AT,
})

export const fakeMove = (): ContainerMoveControl & {
  readonly begun: MoveStepId[] | null
  readonly steps: readonly MoveStepId[]
} => {
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

export type Home = DescendLocalHome & { threads: FakeThreadStore; log: FakeEventLog }

export const localHome = (args: { withThread?: boolean; events?: Event[] } = {}): Home => {
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

export const seedCloud = async (
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

export const descend = (args: {
  bridge: FakeBridge
  home: Home
  channel?: FakeCloudChannel
  move?: ContainerMoveControl
  midTurn?: boolean
  interruptDeadlineMs?: number
  mergeWorkspace?: WorkspaceMerger
  pullMemory?: () => Promise<RemoteMemoryMerge>
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
    ...(args.mergeWorkspace === undefined ? {} : { mergeWorkspace: args.mergeWorkspace }),
    ...(args.pullMemory === undefined ? {} : { pullMemory: args.pullMemory }),
  })
