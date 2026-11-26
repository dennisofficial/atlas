import { describe, expect, it } from 'bun:test'

import {
  EMPTY_ANALYTICS,
  EMPTY_CLASSIFIER,
  EMPTY_CREW,
  EMPTY_MESSAGES,
  EMPTY_POD_RESOURCES,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { StdioClient, type McpCallResult } from '@dltech/atlas-plugin-mcp/pod'
import {
  ECallStatus,
  type CallOp,
  type CallResult,
  type DaemonEvent,
  type DaemonEventFrame,
} from '@dltech/atlas-protocol'

import { replayStableId, runInCallScope } from '../../calls/call-scope'
import { pluginCallOf } from '../plugin-call'
import type { RecordedStep, StepRecord } from '../record/call-steps'

const SEARCH = {
  name: 'search',
  description: 'Find documentation',
  inputSchema: { type: 'object' },
}

const TRANSPORT = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const SERVER_ID = 's1.docs'

type Line = { seq: number; line: string }

type Sent = { id: string; method: string }

const mcpDaemonOf = () => {
  const listeners = new Set<(frame: DaemonEventFrame) => void>()
  const lines: Line[] = []
  const sends: Sent[] = []
  const effects: string[] = []
  const responses = new Map<string, unknown>()
  const results = new Map<string, CallResult>()
  const spawns: string[] = []
  let seq = 0

  const publish = (value: unknown): void => {
    seq += 1
    const line = JSON.stringify(value)
    lines.push({ seq, line })
    const event: DaemonEvent = { type: 'mcp.message', serverId: SERVER_ID, seq, line }
    for (const listener of [...listeners]) listener({ kind: 'event', event })
  }

  const answer = (message: { id?: unknown; method?: string; params?: { name?: string } }): void => {
    if (message.method === 'initialize') {
      publish({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: 'docs', version: '1' },
        },
      })
      return
    }
    if (message.method === 'tools/list') {
      publish({ jsonrpc: '2.0', id: message.id, result: { tools: [SEARCH] } })
      return
    }
    if (message.method !== 'tools/call') return
    const name = message.params?.name ?? ''
    effects.push(name)
    const response = {
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text: `ran ${name}` }] },
    }
    responses.set(String(message.id), response)
    publish(response)
  }

  const call = async (op: CallOp): Promise<CallResult> => {
    if (op.op === 'mcp.spawn') {
      spawns.push(op.serverId)
      const attached = spawns.length > 1
      return {
        status: ECallStatus.Ok,
        op: 'mcp.spawn',
        value: { serverId: op.serverId, pid: 1, attached, seq: attached ? lines.length : 0 },
      }
    }
    if (op.op === 'mcp.send') {
      const message = JSON.parse(op.line) as {
        id?: unknown
        method?: string
        params?: { name?: string }
      }
      sends.push({ id: String(message.id), method: message.method ?? '' })
      answer(message)
      return { status: ECallStatus.Ok, op: 'mcp.send', value: null }
    }
    if (op.op === 'mcp.read') {
      return {
        status: ECallStatus.Ok,
        op: 'mcp.read',
        value: {
          lines: lines.filter((entry) => entry.seq > op.afterSeq),
          stderr: [],
          ended: null,
        },
      }
    }
    if (op.op === 'mcp.close') {
      return { status: ECallStatus.Ok, op: 'mcp.close', value: { exitCode: 0, signal: null } }
    }
    throw new Error(`the fake daemon does not answer ${op.op}`)
  }

  const onDaemonEvent = (listener: (frame: DaemonEventFrame) => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    call,
    onDaemonEvent,
    effects,
    results,
    sends,
    toolsCalls: (): Sent[] => sends.filter((sent) => sent.method === 'tools/call'),
    replay: (id: string): void => {
      const response = responses.get(id)
      if (response !== undefined) publish(response)
    },
  }
}

type FakeDaemon = ReturnType<typeof mcpDaemonOf>

