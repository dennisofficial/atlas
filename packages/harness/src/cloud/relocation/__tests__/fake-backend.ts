import {
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
  type EExecutionLocation,
  type Event,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { SupervisedAgent, ThreadModel, ThreadStorePort, ThreadSummary } from '../../../store/thread-store'
import type { TurnLedgerPort, TurnSpend } from '../../../ledger/turn-ledger.port'

const AT = '2026-08-25T00:00:00.000Z'

/**
 * Minted thread ids carry the pid so one spec process's fakes never read as another's when a spec
 * file is split across bun's sharding.
 */
export const SPEC_SHARD = `p${process.pid}`

export function fakeIds(): IdPort {
  let handed = 0

  return {
    nextThreadId: () => toThreadId(`handed-${SPEC_SHARD}-${(handed += 1)}`),
    nextRunId: () => toRunId(`run-${(handed += 1)}`),
    nextEventId: () => toEventId(`event-${(handed += 1)}`),
    nextCallId: () => {
      throw new Error('unused')
    },
  }
}

export const FAKE_WORKSPACE = '/work'

export type FakeThreadStore = ThreadStorePort & {
  readonly created: number
  readonly createdWith: readonly {
    workspace: string | null
    repo: string | null
    agent?: SupervisedAgent
  }[]
  readonly renames: readonly { threadId: ThreadId; title: string }[]
  readonly chosenModels: readonly { threadId: ThreadId; model: ThreadModel }[]
  readonly chosenLocations: readonly { threadId: ThreadId; location: EExecutionLocation }[]
}

export function fakeThreadStore(
  args: {
    existing?: readonly ThreadId[]
    log?: FakeEventLog
    workspace?: string | null
    repo?: string | null
    titles?: Readonly<Record<string, string>>
  } = {},
): FakeThreadStore {
  const workspaceOf = args.workspace === undefined ? FAKE_WORKSPACE : args.workspace
  const rows: ThreadSummary[] = (args.existing ?? []).map((id) => ({
    id,
    head: 0,
    createdAt: AT,
    updatedAt: AT,
    workspace: workspaceOf,
    repo: args.repo ?? null,
    ...(args.titles?.[id] === undefined ? {} : { title: args.titles[id] }),
  }))

  let created = 0
  const createdWith: {
    workspace: string | null
    repo: string | null
    agent?: SupervisedAgent
  }[] = []
  const renames: { threadId: ThreadId; title: string }[] = []
  const chosenModels: { threadId: ThreadId; model: ThreadModel }[] = []
  const chosenLocations: { threadId: ThreadId; location: EExecutionLocation }[] = []

  return {
    get created() {
      return created
    },

    get createdWith() {
      return createdWith
    },

    get chosenModels() {
      return chosenModels
    },

    get chosenLocations() {
      return chosenLocations
    },

    get renames() {
      return renames
    },

    onRename() {
      return () => undefined
    },

    async compact() {
      return 0
    },

    async summarise() {
      return 0
    },

    async fork() {
      throw new Error('unused')
    },

    async create({ workspace, repo, agent } = {}) {
      created += 1
      createdWith.push({
        workspace: workspace ?? null,
        repo: repo ?? null,
        ...(agent === undefined ? {} : { agent }),
      })
      const row: ThreadSummary = {
        id: toThreadId(`made-${SPEC_SHARD}-${created}`),
        head: 0,
        createdAt: AT,
        updatedAt: AT,
        workspace: workspace ?? workspaceOf,
        repo: repo ?? null,
        ...(agent === undefined ? {} : { agent }),
      }
      rows.push(row)
      return row
    },

    async createWithFirstEvents({
      threadId,
      drafts,
      runId,
      title,
      workspace,
      repo,
      agent,
      executionLocation,
    }) {
      created += 1
      createdWith.push({
        workspace: workspace ?? null,
        repo: repo ?? null,
        ...(agent === undefined ? {} : { agent }),
      })
      const thread: ThreadSummary = {
        id: threadId ?? toThreadId(`made-${SPEC_SHARD}-${created}`),
        head: drafts.length,
        createdAt: AT,
        updatedAt: AT,
        workspace: workspace ?? workspaceOf,
        repo: repo ?? null,
        ...(title === undefined ? {} : { title }),
        ...(agent === undefined ? {} : { agent }),
        ...(executionLocation === undefined ? {} : { executionLocation }),
      }
      rows.push(thread)

      const events = (await args.log?.append({ threadId: thread.id, runId, drafts })) ?? []
      return { thread, events: [...events] }
    },

    async find({ threadId }) {
      return rows.find((row) => row.id === threadId)
    },

    /**
     * Filtered on the supervision link rather than on `parent`, so a fork never comes back from it.
     */
    async spawned({ threadId }) {
      return rows.filter((row) => row.agent?.spawnedBy === threadId)
    },

    async mostRecent({ project }) {
      return rows.filter((row) => row.workspace === project || row.repo === project).at(-1)
    },

    async list({ project, limit }) {
      const scoped = rows
        .filter((row) => row.workspace === project || row.repo === project)
        .reverse()
      return scoped.slice(0, limit ?? 50)
    },

    async findNamed() {
      return undefined
    },

    async rename({ threadId, title }) {
      renames.push({ threadId, title })
      const row = rows.find((held) => held.id === threadId)
      if (row !== undefined) row.title = title
    },

    async adopt({ threadId, workspace, repo }) {
      const row = rows.find((held) => held.id === threadId)
      if (row === undefined) return

      row.workspace = workspace
      row.repo = repo
    },

    async chooseModel({ threadId, model }) {
      chosenModels.push({ threadId, model })
      const row = rows.find((held) => held.id === threadId)
      if (row !== undefined) row.model = model
    },

    async chooseExecutionLocation({ threadId, location }) {
      chosenLocations.push({ threadId, location })
      const row = rows.find((held) => held.id === threadId)
      if (row !== undefined) row.executionLocation = location
    },

    async rewind() {
      throw new Error('unused')
    },
  }
}

export type FakeEventLog = EventLogPort & {
  readonly branchesRead: readonly ThreadId[]
  readonly ownReads: readonly ThreadId[]
  peek(args: { threadId: ThreadId }): readonly Event[]
  truncate(args: { threadId: ThreadId; toSeq: number }): void
}

export function fakeEventLog(seeded: readonly Event[] = []): FakeEventLog {
  const byThread = new Map<ThreadId, Event[]>()
  const headByThread = new Map<ThreadId, number>()
  const branchesRead: ThreadId[] = []
  const ownReads: ThreadId[] = []

  for (const event of seeded) {
    byThread.set(event.threadId, [...(byThread.get(event.threadId) ?? []), event])
    headByThread.set(event.threadId, Math.max(headByThread.get(event.threadId) ?? 0, event.seq))
  }

  let stamped = 0

  const reserve = ({ threadId, count }: { threadId: ThreadId; count: number }): number => {
    const from = (headByThread.get(threadId) ?? 0) + 1
    headByThread.set(threadId, from + count - 1)
    return from
  }

  const held = ({ threadId, upTo }: { threadId: ThreadId; upTo?: number }): Event[] => {
    const rows = byThread.get(threadId) ?? []
    return upTo === undefined ? [...rows] : rows.filter((event) => event.seq <= upTo)
  }

  return {
    branchesRead,
    ownReads,

    peek({ threadId }) {
      return [...(byThread.get(threadId) ?? [])]
    },

    async append({ threadId, runId, drafts }) {
      const firstSeq = reserve({ threadId, count: drafts.length })

      const written = drafts.map((draft, index) => {
        stamped += 1
        return stampEvent({
          draft,
          envelope: {
            id: toEventId(`event-${stamped}`),
            seq: firstSeq + index,
            threadId,
            runId,
            depth: 0,
            at: AT,
          },
        })
      })

      byThread.set(threadId, [...(byThread.get(threadId) ?? []), ...written])
      return written
    },

    async replace({ threadId, runId, drafts }) {
      const written = drafts.map((draft, index) => {
        stamped += 1
        return stampEvent({
          draft,
          envelope: {
            id: toEventId(`event-${stamped}`),
            seq: index + 1,
            threadId,
            runId,
            depth: 0,
            at: AT,
          },
        })
      })

      byThread.set(threadId, written)
      headByThread.set(threadId, written.length)
      return written
    },

    truncate({ threadId, toSeq }) {
      byThread.set(threadId, held({ threadId, upTo: toSeq }))
      headByThread.set(threadId, toSeq)
    },

    async read({ threadId, upTo }) {
      branchesRead.push(threadId)
      return held({ threadId, ...(upTo === undefined ? {} : { upTo }) })
    },

    async head({ threadId }) {
      return headByThread.get(threadId) ?? 0
    },

    async readOwn({ threadId, upTo }) {
      ownReads.push(threadId)
      return held({ threadId, ...(upTo === undefined ? {} : { upTo }) })
    },
  }
}

export type FakeLedger = TurnLedgerPort & { readonly rows: readonly TurnSpend[] }

export function fakeLedger(
  args: {
    spent?: readonly TurnSpend[]
    children?: Readonly<Record<string, readonly ThreadId[]>>
  } = {},
): FakeLedger {
  const rows: TurnSpend[] = [...(args.spent ?? [])]

  return {
    get rows() {
      return rows
    },
    record: async (spend) => {
      rows.push(spend)
    },
    forThread: async ({ threadId }) => rows.filter((row) => row.threadId === threadId),

    forThreadTree: async ({ threadId }) => {
      const children = new Set<string>(args.children?.[threadId] ?? [])

      return {
        own: rows.filter((row) => row.threadId === threadId),
        delegated: rows.filter((row) => children.has(row.threadId)),
      }
    },
  }
}
