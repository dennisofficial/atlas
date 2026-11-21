import { toCallId, toThreadId, type Assembled, type V2Event } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_ROUTINES,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  EMPTY_POD_RESOURCES,
  UNVERSIONED_SETTINGS,
} from '@dltech/atlas-plugin-sdk'
import {
  ECallStatus,
  type CallOp,
  type CallResult,
  type DaemonEventFrame,
} from '@dltech/atlas-protocol'

import { instructionsPodOf, type InstructionsPodOptions } from '..'

export type FakeNode = { kind: 'file'; text: string; size?: number | undefined } | { kind: 'dir' }

const ok = (op: string, value: unknown): CallResult =>
  ({ status: ECallStatus.Ok, op, value }) as CallResult

const failed = (op: string, message: string): CallResult =>
  ({ status: ECallStatus.Failed, op, error: { code: 'not-found', message } }) as CallResult

export const fakeDaemon = (nodes: Record<string, FakeNode>) => {
  const calls: CallOp[] = []
  const events: V2Event[] = []

  const call = async (op: CallOp): Promise<CallResult> => {
    calls.push(op)
    if (op.op === 'stat') {
      const node = nodes[op.path]
      if (node === undefined) return failed(op.op, `no such file: ${op.path}`)
      return ok(op.op, {
        size: node.kind === 'file' ? (node.size ?? node.text.length) : 0,
        mode: 0o644,
        mtimeMs: 0,
        isFile: node.kind === 'file',
        isDirectory: node.kind === 'dir',
      })
    }
    if (op.op === 'glob') {
      const prefix = op.cwd.endsWith('/') ? op.cwd : `${op.cwd}/`
      const found = Object.keys(nodes)
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length))
        .filter((path) => path === 'AGENTS.md' || path.endsWith('/AGENTS.md'))
      return ok(op.op, found.sort())
    }
    if (op.op === 'readFile') {
      const node = nodes[op.path]
      if (node === undefined || node.kind !== 'file')
        return failed(op.op, `no such file: ${op.path}`)
      return ok(op.op, node.text)
    }
    return failed(op.op, 'not a files op')
  }

  const ctx: PluginPodContext = {
    sessionId: 's1',
    control: {
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
      mcp: EMPTY_MCP_CONTROL,
      webSearch: { config: async () => ({ backend: undefined, key: undefined }) },
      routines: EMPTY_ROUTINES,
    },
    resources: EMPTY_POD_RESOURCES,
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    append: async (drafts) => {
      for (const draft of drafts) events.push(draft as unknown as V2Event)
    },
    events: () => events,
    call,
    onDaemonEvent: (_listener: (frame: DaemonEventFrame) => void) => () => undefined,
    live: () => undefined,
    log: () => undefined,
  }

  return { ctx, calls, nodes }
}

const hooksOf = (args: { ctx: PluginPodContext; options: InstructionsPodOptions }) =>
  instructionsPodOf(args.options).hooks?.(args.ctx)

export const refresh = async (args: {
  ctx: PluginPodContext
  options: InstructionsPodOptions
  projectDirectory: string
}): Promise<void> => {
  for (const resource of instructionsPodOf(args.options).resources ?? []) {
    const value = await resource.load({ ctx: args.ctx, directory: args.projectDirectory })
    await args.ctx.append([
      { type: 'resource-loaded', resource: resource.name, fingerprint: 'rig', value },
    ])
  }
}

export const startTurn = async (args: {
  ctx: PluginPodContext
  options: InstructionsPodOptions
  projectDirectory: string
}): Promise<void> => {
  await refresh(args)
}

export const step = async (args: {
  ctx: PluginPodContext
  options: InstructionsPodOptions
}): Promise<readonly string[]> => {
  const hooks = hooksOf(args)
  let assembled: Assembled = { system: [], messages: [] }
  for (const hook of hooks?.beforeStep ?? []) assembled = await hook.run({ assembled, trace: [] })
  return assembled.system.map((block) => block.text)
}

export const turn = async (args: {
  ctx: PluginPodContext
  options: InstructionsPodOptions
  projectDirectory: string
}): Promise<readonly string[]> => {
  await startTurn(args)
  return await step(args)
}

export const touch = async (args: {
  ctx: PluginPodContext
  name: string
  input: unknown
}): Promise<void> => {
  await args.ctx.append([
    {
      type: 'tool-called',
      callId: toCallId('c1'),
      name: args.name,
      input: args.input,
      ordinal: 0,
    },
  ])
}

export const personal = (text: string | null): InstructionsPodOptions => ({
  personal: async () => text,
})

export const file = (text: string, size?: number): FakeNode => ({ kind: 'file', text, size })

export const readFiles = (calls: readonly CallOp[]): readonly string[] =>
  calls.flatMap((call) => (call.op === 'readFile' ? [call.path] : []))