const isStepKey = (key: string): boolean => /\.\d+$/.test(key)

const podOf = (args: { daemon: FakeDaemon; facts: RecordedStep[] }) => {
  let held: StdioClient | undefined
  const call = pluginCallOf({
    invoke: async (request) => {
      const stored = request.replayed === true ? args.daemon.results.get(request.key) : undefined
      if (stored !== undefined) {
        if (request.op.op === 'mcp.send') {
          args.daemon.replay(String((JSON.parse(request.op.line) as { id?: unknown }).id))
        }
        return stored
      }
      const result = await args.daemon.call(request.op)
      if (isStepKey(request.key)) args.daemon.results.set(request.key, result)
      return result
    },
    steps: {
      recorded: (scope) => args.facts.filter((fact) => fact.key.startsWith(`${scope}.`)),
      record: async (step: StepRecord) => {
        args.facts.push(step)
      },
    },
    bootId: () => 'boot-a',
  })
  const ctx: PluginPodContext = {
    sessionId: 's1',
    workspaceDirectory: '/repo',
    control: podControlStub,
    resources: EMPTY_POD_RESOURCES,
    crew: EMPTY_CREW,
    messages: EMPTY_MESSAGES,
    classifier: EMPTY_CLASSIFIER,
    analytics: EMPTY_ANALYTICS,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    append: async () => undefined,
    notify: async () => undefined,
    events: () => [],
    call,
    live: () => undefined,
    onDaemonEvent: args.daemon.onDaemonEvent,
    log: () => undefined,
    replayStableId: () => replayStableId(),
  }
  return {
    client: (): StdioClient => {
      held ??= new StdioClient({ ctx, serverId: SERVER_ID, transport: TRANSPORT })
      return held
    },
  }
}

const inCall = <T>(scopeKey: string, body: () => Promise<T>): Promise<T> =>
  runInCallScope({ scopeKey, body })

const textOf = (result: McpCallResult): string => JSON.stringify(result.content)

describe('an MCP tool step replayed after a handoff', () => {
  it('runs the daemon effect once when the replayed call reconnects on its own', async () => {
    const daemon = mcpDaemonOf()
    const facts: RecordedStep[] = []

    const first = podOf({ daemon, facts })
    await inCall('call-0', async () => {
      await first.client().connect()
    })
    const before = await inCall('call-1', async () =>
      first.client().callTool({ name: 'search', input: { q: 'docs' } }),
    )
    first.client().detach()

    const second = podOf({ daemon, facts })
    const after = await inCall('call-1', async () => {
      const client = second.client()
      await client.connect()
      return await client.callTool({ name: 'search', input: { q: 'docs' } })
    })

    expect(daemon.effects).toEqual(['search'])
    expect(daemon.toolsCalls()).toHaveLength(1)
    expect(textOf(after)).toBe(textOf(before))
    expect(facts.map((fact) => fact.key)).toContain('call-1.0')
  })

  it('keeps the handshake out of the ids a call scope hands out', async () => {
    const daemon = mcpDaemonOf()
    const facts: RecordedStep[] = []
    const pod = podOf({ daemon, facts })

    await inCall('call-1', async () => {
      await pod.client().connect()
      await pod.client().callTool({ name: 'search', input: { q: 'docs' } })
    })

    expect(daemon.toolsCalls().map((sent) => sent.id)).toEqual(['call-1#0'])
  })

  it('sends both requests fresh outside a call scope, and records no step', async () => {
    const daemon = mcpDaemonOf()
    const facts: RecordedStep[] = []
    const pod = podOf({ daemon, facts })

    await pod.client().connect()
    await pod.client().callTool({ name: 'search', input: { q: 'docs' } })
    await pod.client().callTool({ name: 'search', input: { q: 'docs' } })

    expect(daemon.effects).toEqual(['search', 'search'])
    expect(new Set(daemon.toolsCalls().map((sent) => sent.id)).size).toBe(2)
    expect(facts).toHaveLength(0)
  })
})
