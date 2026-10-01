import {
  EExecutionLocation,
  locationOfPlacement,
  placementOf,
  toEventId,
  toRunId,
  toThreadId,
  type IdPort,
  type PlacementRecord,
  type ThreadId,
} from '@dltech/atlas-core'

import type {
  SupervisedAgent,
  ThreadModel,
  ThreadStorePort,
  ThreadSummary,
} from '../../../store/thread-store'
import type { FakeEventLog } from './fake-event-log'

export { fakeEventLog, type FakeEventLog } from './fake-event-log'
export { fakeLedger, type FakeLedger } from './fake-ledger'

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
  readonly chosenLocations: readonly {
    threadId: ThreadId
    location: EExecutionLocation
  }[]
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
  const chosenLocations: {
    threadId: ThreadId
    location: EExecutionLocation
  }[] = []
  const placements = new Map<ThreadId, PlacementRecord>()

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

    onModelChosen() {
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

    onPlacementChanged() {
      return () => undefined
    },

    async readPlacement({ threadId }) {
      const row = rows.find((held) => held.id === threadId)
      const record = placements.get(threadId)
      if (row === undefined && record === undefined) return undefined
      return (
        record ?? {
          placement: placementOf(row?.executionLocation ?? EExecutionLocation.Host),
          revision: 0,
          move: null,
        }
      )
    },

    async writePlacement({ threadId, record }) {
      const location = locationOfPlacement(record.placement)
      chosenLocations.push({ threadId, location })
      placements.set(threadId, record)
      const row = rows.find((held) => held.id === threadId)
      if (row !== undefined) {
        row.executionLocation = location
        return
      }
      rows.push({
        id: threadId,
        head: 0,
        createdAt: AT,
        updatedAt: AT,
        workspace: workspaceOf,
        repo: args.repo ?? null,
        executionLocation: location,
      })
    },

    async chooseExecutionLocation({ threadId, location }) {
      chosenLocations.push({ threadId, location })
      const row = rows.find((held) => held.id === threadId)
      if (row !== undefined) row.executionLocation = location
      const held = placements.get(threadId)
      placements.set(threadId, {
        placement: placementOf(location),
        revision: (held?.revision ?? 0) + 1,
        move: held?.move ?? null,
      })
    },

    async rewind() {
      throw new Error('unused')
    },
  }
}
