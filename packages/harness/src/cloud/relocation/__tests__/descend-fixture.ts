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
  type LogPort,
  type NoticePost,
  type ThreadId,
} from '@dltech/atlas-core'

import { InMemoryToolRegistry } from '../../../tools/registry'
import type { PlacementController } from '../../../composition/placement-controller'
import type { SessionOwner, SessionRuntime } from '../../../composition/session-owner'
import { fakeAgentRegistry, type FakeAgents } from './fake-agents'
import { fakeLedger } from './fake-backend'
import { fakeServiceRegistry } from './fake-services'
import { JsonlEventLog } from '../../../store/sessions/event-log'
import { SessionRegistry } from '../../../store/sessions/registry'
import { JsonlThreadStore } from '../../../store/sessions/thread-store'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { exportedSessionDirOf } from './fake-cloud-bridge'
import {
  descendFromCloud,
  type DescendLocalHome,
  type DescendWake,
  type DestroySleeper,
  type WorkspaceRestorer,
} from '../descend'
import type { RelocationWave } from '../waves'
import { CLOUD_THREAD, fakeBridge, type FakeBridge, type FakeCloudChannel } from './fixture'
import { fakeRestorer } from './workspace-fixture'

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
  readonly begun: readonly RelocationWave[][]
  readonly doneNodes: readonly string[]
  readonly protects: number
  readonly released: number
  readonly surface: {
    notice: { notify: (post: NoticePost) => void }
    onBegin: (args: { waves: readonly RelocationWave[] }) => void
    onNodeDone: (nodeId: string) => void
    protect: () => () => void
    openLocal: (home: DescendLocalHome, threadId: ThreadId) => Promise<OpenedLocal>
  }
}

export const fakeSurface = (args: { protect?: boolean } = {}): Surface => {
  const posts: NoticePost[] = []
  const begun: RelocationWave[][] = []
  const doneNodes: string[] = []
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
    get doneNodes() {
      return doneNodes
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
      onBegin: ({ waves }) => {
        begun.push([...waves])
      },
      onNodeDone: (nodeId) => {
        doneNodes.push(nodeId)
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
  agentType?: string
  location?: EExecutionLocation
}

/**
 * Tars a cloud session dir the way serve would hold it — the parent and every child live in one
 * directory — and hands back the export descriptor the channel answers ReadSessionArchive with.
 */
export const cloudArchiveOf = async (
  threads: readonly CloudThread[],
): Promise<SessionArchiveDescriptor | null> => {
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
        : { agent: { spawnedBy: thread.spawnedBy, type: thread.agentType ?? 'explore' } }),
    })
  }
  return exportedSessionDirOf({ sessionDir: join(home, 'sessions', CLOUD_THREAD) })
}

export const descend = (args: {
  home: DescendHome
  bridge?: FakeBridge
  channel?: FakeCloudChannel
  surface?: Surface
  midTurn?: boolean
  wake?: DescendWake
  pauseDeadlineMs?: number
  restoreWorkspace?: WorkspaceRestorer
  logPort?: LogPort
  placement?: PlacementController | SessionOwner<SessionRuntime>
  afterTranscriptLanded?: () => Promise<void>
  destroySleep?: DestroySleeper
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
    ...(args.placement === undefined ? {} : { placement: args.placement }),
    ...(args.wake === undefined ? {} : { wake: args.wake }),
    ...(args.pauseDeadlineMs === undefined ? {} : { pauseDeadlineMs: args.pauseDeadlineMs }),
    restoreWorkspace: args.restoreWorkspace ?? fakeRestorer().restore,
    ...(args.logPort === undefined ? {} : { logPort: args.logPort }),
    ...(args.afterTranscriptLanded === undefined
      ? {}
      : { afterTranscriptLanded: args.afterTranscriptLanded }),
    ...(args.destroySleep === undefined ? {} : { destroySleep: args.destroySleep }),
  }).then((opened) =>
    args.midTurn === true ? { ...opened, resumeOnArrival: true } : opened,
  )
}
