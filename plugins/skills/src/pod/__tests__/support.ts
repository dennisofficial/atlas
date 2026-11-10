import { basename, dirname } from 'node:path'

import { toThreadId, type Assembled } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  EMPTY_MCP_CONTROL,
} from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { skillsPodOf } from '..'
import type {
  CloudSkillBody,
  CloudSkillEntry,
  CloudSkillSource,
  CloudSkillText,
  CloudSkillWriter,
} from '../port'

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
    if (op.op === 'mkdir') {
      const segments = op.path.split('/').filter((part) => part !== '')
      for (let index = 1; index <= segments.length; index += 1) {
        const path = `/${segments.slice(0, index).join('/')}`
        const node = nodes[path]
        if (node !== undefined && node.kind !== 'dir')
          return failed(op.op, `not a directory: ${path}`)
        nodes[path] = { kind: 'dir' }
      }
      return ok(op.op, null)
    }
    if (op.op === 'writeFile') {
      const parent = dirname(op.path)
      if (nodes[parent]?.kind !== 'dir') return failed(op.op, `no such directory: ${parent}`)
      nodes[op.path] = { kind: 'file', text: op.content }
      return ok(op.op, null)
    }
    if (op.op === 'remove') {
      for (const path of Object.keys(nodes))
        if (path === op.path || path.startsWith(`${op.path}/`)) delete nodes[path]
      return ok(op.op, null)
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
      mcp: EMPTY_MCP_CONTROL,
      webSearch: { config: async () => ({ backend: undefined, key: undefined }) },
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

  return { ctx, calls, nodes }
}

const bodyAt = (text: string | undefined): CloudSkillBody | null =>
  text === undefined ? null : { text, revision: 1, hash: `h-${text.length}` }

export const fakeCloud = (args: {
  entries: readonly CloudSkillEntry[]
  texts?: Record<string, string>
  frontmatter?: readonly CloudSkillText[]
}): CloudSkillSource => {
  const texts = args.texts ?? {}
  return {
    entries: () => args.entries,
    frontmatter: async () => args.frontmatter ?? [],
    body: async (entry) => bodyAt(texts[`${entry.scope}:${entry.name}`]),
    file: async (entry, path) => bodyAt(texts[`${entry.scope}:${entry.name}:${path}`]),
  }
}

export const fakeWrites = (): CloudSkillWriter & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    write: async (request) => {
      calls.push(
        `write ${request.scope}:${request.name}:${request.path}:${String(request.baseRevision)}`,
      )
      return { ok: true, revision: request.baseRevision === null ? 1 : request.baseRevision + 1 }
    },
    remove: async (request) => {
      calls.push(`remove ${request.scope}:${request.name}`)
      return { ok: true, revision: 0 }
    },
  }
}

export const invoke = async (args: {
  ctx: PluginPodContext
  cloud: CloudSkillSource
  writes?: CloudSkillWriter | undefined
  name: string
  input: unknown
  projectDirectory?: string
}) => {
  const tool = skillsPodOf({ cloud: args.cloud, writes: args.writes })
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
  writes?: CloudSkillWriter | undefined
  projectDirectory?: string
}): Promise<readonly string[]> => {
  const pod = skillsPodOf({ cloud: args.cloud, writes: args.writes })
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
