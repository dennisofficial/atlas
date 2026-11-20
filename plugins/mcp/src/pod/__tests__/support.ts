import { toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  MacOfflineError,
  type PluginPodContext,
  type PodMcpControl,
  type PodMcpProxyChannel,
  type PodMcpProxyMessage,
  type PodMcpProxyTransport,
} from '@dltech/atlas-plugin-sdk'
import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import {
  type CallResult,
  type DaemonEvent,
  type DaemonEventFrame,
  ECallFailure,
  ECallStatus,
} from '@dltech/atlas-protocol'

import type { McpCallResult, McpToolInfo } from '../types'

export type FakeBehaviour = {
  tools?: readonly McpToolInfo[]
  instructions?: string
  answer?: (args: { name: string; arguments?: unknown }) => McpCallResult
  exit?: { exitCode: number | null; signal: string | null }
  stderr?: readonly string[]
}

type Line = { seq: number; line: string }

const DEFAULT_EVENT_LINE_BYTES = 1_048_576

export const fakeDaemon = (
  behaviours: Readonly<Record<string, FakeBehaviour>> = {},
  options: { eventLineBytes?: number } = {},
) => {
  const eventLineBytes = options.eventLineBytes ?? DEFAULT_EVENT_LINE_BYTES
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
      if (behaviour.exit !== undefined) {
        const exit = behaviour.exit
        queueMicrotask(() => {
          ended.set(serverId, exit)
          publish({ type: 'mcp.exited', serverId, ...exit })
        })
      }
      return { status: ECallStatus.Ok, op: 'mcp.spawn', value: { serverId, pid: 1 } }
    }
    if (op.op === 'mcp.send') {
      const serverId = String(op['serverId'])
      if (behaviours[serverId]?.exit === undefined) answer(serverId, JSON.parse(String(op['line'])))
      return { status: ECallStatus.Ok, op: 'mcp.send', value: null }
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
    files,
    lines,
    reads: () => reads,
  }
}

export type FakeProxyBehaviour = {
  tools?: readonly McpToolInfo[]
  instructions?: string
  answer?: (args: { name: string; arguments?: unknown }) => McpCallResult
  silent?: boolean
}

export type FakeOpen = { name: string; transport: PodMcpProxyTransport; waitMs: number }

type ChannelListeners = {
  message: Set<(message: PodMcpProxyMessage) => void>
  closed: Set<(reason: string) => void>
}

export const fakeProxyControl = (
  args: {
    behaviours?: Readonly<Record<string, FakeProxyBehaviour>>
    online?: boolean
    openError?: Error
  } = {},
) => {
  const behaviours = args.behaviours ?? {}
  const sent: { server: string; message: PodMcpProxyMessage }[] = []
  const opens: FakeOpen[] = []
  const closed: string[] = []
  const channels = new Map<string, ChannelListeners>()
  let online = args.online ?? true
  let openError = args.openError

  const deliver = (server: string, message: PodMcpProxyMessage): void => {
    if (behaviours[server]?.silent === true) return
    for (const listener of [...(channels.get(server)?.message ?? [])]) listener(message)
  }

  const answer = (server: string, message: Record<string, unknown>): void => {
    const behaviour = behaviours[server] ?? {}
    const id = message['id']
    const reply = (result: unknown): void => {
      deliver(server, { jsonrpc: '2.0', id: id as string, result })
    }
    if (message['method'] === 'initialize') {
      reply({
        protocolVersion: '2025-06-18',
        capabilities: {},
        serverInfo: { name: server, version: '1' },
        ...(behaviour.instructions === undefined ? {} : { instructions: behaviour.instructions }),
      })
      return
    }
    if (message['method'] === 'tools/list') {
      reply({ tools: behaviour.tools ?? [] })
      return
    }
    if (message['method'] === 'tools/call') {
      const params = (message['params'] ?? {}) as { name?: string; arguments?: unknown }
      reply(
        behaviour.answer?.({ name: params.name ?? '', arguments: params.arguments }) ?? {
          content: [{ type: 'text', text: 'ok' }],
        },
      )
    }
  }

  const proxy = async (request: {
    name: string
    transport: PodMcpProxyTransport
    waitMs: number
  }): Promise<PodMcpProxyChannel> => {
    if (openError !== undefined) throw openError
    if (!online) throw new MacOfflineError()
    opens.push({ name: request.name, transport: request.transport, waitMs: request.waitMs })
    const server = request.name
    channels.set(server, { message: new Set(), closed: new Set() })
    return {
      send: (message) => {
        sent.push({ server, message })
        const record = message as Record<string, unknown>
        if (record['id'] === undefined) return
        answer(server, record)
      },
      onMessage: (listener) => {
        channels.get(server)?.message.add(listener)
      },
      onClosed: (listener) => {
        channels.get(server)?.closed.add(listener)
      },
      close: () => {
        closed.push(server)
      },
    }
  }

  const control: PodMcpControl = { ...EMPTY_MCP_CONTROL, proxy }

  return {
    control,
    sent,
    opens,
    closed,
    methods: (server: string): (string | undefined)[] =>
      sent.filter((entry) => entry.server === server).map((entry) => entry.message.method),
    setOnline: (next: boolean): void => {
      online = next
    },
    setOpenError: (error: Error | undefined): void => {
      openError = error
    },
    closeChannels: (reason: string): void => {
      for (const listeners of channels.values()) {
        for (const listener of [...listeners.closed]) listener(reason)
      }
    },
  }
}

export const rig = (
  daemon: ReturnType<typeof fakeDaemon>,
  over: { mcp?: PodMcpControl } = {},
): PluginPodContext => ({
  sessionId: 's1',
  workspaceDirectory: '/repo',
  control: over.mcp === undefined ? podControlStub : { ...podControlStub, mcp: over.mcp },
  crew: EMPTY_CREW,
  sessions: EMPTY_SESSIONS,
  worktrees: EMPTY_WORKTREES,
  append: async () => undefined,
  notify: async () => undefined,
  events: () => [],
  call: (op) => daemon.call(op),
  live: () => undefined,
  onDaemonEvent: daemon.onDaemonEvent,
  log: () => undefined,
})

export const invocation = (input: unknown) => ({
  input,
  signal: new AbortController().signal,
  idempotencyKey: 'k',
  projectDirectory: '/repo',
  threadId: toThreadId('t1'),
})
