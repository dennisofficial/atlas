import { basename, dirname } from 'node:path'

import { toThreadId, type Assembled } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { skillsPodOf } from '..'
import type { CloudSkillEntry, CloudSkillSource, CloudSkillText } from '../port'

export type FakeNode =
  | { kind: 'file'; text: string }
  | { kind: 'dir' }
  | { kind: 'link'; target: string }

const ok = (op: string, value: unknown): CallResult =>
  ({ status: ECallStatus.Ok, op, value }) as CallResult

const failed = (op: string, message: string): CallResult =>
  ({ status: ECallStatus.Failed, op, error: { code: 'not-found', message } }) as CallResult

export const fakeDaemon = (nodes: Record<string, FakeNode>) => {
  const calls: CallOp[] = []

  const targetOf = (path: string): string | undefined => {
    const seen = new Set<string>()
    let current: string | undefined = path
    while (current !== undefined && !seen.has(current)) {
      seen.add(current)
      const node: FakeNode | undefined = nodes[current]
      if (node === undefined) return undefined
      if (node.kind !== 'link') return current
      current = node.target
    }
    return undefined
  }

  const call = async (op: CallOp): Promise<CallResult> => {
    calls.push(op)
    if (op.op === 'stat') {
      const real = targetOf(op.path)
      const node = real === undefined ? undefined : nodes[real]
      if (real === undefined || node === undefined || node.kind === 'link')
        return failed(op.op, `no such file: ${op.path}`)
      return ok(op.op, {
        size: 1,
        mode: 0o644,
        mtimeMs: 0,
        isFile: node.kind === 'file',
        isDirectory: node.kind === 'dir',
      })
    }
    if (op.op === 'readDirectory') {
      const real = targetOf(op.path)
      const node = real === undefined ? undefined : nodes[real]
      if (real === undefined || node === undefined || node.kind !== 'dir')
        return failed(op.op, `no such directory: ${op.path}`)
      const entries = Object.entries(nodes)
        .filter(([path]) => dirname(path) === real)
        .map(([path, child]) => ({
          name: basename(path),
          isFile: child.kind === 'file',
          isDirectory: child.kind === 'dir',
        }))
      return ok(op.op, entries)
    }
    if (op.op === 'readFile') {
      const real = targetOf(op.path)
      const node = real === undefined ? undefined : nodes[real]
      if (real === undefined || node === undefined || node.kind !== 'file')
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
    },
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    append: async () => undefined,
    events: () => [],
    call,
    onDaemonEvent: () => () => undefined,
    live: () => undefined,
    log: () => undefined,
  }

  return { ctx, calls }
}

export const fakeCloud = (args: {
  entries: readonly CloudSkillEntry[]
  texts?: Record<string, string>
  frontmatter?: readonly CloudSkillText[]
}): CloudSkillSource => {
  const texts = args.texts ?? {}
  return {
    entries: () => args.entries,
    frontmatter: async () => args.frontmatter ?? [],
    text: async (entry) => texts[`${entry.scope}:${entry.name}`] ?? null,
    file: async (entry, path) => texts[`${entry.scope}:${entry.name}:${path}`] ?? null,
  }
}

export const invoke = async (args: {
  ctx: PluginPodContext
  cloud: CloudSkillSource
  name: string
  input: unknown
  projectDirectory?: string
}) => {
  const tool = skillsPodOf({ cloud: args.cloud })
    .tools?.(args.ctx)
    .find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: args.projectDirectory ?? '/repo',
    threadId: toThreadId('t1'),
  })
}

export const textOf = (outcome: Awaited<ReturnType<typeof invoke>>): string =>
  outcome.ok ? outcome.modelText : outcome.reason

export const turn = async (args: {
  ctx: PluginPodContext
  cloud: CloudSkillSource
  projectDirectory?: string
}): Promise<readonly string[]> => {
  const pod = skillsPodOf({ cloud: args.cloud })
  const hooks = pod.hooks?.(args.ctx)
  for (const hook of hooks?.beforeTurn ?? [])
    await hook.run({
      threadId: toThreadId('t1'),
      projectDirectory: args.projectDirectory ?? '/repo',
    })
  const blocks: string[] = []
  let assembled: Assembled = { system: [], messages: [] }
  for (const hook of hooks?.beforeStep ?? []) assembled = await hook.run({ assembled, trace: [] })
  for (const block of assembled.system) blocks.push(block.text)
  return blocks
}

export const skillDir = (name: string, body: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: does ${name}\n${extra}---\n\n${body}`
