import {
  toEventId,
  toRunId,
  type EKilledBy,
  type Event,
  type EventDraft,
  type EventId,
  type IdPort,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import type { RosterWire } from '@dltech/atlas-wire'

import { createDeltaChannel, type DeltaChannel } from '@dltech/atlas-harness'
import { LoopTurnRunner, MessageIntake, PublishingTurnRunner, createPendingQueues, operatorSource } from '@dltech/atlas-harness'
import { defaultPipeline, EMPTY_PROMPT, EFinishReason, type ModelPort, type ModelStepResult } from '@dltech/atlas-core'
import type { PauseSignal } from '@dltech/atlas-harness'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'
import type { ThreadSummary } from '@dltech/atlas-harness'
import type { TurnLedgerPort } from '@dltech/atlas-harness'
import type { ServeApp, ServeFamily, ServeRewind, ServeWakeNotices } from '../serve-app'

export type RunTurn = (args: {
  threadId: ThreadId
  signal?: AbortSignal | undefined
  pause?: PauseSignal | undefined
}) => Promise<TurnOutcome>

export type FakeServeApp = ServeApp & {
  channel: DeltaChannel
  appended: EventDraft[]
  forgotten: () => number
  closed: () => boolean
  adoptions: () => readonly ThreadId[]
  renames: readonly { threadId: ThreadId; title: string }[]
  chosenModels: readonly { threadId: ThreadId; model: { ref: string; effort: string } }[]
  fireRename: (args: { threadId: ThreadId; title: string }) => void
  fireModelChosen: (args: { threadId: ThreadId; model: { ref: string; effort: string } }) => void
}

const fakeLedger = (): Pick<TurnLedgerPort, 'forThread' | 'forThreadTree'> => ({
  forThread: async () => [],
  forThreadTree: async () => ({ own: [], delegated: [] }),
})

const fakeThreadWrites = (args: {
  threadId: ThreadId
  appended: EventDraft[]
  renames: { threadId: ThreadId; title: string }[]
  chosenModels: { threadId: ThreadId; model: { ref: string; effort: string } }[]
  renameListeners: Set<(args: { threadId: ThreadId; title: string }) => void>
  modelChosenListeners: Set<(args: { threadId: ThreadId; model: { ref: string; effort: string } }) => void>
}): ServeApp['threads'] => ({
  find: async (): Promise<ThreadSummary | undefined> => summaryOf(args.threadId),
  createWithFirstEvents: async (given: { drafts: readonly EventDraft[] }) => {
    args.appended.push(...given.drafts)
    return { thread: summaryOf(args.threadId), events: [] as Event[] }
  },
  spawned: async (): Promise<readonly ThreadSummary[]> => [],
  list: async (): Promise<readonly ThreadSummary[]> => [],
  rename: async (given: { threadId: ThreadId; title: string }): Promise<void> => {
    args.renames.push(given)
    for (const listener of [...args.renameListeners]) listener(given)
  },
  chooseModel: async (given: {
    threadId: ThreadId
    model: { ref: string; effort: string }
  }): Promise<void> => {
    args.chosenModels.push(given)
    for (const listener of [...args.modelChosenListeners]) listener(given)
  },
  onRename: (listener) => {
    args.renameListeners.add(listener)
    return () => {
      args.renameListeners.delete(listener)
    }
  },
  onModelChosen: (listener) => {
    args.modelChosenListeners.add(listener)
    return () => {
      args.modelChosenListeners.delete(listener)
    }
  },
})

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
  family?: ServeFamily | undefined
  intake?: boolean | undefined
  holdStep?: ((step: number) => Promise<void> | undefined) | undefined
}): FakeServeApp {
  const channel = createDeltaChannel()
  const pending = createPendingQueues()
  const intake =
    args.intake === true ? new MessageIntake({ sources: [operatorSource(pending)] }) : undefined
  const appended: EventDraft[] = []
  const stored: Event[] = [...(args.events ?? [])]
  let steps = 0
  const scripted: ModelPort = {
    identity: { id: 'scripted', modelId: 'scripted' },
    step: async ({ onChunk }): Promise<ModelStepResult> => {
      steps += 1
      onChunk?.({ type: 'text-start', id: 'block' })
      await args.holdStep?.(steps)
      return {
        parts: [{ type: 'text', text: 'the sandbox answered' }],
        toolCalls: [],
        finishReason: EFinishReason.Stop,
      }
    },
  }
  const ids = {
    runs: 0,
    nextRunId: (): RunId => {
      ids.runs += 1
      return toRunId(`run-${ids.runs}`)
    },
    nextEventId: (): EventId => toEventId(`ev-${stored.length + 1}`),
  }
  const stamp = (draft: EventDraft, runId: RunId): Event =>
    ({
      ...draft,
      id: ids.nextEventId(),
      seq: stored.length + 1,
      threadId: args.threadId,
      runId,
      depth: 0,
      at: '2026-09-30T00:00:00.000Z',
    }) as Event
  const log: ServeApp['log'] = {
    append: async (given: { drafts: readonly EventDraft[]; runId?: RunId }): Promise<Event[]> => {
      appended.push(...given.drafts)
      const runId = given.runId ?? toRunId('run-append')
      const stamped = given.drafts.map((draft) => stamp(draft, runId))
      stored.push(...stamped)
      return stamped
    },
    read: async (): Promise<Event[]> => [...stored],
    readOwn: async (): Promise<Event[]> => [...stored],
    refresh: async (): Promise<void> => {},
    head: async (): Promise<number> => stored.length,
  }
  const loopRunner =
    intake === undefined
      ? null
      : new PublishingTurnRunner({
          channel,
          deps: {
            log: log as unknown as ConstructorParameters<typeof LoopTurnRunner>[0]['log'],
            model: scripted,
            ids: ids as unknown as ConstructorParameters<typeof LoopTurnRunner>[0]['ids'],
            assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: args.root }),
            drainPending: (drained) => intake.prepare(drained),
          },
        })
  const run: RunTurn =
    args.runTurn ??
    (loopRunner !== null
      ? ({ threadId: on, signal }) =>
          loopRunner.runTurn({
            threadId: on,
            ...(signal === undefined ? {} : { signal }),
          })
      : idle)
  const loopRun: RunTurn | null =
    loopRunner === null
      ? null
      : ({ threadId: on, signal }) =>
          loopRunner.runTurn({
            threadId: on,
            ...(signal === undefined ? {} : { signal }),
          })
  const adopt = args.adoptChildren ?? (async () => [])
  let runs = 0
  let forgotten = 0
  let closed = false
  const adoptions: ThreadId[] = []
  const renames: { threadId: ThreadId; title: string }[] = []
  const chosenModels: { threadId: ThreadId; model: { ref: string; effort: string } }[] = []
  const renameListeners = new Set<(args: { threadId: ThreadId; title: string }) => void>()
  const modelChosenListeners = new Set<
    (args: { threadId: ThreadId; model: { ref: string; effort: string } }) => void
  >()

  return {
    channel,

    runner: {
      runTurn: (given) => run(given),
      resume: (given) => run(given),
    },

    log,

    threads: fakeThreadWrites({
      threadId: args.threadId,
      appended,
      renames,
      chosenModels,
      renameListeners,
      modelChosenListeners,
    }),

    ledger: fakeLedger(),

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

    pending,

    ...(intake === undefined ? {} : { intake }),

    adoptChildren: async (given) => {
      adoptions.push(given.threadId)
      return adopt(given)
    },

    whenChildrenSettled: () => (args.whenChildrenSettled ?? (async () => undefined))(),

    ...(args.wakeNotices === true ? { wakeNotices: fakeWakeNotices() } : {}),

    ...(args.rewindTarget === undefined ? {} : { rewind: { target: args.rewindTarget } }),

    ...(args.roster === undefined ? {} : { roster: args.roster }),

    ...(args.family === undefined ? {} : { family: args.family }),

    close: async () => {
      closed = true
    },

    appended,
    forgotten: () => forgotten,
    closed: () => closed,
    adoptions: () => adoptions,
    renames,
    chosenModels,
    fireRename: (given) => {
      for (const listener of [...renameListeners]) listener(given)
    },
    fireModelChosen: (given) => {
      for (const listener of [...modelChosenListeners]) listener(given)
    },
  }
}
