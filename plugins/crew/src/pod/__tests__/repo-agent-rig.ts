import { basename, dirname } from 'node:path'

import { EAgentStatus, toThreadId, type Assembled, type V2Event } from '@dltech/atlas-core'
import {
  type PluginPodContext,
  type PodCrew,
  type SubagentSnapshot,
  EMPTY_CREW,
  EMPTY_ANALYTICS,
  EMPTY_CLASSIFIER,
  EMPTY_MCP_CONTROL,
  EMPTY_ROUTINES,
  EMPTY_SESSIONS,
  EMPTY_SUBSCRIPTIONS,
  EMPTY_WORKTREES,
  EMPTY_POD_RESOURCES,
  UNVERSIONED_SETTINGS,
  EMPTY_MESSAGES,
} from '@dltech/atlas-plugin-sdk'
import {
  ECallStatus,
  type CallOp,
  type CallResult,
  type DaemonEvent,
  type DaemonEventFrame,
} from '@dltech/atlas-protocol'

import { crewPod } from '..'

export type FakeNode = { kind: 'file'; text: string } | { kind: 'dir' }

const ok = (op: string, value: unknown): CallResult =>
  ({ status: ECallStatus.Ok, op, value }) as CallResult

const failed = (op: string, message: string): CallResult =>
  ({ status: ECallStatus.Failed, op, error: { code: 'not-found', message } }) as CallResult

export const fakeDaemon = (nodes: Record<string, FakeNode>) => {
  const calls: CallOp[] = []
  const watchers = new Set<(frame: DaemonEventFrame) => void>()

  const call = async (op: CallOp): Promise<CallResult> => {
    calls.push(op)
    if (op.op === 'stat') {
      const node = nodes[op.path]
      if (node === undefined) return failed(op.op, `no such file: ${op.path}`)
      return ok(op.op, {
        size: 1,
        mode: 0o644,
        mtimeMs: 0,
        isFile: node.kind === 'file',
        isDirectory: node.kind === 'dir',
      })
    }
    if (op.op === 'readDirectory') {
      if (nodes[op.path]?.kind !== 'dir') return failed(op.op, `no such directory: ${op.path}`)
      const entries = Object.entries(nodes)
        .filter(([path]) => dirname(path) === op.path)
        .map(([path, child]) => ({
          name: basename(path),
          isFile: child.kind === 'file',
          isDirectory: child.kind === 'dir',
        }))
      return ok(op.op, entries)
    }
    if (op.op === 'watch.start') return ok(op.op, op.roots)
    if (op.op === 'watch.stop') return ok(op.op, null)
    if (op.op === 'readFile') {
      const node = nodes[op.path]
      if (node === undefined || node.kind !== 'file')
        return failed(op.op, `no such file: ${op.path}`)
      return ok(op.op, node.text)
    }
    return failed(op.op, 'not a files op')
  }

  const onDaemonEvent = (listener: (frame: DaemonEventFrame) => void): (() => void) => {
    watchers.add(listener)
    return () => {
      watchers.delete(listener)
    }
  }

  const emit = (event: DaemonEvent): void => {
    for (const listener of watchers) listener({ kind: 'event', event })
  }

  return { call, calls, onDaemonEvent, emit }
}

export const dirs = (...paths: readonly string[]): Record<string, FakeNode> =>
  Object.fromEntries(paths.map((path) => [path, { kind: 'dir' } as FakeNode]))

export const file = (path: string, text: string): [string, FakeNode] => [
  path,
  { kind: 'file', text },
]

const snapshotOf = (overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot => ({
  agentId: 'a1',
  agentType: 'security-reviewer',
  intent: 'review the auth path',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  startedAt: '2026-11-16T10:00:00.000Z',
  ...overrides,
})

export type Call = { method: string; args: unknown }

export const fakeCrew = () => {
  const calls: Call[] = []
  const port: PodCrew = {
    ...EMPTY_CREW,
    spawn: async (args) => {
      calls.push({ method: 'spawn', args })
      return snapshotOf({ agentType: args.agentType, intent: args.intent })
    },
  }
  return { port, calls }
}

export const rig = (args: { nodes?: Record<string, FakeNode>; crew?: PodCrew } = {}) => {
  const daemon = fakeDaemon(args.nodes ?? {})
  const events: V2Event[] = []
  const ctx: PluginPodContext = {
    sessionId: 's1',
    resources: EMPTY_POD_RESOURCES,
    crew: args.crew ?? fakeCrew().port,
    messages: EMPTY_MESSAGES,
    classifier: EMPTY_CLASSIFIER,
    analytics: EMPTY_ANALYTICS,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    control: {
      mcp: EMPTY_MCP_CONTROL,
      gateway: { apiKey: async () => undefined, imageModel: async () => undefined },
      routines: EMPTY_ROUTINES,
      subscriptions: EMPTY_SUBSCRIPTIONS,
      settingsVersions: async () => UNVERSIONED_SETTINGS,
      exposePort: async () => {
        throw new Error('this rig exposes no port')
      },
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
    append: async (drafts) => {
      for (const draft of drafts) events.push(draft as unknown as V2Event)
    },
    notify: async () => undefined,
    events: () => events,
    call: daemon.call,
    live: () => undefined,
    onDaemonEvent: daemon.onDaemonEvent,
    log: () => undefined,
  }
  return { ctx, calls: daemon.calls, events }
}

export const refresh = async (args: {
  ctx: PluginPodContext
  projectDirectory?: string
}): Promise<void> => {
  for (const resource of crewPod.resources ?? []) {
    const value = await resource.load({
      ctx: args.ctx,
      directory: args.projectDirectory ?? '/work',
    })
    await args.ctx.append([
      { type: 'resource-loaded', resource: resource.name, fingerprint: 'rig', value },
    ])
  }
}

export const invoke = async (args: {
  ctx: PluginPodContext
  name: string
  input: unknown
  projectDirectory?: string
}) => {
  const tool = crewPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: args.projectDirectory ?? '/work',
    threadId: toThreadId('t1'),
  })
}

export const textOf = (outcome: Awaited<ReturnType<typeof invoke>>): string =>
  outcome.ok ? outcome.modelText : outcome.reason

export const spawnedPrompt = (calls: readonly Call[]): string => {
  const spawn = calls.find((call) => call.method === 'spawn')
  const args = spawn?.args as { prompt?: string } | undefined
  return args?.prompt ?? ''
}

const mainThreadPrompt = (): Assembled => ({
  system: [{ text: 'You are the main agent.' }],
  messages: [],
})

export const turn = async (args: {
  ctx: PluginPodContext
  projectDirectory?: string
  assembled?: Assembled
  refresh?: boolean
}): Promise<readonly string[]> => {
  const hooks = crewPod.hooks?.(args.ctx)
  for (const hook of hooks?.beforeTurn ?? [])
    await hook.run({
      threadId: toThreadId('t1'),
      projectDirectory: args.projectDirectory ?? '/work',
    })
  if (args.refresh !== false) await refresh(args)
  let assembled = args.assembled ?? mainThreadPrompt()
  for (const hook of hooks?.beforeStep ?? []) assembled = await hook.run({ assembled, trace: [] })
  return assembled.system.map((block) => block.text)
}
