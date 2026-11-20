import {
  EToolEffect,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Assembled,
  type EventDraft,
  type Hash,
  type ToolCall,
  type V2Event,
} from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_ROUTINES,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
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

const stampedOf = (args: { draft: EventDraft; seq: number }): V2Event =>
  ({
    ...args.draft,
    id: toEventId(`e-${args.seq}`),
    seq: args.seq,
    threadId: THREAD,
    runId: toRunId('r1'),
    depth: 0,
    at: '2026-11-20T00:00:00.000Z',
    epoch: 0,
    prevHash: '0' as Hash,
  }) as V2Event

export const THREAD = toThreadId('t1')

export const fakeDaemon = (nodes: Record<string, FakeNode>) => {
  const calls: CallOp[] = []
  const events: V2Event[] = []
  const record = (drafts: readonly EventDraft[]): void => {
    for (const draft of drafts) events.push(stampedOf({ draft, seq: events.length + 1 }))
  }

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
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    append: async () => undefined,
    notify: async () => undefined,
    events: () => events,
    call,
    onDaemonEvent: (_listener: (frame: DaemonEventFrame) => void) => () => undefined,
    live: () => undefined,
    log: () => undefined,
  }

  return { ctx, calls, nodes, events, record }
}

const hooksOf = (args: { ctx: PluginPodContext; options: InstructionsPodOptions }) =>
  instructionsPodOf(args.options).hooks?.(args.ctx)

export const startTurn = async (args: {
  ctx: PluginPodContext
  options: InstructionsPodOptions
  projectDirectory: string
}): Promise<void> => {
  const hooks = hooksOf(args)
  for (const hook of hooks?.beforeTurn ?? [])
    await hook.run({
      threadId: THREAD,
      projectDirectory: args.projectDirectory,
    })
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
  daemon: ReturnType<typeof fakeDaemon>
  name: string
  input: unknown
}): Promise<readonly EventDraft[]> => {
  const hooks = hooksOf({ ctx: args.daemon.ctx, options: personal(null) })
  const call: ToolCall = {
    callId: toCallId('c1'),
    name: args.name,
    input: args.input,
    effect: EToolEffect.Read,
    threadId: THREAD,
  }
  const drafts: EventDraft[] = []
  for (const hook of hooks?.afterTool ?? []) {
    const outcome = await hook.run({
      call,
      result: { ok: true, output: null, modelText: '' },
      projectDirectory: '/repo',
      signal: new AbortController().signal,
    })
    drafts.push(...(outcome.drafts ?? []))
  }
  args.daemon.record(drafts)
  return drafts
}

export const nestedKeysOf = (drafts: readonly EventDraft[]): readonly string[] =>
  drafts.flatMap((draft) => (draft.type === 'context-loaded' ? [draft.key] : []))

export const personal = (text: string | null): InstructionsPodOptions => ({
  personal: async () => text,
})

export const file = (text: string, size?: number): FakeNode => ({ kind: 'file', text, size })

export const readFiles = (calls: readonly CallOp[]): readonly string[] =>
  calls.flatMap((call) => (call.op === 'readFile' ? [call.path] : []))
