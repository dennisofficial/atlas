import {
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type IdPort,
  type NoticePost,
  type ThreadId,
} from '@dltech/atlas-core'

import { InMemoryToolRegistry } from '../../../tools/registry'
import type { RemoteMemoryMerge } from '../../merge-remote-memory'
import { fakeAgentRegistry } from './fake-agents'
import {
  fakeEventLog,
  fakeLedger,
  fakeThreadStore,
  type FakeEventLog,
  type FakeThreadStore,
} from './fake-backend'
import { fakeServiceRegistry } from './fake-services'
import {
  descendFromCloud,
  type DescendLocalHome,
  type DescendProgressStep,
  type WorkspaceMerger,
} from '../descend'
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

export type OpenedLocal = { threadId: ThreadId; resumeOnArrival?: boolean | undefined }

export type RecordedNotices = {
  readonly posts: readonly NoticePost[]
}

export const recordingNotices = (): { posts: NoticePost[]; notice: { notify: (post: NoticePost) => void } } => {
  const posts: NoticePost[] = []
  return {
    posts,
    notice: {
      notify: (post) => {
        posts.push(post)
      },
    },
  }
}

export type Surface = {
  readonly notices: RecordedNotices
  readonly begun: readonly DescendProgressStep[][] | readonly DescendProgressStep[]
  readonly steps: readonly DescendProgressStep[]
  readonly protects: number
  readonly released: number
  readonly surface: {
    notice: { notify: (post: NoticePost) => void }
    onBegin: (args: { plan: readonly DescendProgressStep[] }) => void
    onProgress: (step: DescendProgressStep) => void
    protect: () => () => void
    openLocal: (home: DescendLocalHome, threadId: ThreadId) => Promise<OpenedLocal>
  }
}

export const fakeSurface = (args: { protect?: boolean } = {}): Surface => {
  const { posts, notice } = recordingNotices()
  const begun: DescendProgressStep[][] = []
  const steps: DescendProgressStep[] = []
  let protects = 0
  let released = 0

  return {
    notices: { get posts() { return posts } } as RecordedNotices,
    get begun() {
      return begun
    },
    get steps() {
      return steps
    },
    get protects() {
      return protects
    },
    get released() {
      return released
    },
    surface: {
      notice,
      onBegin: ({ plan }) => {
        begun.push([...plan])
      },
      onProgress: (step) => {
        steps.push(step)
      },
      protect: () => {
        if (args.protect === false) return () => undefined
        protects += 1
        return () => {
          released += 1
        }
      },
      openLocal: async (_home, threadId) => ({ threadId }),
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
    tools: new InMemoryToolRegistry([]),
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
  surface?: Surface
  midTurn?: boolean
  interruptDeadlineMs?: number
  mergeWorkspace?: WorkspaceMerger
  pullMemory?: () => Promise<RemoteMemoryMerge>
}): Promise<OpenedLocal> => {
  const surface = args.surface ?? fakeSurface()
  return descendFromCloud({
    threadId: CLOUD_THREAD,
    target: EExecutionLocation.Host,
    midTurn: args.midTurn ?? false,
    bridge: args.bridge,
    channel: args.channel ?? args.bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }),
    localApp: args.home,
    surface: surface.surface,
    ...(args.interruptDeadlineMs === undefined
      ? {}
      : { interruptDeadlineMs: args.interruptDeadlineMs }),
    ...(args.mergeWorkspace === undefined ? {} : { mergeWorkspace: args.mergeWorkspace }),
    ...(args.pullMemory === undefined ? {} : { pullMemory: args.pullMemory }),
  }).then((opened) =>
    args.midTurn === true ? { ...opened, resumeOnArrival: true } : opened,
  )
}
