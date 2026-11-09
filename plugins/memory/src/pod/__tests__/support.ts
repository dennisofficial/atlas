import { toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type MemoryKind,
  type MemoryScope,
  type MemorySummary,
  type PluginPodContext,
  type PodMemory,
} from '@dltech/atlas-plugin-sdk'

import { memoryPod } from '..'

type Stored = {
  scope: MemoryScope
  name: string
  description: string
  type: MemoryKind
  body: string
  revision: number
}

const keyOf = (address: { scope: MemoryScope; name: string }): string =>
  `${address.scope}:${address.name}`

const summaryOf = (row: Stored): MemorySummary => ({
  scope: row.scope,
  project: null,
  name: row.name,
  description: row.description,
  type: row.type,
  revision: row.revision,
  updatedAt: '2026-11-09T10:00:00.000Z',
})

export const fakeMemory = (args: { project?: string | null } = {}) => {
  const rows = new Map<string, Stored>()
  const calls: string[] = []
  const project = args.project === undefined ? 'dennisofficial/atlas' : args.project
  const find = (address: { scope: MemoryScope; name: string }): Stored => {
    const row = rows.get(keyOf(address))
    if (row === undefined) throw new Error(`no such memory: ${address.name}`)
    return row
  }
  const port: PodMemory = {
    list: async () => {
      calls.push('list')
      return { project, memories: [...rows.values()].map(summaryOf) }
    },
    read: async (address) => {
      const row = rows.get(keyOf(address))
      return row === undefined ? null : { ...summaryOf(row), body: row.body }
    },
    write: async (write) => {
      const kept = rows.get(keyOf(write))
      const next: Stored = {
        scope: write.scope,
        name: write.name,
        description: write.description,
        type: write.type,
        body: write.body,
        revision: (kept?.revision ?? 0) + 1,
      }
      rows.set(keyOf(write), next)
      return summaryOf(next)
    },
    edit: async (edit) => {
      const kept = find(edit)
      if (kept.revision !== edit.revision) {
        throw new Error(
          `memory is at revision ${kept.revision}, not ${edit.revision}; read it again`,
        )
      }
      const next = {
        ...kept,
        body: kept.body.replace(edit.old, edit.new),
        revision: kept.revision + 1,
      }
      rows.set(keyOf(edit), next)
      return summaryOf(next)
    },
    delete: async (address) => rows.delete(keyOf(address)),
  }
  return { port, rows, calls }
}

export const rig = (memory: PodMemory = fakeMemory().port) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    control: {
      exposePort: async () => {
        throw new Error('this rig exposes no port')
      },
      memory,
    },
    append: async () => undefined,
    events: () => [],
    call: async () => {
      throw new Error('this rig calls no daemon')
    },
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx }
}

export const invoke = async (args: { ctx: PluginPodContext; name: string; input: unknown }) => {
  const tool = memoryPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
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
