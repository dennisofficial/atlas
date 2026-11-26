import { EDaemonCapability } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import type { McpStdioTransport } from '../../core'
import { StdioClient } from '../stdio'
import { McpTransportError } from '../types'
import { rig } from './rig'
import { fakeDaemon, type FakeBehaviour } from './support'

const serverId = 's1.docs'

const transport: McpStdioTransport = { kind: 'stdio', command: 'bun', args: ['run', 'server'] }

const requestCapable = { capabilities: [EDaemonCapability.McpRequest] }

const clientOf = (args: {
  daemon: ReturnType<typeof fakeDaemon>
  timeoutMs?: number
  onExit?: (reason: string) => void
}): StdioClient =>
  new StdioClient({
    ctx: rig(args.daemon),
    serverId,
    transport,
    specHash: 'h1',
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    ...(args.onExit === undefined ? {} : { onExit: args.onExit }),
  })

const thrownOf = async (run: Promise<unknown>): Promise<unknown> =>
  await run.catch((error: unknown) => error)

describe('a stdio tool call', () => {
  it('goes through mcp.request when the daemon advertises it', async () => {
    const daemon = fakeDaemon({}, requestCapable)
    const client = clientOf({ daemon })

    await client.connect()
    expect(daemon.requests).toHaveLength(0)

    const result = await client.callTool({ name: 'search', input: { q: 'x' } })

    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
    expect(daemon.requests).toEqual([
      {
        serverId,
        method: 'tools/call',
        params: { name: 'search', arguments: { q: 'x' } },
        timeoutMs: 30_000,
      },
    ])
  })

  it('carries the configured timeout into the request', async () => {
    const daemon = fakeDaemon({}, requestCapable)
    const client = clientOf({ daemon, timeoutMs: 1_234 })

    await client.connect()
    await client.callTool({ name: 'search', input: null })

    expect(daemon.requests[0]?.timeoutMs).toBe(1_234)
  })

  it('keeps mcp.send when the daemon does not advertise the capability', async () => {
    const daemon = fakeDaemon()
    const client = clientOf({ daemon })

    await client.connect()
    const result = await client.callTool({ name: 'search', input: { q: 'x' } })

    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
    expect(daemon.requests).toHaveLength(0)
  })

  it('forwards the signal to the daemon call', async () => {
    const daemon = fakeDaemon({}, requestCapable)
    const client = clientOf({ daemon })
    const controller = new AbortController()

    await client.connect()
    await client.callTool({ name: 'search', input: {}, signal: controller.signal })

    expect(daemon.signals[0]).toBe(controller.signal)
  })

  it('fails with the message of a JSON-RPC error response', async () => {
    const behaviour: FakeBehaviour = {
      request: { kind: 'json-rpc-error', message: 'no such tool' },
    }
    const daemon = fakeDaemon({ [serverId]: behaviour }, requestCapable)
    const client = clientOf({ daemon })

    await client.connect()
    const error = await thrownOf(client.callTool({ name: 'search', input: {} }))

    expect(error).toBeInstanceOf(McpTransportError)
    expect((error as Error).message).toBe('no such tool')
  })

  it('fails as timed out', async () => {
    const behaviour: FakeBehaviour = { request: { kind: 'timed-out' } }
    const daemon = fakeDaemon({ [serverId]: behaviour }, requestCapable)
    const client = clientOf({ daemon })

    await client.connect()
    const error = await thrownOf(client.callTool({ name: 'search', input: {} }))

    expect(error).toBeInstanceOf(McpTransportError)
    expect((error as Error).message).toBe('request timed out')
  })

  it('reports a failed daemon call as unreachable', async () => {
    const behaviour: FakeBehaviour = { request: { kind: 'failure', message: 'the lease was lost' } }
    const daemon = fakeDaemon({ [serverId]: behaviour }, requestCapable)
    const client = clientOf({ daemon })

    await client.connect()
    const error = await thrownOf(client.callTool({ name: 'search', input: {} }))

    expect(error).toBeInstanceOf(McpTransportError)
    expect((error as Error).message).toBe('could not reach the server: the lease was lost')
  })

  it('reports the exit of the server and keeps it for the next call', async () => {
    const behaviour: FakeBehaviour = {}
    const daemon = fakeDaemon({ [serverId]: behaviour }, requestCapable)
    const exited: string[] = []
    const client = clientOf({ daemon, onExit: (reason) => void exited.push(reason) })

    await client.connect()
    behaviour.exit = { exitCode: 2, signal: null }
    behaviour.stderr = ['bad config']

    const error = await thrownOf(client.callTool({ name: 'search', input: {} }))

    expect(error).toBeInstanceOf(McpTransportError)
    expect((error as Error).message).toBe('the server exited with code 2')
    expect((error as McpTransportError).stderr).toEqual(['bad config'])
    expect(exited).toEqual(['the server exited with code 2'])
    expect(await thrownOf(client.callTool({ name: 'search', input: {} }))).toBe(error)
  })
})
