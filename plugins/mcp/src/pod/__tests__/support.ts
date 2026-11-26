import {
  type CallResult,
  type DaemonEvent,
  type DaemonEventFrame,
  ECallFailure,
  ECallStatus,
} from '@dltech/atlas-protocol'

import type { McpCallResult, McpToolInfo } from '../types'

export type FakeRequest =
  | { kind: 'json-rpc-error'; message: string }
  | { kind: 'timed-out' }
  | { kind: 'failure'; message: string }

export type FakeBehaviour = {
  tools?: readonly McpToolInfo[]
  instructions?: string
  answer?: (args: { name: string; arguments?: unknown }) => McpCallResult
  exit?: { exitCode: number | null; signal: string | null }
  stderr?: readonly string[]
  request?: FakeRequest
}

type Line = { seq: number; line: string }

const DEFAULT_EVENT_LINE_BYTES = 1_048_576

export const fakeDaemon = (
  behaviours: Readonly<Record<string, FakeBehaviour>> = {},
  options: { eventLineBytes?: number; capabilities?: readonly string[] } = {},
) => {
  const eventLineBytes = options.eventLineBytes ?? DEFAULT_EVENT_LINE_BYTES
  const capabilities = options.capabilities ?? []
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
  const requests: {
    serverId: string
    method: string
    params: unknown
    timeoutMs: number
  }[] = []
  const signals: (AbortSignal | undefined)[] = []
  const listeners: ((frame: DaemonEventFrame) => void)[] = []
  let reads = 0

  const publish = (event: DaemonEvent): void => {
    for (const listener of listeners) listener({ kind: 'event', event })
  }

  const push = (serverId: string, value: unknown): void => {
    const held = lines.get(serverId) ?? []
    const seq = held.length + 1
    const line = JSON.stringify(value)
    held.push({ seq, line })
    lines.set(serverId, held)
    if (line.length > eventLineBytes) {
      publish({ type: 'mcp.dropped', serverId, seq })
      return
    }
    publish({ type: 'mcp.message', serverId, seq, line })
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
      const result = behaviour.answer?.({
        name: params.name ?? '',
        arguments: params.arguments,
      }) ?? { content: [{ type: 'text', text: 'ok' }] }
      push(serverId, { jsonrpc: '2.0', id, result })
    }
  }

  const call = async (
    op: { op: string } & Record<string, unknown>,
    options: { signal?: AbortSignal | undefined } = {},
  ): Promise<CallResult> => {
    if (op.op === 'mcp.spawn') {
      const serverId = String(op['serverId'])
      spawns.push({
        serverId,
        command: String(op['command']),
        args: (op['args'] as readonly string[] | undefined) ?? [],
        ...(op['env'] === undefined ? {} : { env: op['env'] as Record<string, string> }),
      })
      const behaviour = behaviours[serverId] ?? {}
      if (behaviour.exit !== undefined) {
        const exit = behaviour.exit
        queueMicrotask(() => {
          ended.set(serverId, exit)
          publish({ type: 'mcp.exited', serverId, ...exit })
        })
      }
      const attached = spawns.filter((entry) => entry.serverId === serverId).length > 1
      return {
        status: ECallStatus.Ok,
        op: 'mcp.spawn',
        value: {
          serverId,
          pid: 1,
          attached,
          seq: attached ? (lines.get(serverId)?.length ?? 0) : 0,
        },
      }
    }
    if (op.op === 'mcp.send') {
      const serverId = String(op['serverId'])
      if (behaviours[serverId]?.exit === undefined) answer(serverId, JSON.parse(String(op['line'])))
      return { status: ECallStatus.Ok, op: 'mcp.send', value: null }
    }
    if (op.op === 'mcp.request') {
      const serverId = String(op['serverId'])
      requests.push({
        serverId,
        method: String(op['method']),
        params: op['params'],
        timeoutMs: Number(op['timeoutMs']),
      })
      signals.push(options.signal)
      const behaviour = behaviours[serverId] ?? {}
      if (behaviour.exit !== undefined) {
        return {
          status: ECallStatus.Ok,
          op: 'mcp.request',
          value: {
            kind: 'exited',
            exit: behaviour.exit,
            stderr: behaviour.stderr ?? [],
          },
        }
      }
      const request = behaviour.request
      if (request?.kind === 'timed-out') {
        return { status: ECallStatus.Ok, op: 'mcp.request', value: { kind: 'timed-out' } }
      }
      if (request?.kind === 'failure') {
        return {
          status: ECallStatus.Failed,
          op: 'mcp.request',
          error: { code: ECallFailure.Internal, message: request.message },
        }
      }
      if (request?.kind === 'json-rpc-error') {
        return {
          status: ECallStatus.Ok,
          op: 'mcp.request',
          value: {
            kind: 'response',
            response: {
              jsonrpc: '2.0',
              id: null,
              error: { code: -32603, message: request.message },
            },
          },
        }
      }
      const params = (op['params'] ?? {}) as { name?: string; arguments?: unknown }
      const result = behaviour.answer?.({
        name: params.name ?? '',
        arguments: params.arguments,
      }) ?? { content: [{ type: 'text', text: 'ok' }] }
      return {
        status: ECallStatus.Ok,
        op: 'mcp.request',
        value: { kind: 'response', response: { jsonrpc: '2.0', id: null, result } },
      }
    }
    if (op.op === 'mcp.read') {
      reads += 1
      const serverId = String(op['serverId'])
      const after = Number(op['afterSeq'])
      return {
        status: ECallStatus.Ok,
        op: 'mcp.read',
        value: {
          lines: (lines.get(serverId) ?? []).filter((entry) => entry.seq > after),
          stderr: behaviours[serverId]?.stderr ?? [],
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
    throw new Error(`the fake daemon does not answer ${op.op}`)
  }

  const kill = (
    serverId: string,
    exit: { exitCode: number | null; signal: string | null } = {
      exitCode: null,
      signal: 'SIGTERM',
    },
  ): void => {
    ended.set(serverId, exit)
    publish({ type: 'mcp.exited', serverId, ...exit })
  }

  const onDaemonEvent = (listener: (frame: DaemonEventFrame) => void): (() => void) => {
    listeners.push(listener)
    return () => {
      const at = listeners.indexOf(listener)
      if (at !== -1) listeners.splice(at, 1)
    }
  }

  return {
    call,
    onDaemonEvent,
    kill,
    spawns,
    closed,
    requests,
    signals,
    capabilities: () => capabilities,
    files,
    lines,
    reads: () => reads,
  }
}

export * from './proxy-rig'
export * from './recording'
export * from './rig'
