import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'bun:test'

import {
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type EventDraft,
  type IdPort,
  type NoticePost,
  type ThreadId,
} from '@dltech/atlas-core'

import { InMemoryToolRegistry } from '../../../tools/registry'
import type { RemoteMemoryMerge } from '../../merge-remote-memory'
import { fakeAgentRegistry, type FakeAgents } from './fake-agents'
import { fakeLedger } from './fake-backend'
import { fakeServiceRegistry } from './fake-services'
import { JsonlEventLog } from '../../../store/sessions/event-log'
import { SessionRegistry } from '../../../store/sessions/registry'
import { JsonlThreadStore } from '../../../store/sessions/thread-store'
import { buildSessionArchive } from '../../session-archive'
import {
  descendFromCloud,
  type DescendLocalHome,
  type DescendProgressStep,
  type WorkspaceMerger,
} from '../descend'
import { CLOUD_THREAD, fakeBridge, type FakeBridge, type FakeCloudChannel } from './fixture'

const AT = '2026-09-17T12:00:00.000Z'
export const CHILD = toThreadId('brn_child-1')

let runs = 0
const descendIds = (): IdPort => ({
  nextThreadId: () => toThreadId('brn_unused'),
  nextRunId: () => toRunId(`run_descend_${(runs += 1)}`),
  nextEventId: () => toEventId(`evt_descend_${(runs += 1)}`),
  nextCallId: () => {
    throw new Error('unused')
  },
})

const fixedClock = { now: () => AT }

export type OpenedLocal = { threadId: ThreadId; resumeOnArrival?: boolean | undefined }

export type Surface = {
  readonly notices: { readonly posts: readonly NoticePost[] }
  readonly begun: readonly DescendProgressStep[][]
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
  const posts: NoticePost[] = []
  const begun: DescendProgressStep[][] = []
  const steps: DescendProgressStep[] = []
  let protects = 0
  let released = 0

  return {
    notices: {
      get posts() {
        return posts
      },
    },
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
      notice: {
        notify: (post) => {
          posts.push(post)
        },
      },
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

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

/**
 * Both lift and descend reach the session directory through `atlasDirectory()`, which reads
 * `ATLAS_HOME` afresh on every call, so pointing the variable at a throwaway home is the seam the
 * whole suite stages the transcript through.
 */
export const useAtlasHome = (): string => {
  const previous = process.env['ATLAS_HOME']
  const home = mkdtempSync(join(tmpdir(), 'atlas-descend-spec-'))
  homes.push(home)
  process.env['ATLAS_HOME'] = home
  afterEach(() => {
    if (previous === undefined) delete process.env['ATLAS_HOME']
    else process.env['ATLAS_HOME'] = previous
  })
  return home
}

export type DescendHome = DescendLocalHome & {
  threads: JsonlThreadStore
  log: JsonlEventLog
  agents: FakeAgents
}

/**
 * The local side of a descend is the real store stack over the staged home: the transcript comes
 * back as a session archive, and only the on-disk stores rebuild their rows from it.
 */
export const useDescendHome = (): DescendHome => {
  const home = useAtlasHome()
  const registry = new SessionRegistry(home)
  const ids = descendIds()
  const log = new JsonlEventLog(home, registry, fixedClock, ids)
  const threads = new JsonlThreadStore(home, registry, fixedClock, ids, log)
  return {
    threads,
    log,
    ledger: fakeLedger(),
    agents: fakeAgentRegistry(),
    services: fakeServiceRegistry(),
    tools: new InMemoryToolRegistry([]),
    ids,
    workspace: { workspace: '/work', repo: '/work' },
  }
}

export type CloudThread = {
  threadId?: ThreadId
  title?: string
  drafts: readonly EventDraft[]
  spawnedBy?: ThreadId
  /**
   * Where the row sits while away. `flipChildrenBack` is driven by the agent roster, not the
   * store, so a child row that never says `cloud` keeps its old location through the descend.
   */
  location?: EExecutionLocation
}

/**
 * Tars a cloud session dir the way serve would hold it — the parent and every child live in one
 * directory — and hands back the base64 the channel answers ReadSessionArchive with.
 */
export const cloudArchiveOf = async (
  threads: readonly CloudThread[],
): Promise<string | undefined> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-cloud-seed-'))
  homes.push(home)
  const registry = new SessionRegistry(home)
  const ids = descendIds()
  const log = new JsonlEventLog(home, registry, fixedClock, ids)
  const store = new JsonlThreadStore(home, registry, fixedClock, ids, log)
  for (const thread of threads) {
    const threadId = thread.threadId ?? CLOUD_THREAD
    await store.createWithFirstEvents({
      threadId,
      runId: toRunId('run_cloud_seed'),
      drafts: [...thread.drafts],
      workspace: '/work',
      executionLocation: thread.location ?? EExecutionLocation.Cloud,
      ...(thread.title === undefined ? {} : { title: thread.title }),
      ...(thread.spawnedBy === undefined
        ? {}
        : { agent: { spawnedBy: thread.spawnedBy, type: 'explore' } }),
    })
  }
  const archive = await buildSessionArchive({
    sessionDir: join(home, 'sessions', CLOUD_THREAD),
  })
  return archive?.toString('base64')
}

export const descend = (args: {
  home: DescendHome
  bridge?: FakeBridge
  channel?: FakeCloudChannel
  surface?: Surface
  midTurn?: boolean
  interruptDeadlineMs?: number
  mergeWorkspace?: WorkspaceMerger
  pullMemory?: () => Promise<RemoteMemoryMerge>
}): Promise<OpenedLocal> => {
  const bridge = args.bridge ?? fakeBridge()
  const surface = args.surface ?? fakeSurface()
  const channel = args.channel ?? bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
  return descendFromCloud({
    threadId: CLOUD_THREAD,
    target: EExecutionLocation.Host,
    midTurn: args.midTurn ?? false,
    bridge,
    channel,
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
