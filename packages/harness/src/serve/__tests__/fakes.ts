import {
  toRunId,
  type EKilledBy,
  type Event,
  type EventDraft,
  type RosterWire,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { createDeltaChannel, type DeltaChannel } from '../../channel/delta-channel'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import type { ThreadSummary } from '../../store/thread-store'
import type { ServeApp, ServeRewind, ServeWakeNotices } from '../serve-app'

export type RunTurn = (args: {
  threadId: ThreadId
  signal?: AbortSignal | undefined
}) => Promise<TurnOutcome>

export type FakeServeApp = ServeApp & {
  channel: DeltaChannel
  appended: EventDraft[]
  forgotten: () => number
  closed: () => boolean
  adoptions: () => readonly ThreadId[]
}

export type FakeRoster = {
  snapshot: () => RosterWire
  subscribe: (listener: () => void) => () => void
  change: (next: RosterWire) => void
}

export function fakeRoster(initial?: RosterWire): FakeRoster {
  let held: RosterWire = initial ?? { shells: [], agents: [], services: [] }
  const listeners = new Set<() => void>()

  return {
    snapshot: () => held,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    change: (next) => {
      held = next
      for (const listener of [...listeners]) listener()
    },
  }
}

export type FakeWakeNotices = ServeWakeNotices & {
  setPending: (args: { shells?: number; agents?: number; services?: number }) => void
}

const summaryOf = (threadId: ThreadId): ThreadSummary => ({
  id: threadId,
  head: 0,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  workspace: '/workspace',
  repo: null,
})

const idle = async (): Promise<TurnOutcome> => ({
  status: ETurnStatus.Idle,
  runId: toRunId('run-idle'),
})

export function fakeWakeNotices(): FakeWakeNotices {
  const listeners = new Set<() => void>()
  let shells = 0
  let agents = 0
  let services = 0

  return {
    pendingShells: () => shells,
    pendingAgents: () => agents,
    pendingServices: () => services,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setPending: (given) => {
      shells = given.shells ?? shells
      agents = given.agents ?? agents
      services = given.services ?? services
      for (const listener of [...listeners]) listener()
    },
  }
}

export type FakeRewindTarget = ServeRewind['target'] & {
  removed: {
    agents: readonly ThreadId[]
    shells: readonly string[]
    services: readonly string[]
  }
}

export function fakeRewindTarget(): FakeRewindTarget {
  const removed = {
    agents: [] as ThreadId[],
    shells: [] as string[],
    services: [] as string[],
  }

  return {
    removed,
    removeChildren: async (given: { threadId: ThreadId; agentIds: readonly ThreadId[] }) => {
      removed.agents.push(...given.agentIds)
    },
    removeShells: (given: { shellIds: readonly string[]; by: EKilledBy }) => {
      void given.by
      removed.shells.push(...given.shellIds)
    },
    removeServices: (given: { serviceIds: readonly string[]; by: EKilledBy }) => {
      void given.by
      removed.services.push(...given.serviceIds)
    },
  }
}

export function fakeServeApp(args: {
  threadId: ThreadId
  root: string
  entries?: Record<string, readonly { name: string; isDirectory: boolean }[]> | undefined
  runTurn?: RunTurn | undefined
  events?: readonly Event[] | undefined
  adoptChildren?: ((args: { threadId: ThreadId }) => Promise<readonly ThreadId[]>) | undefined
  whenChildrenSettled?: (() => Promise<void>) | undefined
  wakeNotices?: boolean | undefined
  rewindTarget?: FakeRewindTarget | undefined
  roster?: FakeRoster | undefined
}): FakeServeApp {
  const channel = createDeltaChannel()
  const appended: EventDraft[] = []
  const run = args.runTurn ?? idle
  const adopt = args.adoptChildren ?? (async () => [])
  let runs = 0
  let forgotten = 0
  let closed = false
  const adoptions: ThreadId[] = []

  return {
    channel,

    runner: {
      runTurn: (given) => run(given),
    },

    log: {
      append: async (given: { drafts: readonly EventDraft[] }): Promise<Event[]> => {
        appended.push(...given.drafts)
        return []
      },
      read: async (): Promise<Event[]> => [...(args.events ?? [])],
    },

    threads: {
      find: async (): Promise<ThreadSummary | undefined> => summaryOf(args.threadId),
      createWithFirstEvents: async (given: { drafts: readonly EventDraft[] }) => {
        appended.push(...given.drafts)
        return { thread: summaryOf(args.threadId), events: [] as Event[] }
      },
    },

    ids: {
      nextRunId: (): RunId => {
        runs += 1
        return toRunId(`run-${runs}`)
      },
    },

    files: {
      list: async (directory: string) => args.entries?.[directory] ?? [],
      forget: () => {
        forgotten += 1
      },
    },

    workspace: { workspace: args.root, repo: null },

    adoptChildren: async (given) => {
      adoptions.push(given.threadId)
      return adopt(given)
    },

    whenChildrenSettled: () => (args.whenChildrenSettled ?? (async () => undefined))(),

    syncMemoryAfterTurn: async () => undefined,

    ...(args.wakeNotices === true ? { wakeNotices: fakeWakeNotices() } : {}),

    ...(args.rewindTarget === undefined ? {} : { rewind: { target: args.rewindTarget } }),

    ...(args.roster === undefined ? {} : { roster: args.roster }),

    close: async () => {
      closed = true
    },

    appended,
    forgotten: () => forgotten,
    closed: () => closed,
    adoptions: () => adoptions,
  }
}
