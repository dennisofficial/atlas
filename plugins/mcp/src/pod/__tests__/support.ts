import { toThreadId } from '@dltech/atlas-core'
import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ECallFailure, ECallStatus, type CallResult } from '@dltech/atlas-protocol'

import type { McpCallResult, McpToolInfo } from '../types'

export type FakeBehaviour = {
  tools?: readonly McpToolInfo[]
  instructions?: string
  answer?: (args: { name: string; arguments?: unknown }) => McpCallResult
  exit?: { exitCode: number | null; signal: string | null }
  stderr?: readonly string[]
  unauthorized?: boolean
}

type Line = { seq: number; line: string }

export const fakeDaemon = (behaviours: Readonly<Record<string, FakeBehaviour>> = {}) => {
  const lines = new Map<string, Line[]>()
  const ended = new Map<string, { exitCode: number | null; signal: string | null }>()
  const files = new Map<string, string>()
  const spawns: {
    serverId: string
    command: string
    args: readonly string[]
    env?: Record<string, string>
  }[] = []
  const closed: string[] = []

  const push = (serverId: string, value: unknown): void => {
    const held = lines.get(serverId) ?? []
    held.push({ seq: held.length + 1, line: JSON.stringify(value) })
    lines.set(serverId, held)
  }

  const answer = (serverId: string, message: Record<string, unknown>): void => {
    const behaviour = behaviours[serverId] ?? {}
    const id = message['id']
    if (message['method'] === 'initialize') {
      push(serverId, {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: serverId, version: '1' },
          ...(behaviour.instructions === undefined ? {} : { instructions: behaviour.instructions }),
        },
      })
      return
    }
    if (message['method'] === 'tools/list') {
      push(serverId, { jsonrpc: '2.0', id, result: { tools: behaviour.tools ?? [] } })
      return
    }
    if (message['method'] === 'tools/call') {
      const params = (message['params'] ?? {}) as { name?: string; arguments?: unknown }
      if (behaviour.unauthorized === true) {
        push(serverId, { jsonrpc: '2.0', id, error: { code: -32_000, message: 'unauthorized' } })
        return
      }
      const result = behaviour.answer?.({
        name: params.name ?? '',
        arguments: params.arguments,
      }) ?? {
        content: [{ type: 'text', text: 'ok' }],
      }
      push(serverId, { jsonrpc: '2.0', id, result })
    }
  }

  const call = async (op: { op: string } & Record<string, unknown>): Promise<CallResult> => {
    if (op.op === 'mcp.spawn') {
      const serverId = String(op['serverId'])
      spawns.push({
        serverId,
        command: String(op['command']),
        args: (op['args'] as readonly string[] | undefined) ?? [],
        ...(op['env'] === undefined ? {} : { env: op['env'] as Record<string, string> }),
      })
      const behaviour = behaviours[serverId] ?? {}
      const env = op['env'] as Record<string, string> | undefined
      const path = env?.['ATLAS_MCP_STDERR']
      if (behaviour.stderr !== undefined && path !== undefined)
        files.set(path, behaviour.stderr.join('\n'))
      if (behaviour.exit !== undefined) ended.set(serverId, behaviour.exit)
      return { status: ECallStatus.Ok, op: 'mcp.spawn', value: { serverId, pid: 1 } }
    }
    if (op.op === 'mcp.send') {
      const serverId = String(op['serverId'])
      answer(serverId, JSON.parse(String(op['line'])))
      return { status: ECallStatus.Ok, op: 'mcp.send', value: null }
    }
    if (op.op === 'mcp.read') {
      const serverId = String(op['serverId'])
      const after = Number(op['afterSeq'])
      return {
        status: ECallStatus.Ok,
        op: 'mcp.read',
        value: {
          lines: (lines.get(serverId) ?? []).filter((entry) => entry.seq > after),
          ended: ended.get(serverId) ?? null,
        },
      }
    }
    if (op.op === 'mcp.close') {
      const serverId = String(op['serverId'])
      closed.push(serverId)
      ended.set(serverId, { exitCode: 0, signal: null })
      return { status: ECallStatus.Ok, op: 'mcp.close', value: { exitCode: 0, signal: null } }
    }
    if (op.op === 'mcp.list') {
      return { status: ECallStatus.Ok, op: 'mcp.list', value: [] }
    }
    if (op.op === 'readFile') {
      const path = String(op['path'])
      const text = files.get(path)
      if (text === undefined)
        return {
          status: ECallStatus.Failed,
          op: 'readFile',
          error: { code: ECallFailure.NotFound, message: `no such file: ${path}` },
        }
      return { status: ECallStatus.Ok, op: 'readFile', value: text }
    }
    if (op.op === 'remove') {
      files.delete(String(op['path']))
      return { status: ECallStatus.Ok, op: 'remove', value: null }
    }
    throw new Error(`the fake daemon does not answer ${op.op}`)
  }

  return { call, spawns, closed, files, lines }
}

export const rig = (daemon: ReturnType<typeof fakeDaemon>): PluginPodContext => ({
  sessionId: 's1',
  control: podControlStub,
  crew: EMPTY_CREW,
  sessions: EMPTY_SESSIONS,
  worktrees: EMPTY_WORKTREES,
  append: async () => undefined,
  events: () => [],
  call: (op) => daemon.call(op),
  live: () => undefined,
  onDaemonEvent: () => () => undefined,
  log: () => undefined,
})

export const turn = async (args: {
  ctx: PluginPodContext
  run: () => Promise<unknown>
}): Promise<void> => {
  await args.run()
}

export const invocation = (input: unknown) => ({
  input,
  signal: new AbortController().signal,
  idempotencyKey: 'k',
  projectDirectory: '/repo',
  threadId: toThreadId('t1'),
})
