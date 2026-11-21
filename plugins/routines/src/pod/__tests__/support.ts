import { toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  type PodRoutines,
  EMPTY_POD_RESOURCES,
  UNVERSIONED_SETTINGS,
} from '@dltech/atlas-plugin-sdk'
import type { Routine } from '@dltech/atlas-protocol'

import { routinesPod } from '..'

export const routineRow = (patch: Partial<Routine> = {}): Routine => ({
  routineId: 'r1',
  projectId: 'p1',
  name: 'standup',
  prompt: 'post the standup',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
  enabled: true,
  model: null,
  effort: null,
  fast: null,
  nextRunAt: '2026-11-20T09:00:00.000Z',
  lastRunAt: null,
  lastSessionId: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  ...patch,
})

export const REFUSAL = 'this session has no Atlas Cloud project, and routines belong to a project'

export const fakeRoutines = (
  args: { routines?: readonly Routine[]; refusal?: string } = {},
): { port: PodRoutines; rows: Map<string, Routine>; calls: string[] } => {
  const rows = new Map((args.routines ?? [routineRow()]).map((row) => [row.routineId, row]))
  const calls: string[] = []
  const refuse = () => {
    if (args.refusal !== undefined) throw new Error(args.refusal)
  }
  const port: PodRoutines = {
    list: async () => {
      calls.push('list')
      refuse()
      return [...rows.values()]
    },
    get: async ({ routineId }) => {
      calls.push(`get:${routineId}`)
      refuse()
      const row = rows.get(routineId)
      if (row === undefined) throw new Error(`routine not found: ${routineId}`)
      return row
    },
    create: async (input) => {
      calls.push('create')
      refuse()
      const row: Routine = {
        ...routineRow({ routineId: 'created' }),
        name: input.name,
        prompt: input.prompt,
        cron: input.cron,
        timezone: input.timezone,
        enabled: input.enabled ?? true,
        model: input.model ?? null,
        effort: input.effort ?? null,
        fast: input.fast ?? null,
      }
      rows.set(row.routineId, row)
      return row
    },
    update: async (input) => {
      calls.push(`update:${input.routineId}`)
      refuse()
      const kept = rows.get(input.routineId)
      if (kept === undefined) throw new Error(`routine not found: ${input.routineId}`)
      const row = { ...kept, ...input } as Routine
      rows.set(row.routineId, row)
      return row
    },
    remove: async ({ routineId }) => {
      calls.push(`remove:${routineId}`)
      refuse()
      return { removed: rows.delete(routineId) }
    },
    run: async ({ routineId }) => {
      calls.push(`run:${routineId}`)
      refuse()
      if (!rows.has(routineId)) throw new Error(`routine not found: ${routineId}`)
      return { sessionId: 'session-1' }
    },
  }
  return { port, rows, calls }
}

export const rig = (routines: PodRoutines = fakeRoutines().port) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    resources: EMPTY_POD_RESOURCES,
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    control: {
      mcp: EMPTY_MCP_CONTROL,
      webSearch: { config: async () => ({ backend: undefined, key: undefined }) },
      settingsVersions: async () => UNVERSIONED_SETTINGS,
      exposePort: async () => {
        throw new Error('this rig exposes no port')
      },
      routines,
      memory: {
        list: async () => ({ project: null, memories: [] }),
        read: async () => null,
        write: async () => {
          throw new Error('this rig writes no memory')
        },
        edit: async () => {
          throw new Error('this rig edits no memory')
        },
        delete: async () => false,
      },
    },
    append: async () => undefined,
    notify: async () => undefined,
    events: () => [],
    call: async () => {
      throw new Error('this rig calls no daemon')
    },
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx }
}

export const invoke = async (args: { ctx: PluginPodContext; input: unknown }) => {
  const tool = routinesPod.tools?.(args.ctx).find((candidate) => candidate.name === 'routine')
  if (tool === undefined) throw new Error('no routine tool')
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/work',
    threadId: toThreadId('t1'),
  })
}

export const textOf = (outcome: Awaited<ReturnType<typeof invoke>>): string =>
  outcome.ok ? outcome.modelText : outcome.reason
