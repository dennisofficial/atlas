import type { PodMcpControl } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { MAC_WAIT_MS, ProxyClient } from '../proxy'
import { fakeProxyControl } from './support'

const stdio = { kind: 'stdio' as const, command: 'paper' }

const clientOf = (args: {
  control: PodMcpControl
  timeoutMs?: number
  waitMs?: number
  onClosed?: (reason: string) => void
}): ProxyClient =>
  new ProxyClient({
    control: args.control,
    serverId: 'paper',
    transport: stdio,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    ...(args.waitMs === undefined ? {} : { waitMs: args.waitMs }),
    ...(args.onClosed === undefined ? {} : { onClosed: args.onClosed }),
  })

const settled = async <T>(promise: Promise<T>): Promise<T | Error> =>
  await promise.catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  )

describe('ProxyClient', () => {
  it('initializes, notifies, then lists tools over the Mac channel', async () => {
    const fake = fakeProxyControl({
      behaviours: {
        paper: {
          tools: [{ name: 'search', description: 'Find paper' }],
          instructions: 'Ask first.',
        },
      },
    })

    const connection = await clientOf({ control: fake.control }).connect()

    expect(connection.tools.map((tool) => tool.name)).toEqual(['search'])
    expect(connection.instructions).toBe('Ask first.')
    expect(fake.methods('paper')).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(fake.opens[0]).toMatchObject({ name: 'paper', transport: stdio, waitMs: MAC_WAIT_MS })
  })

  it('calls a tool through the channel', async () => {
    const fake = fakeProxyControl({
      behaviours: {
        paper: {
          answer: (call) => ({
            content: [{ type: 'text', text: `${call.name}:${JSON.stringify(call.arguments)}` }],
          }),
        },
      },
    })
    const client = clientOf({ control: fake.control })
    await client.connect()

    const result = await client.callTool({ name: 'search', input: { q: 'x' } })

    expect(result.content).toEqual([{ type: 'text', text: 'search:{"q":"x"}' }])
  })

  it('reports the Mac offline when the control refuses to open a channel', async () => {
    const fake = fakeProxyControl({ online: false })

    const outcome = await settled(clientOf({ control: fake.control }).connect())

    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toBe('Mac app offline')
  })

  it('keeps the Mac reason when the server could not be opened', async () => {
    const fake = fakeProxyControl({ openError: new Error('spawn failed: ENOENT') })

    const outcome = await settled(clientOf({ control: fake.control }).connect())

    expect((outcome as Error).message).toBe(
      "the Mac app could not open 'paper': spawn failed: ENOENT",
    )
  })

  it('rejects a request the Mac never answers once the timeout passes', async () => {
    const fake = fakeProxyControl({ behaviours: { paper: { silent: true } } })

    const outcome = await settled(clientOf({ control: fake.control, timeoutMs: 20 }).connect())

    expect((outcome as Error).message).toBe('request 1 timed out')
  })

  it('fails pending requests with the reason the Mac closed the channel', async () => {
    const reasons: string[] = []
    const fake = fakeProxyControl({ behaviours: { paper: { silent: true } } })
    const connecting = settled(
      clientOf({
        control: fake.control,
        timeoutMs: 5_000,
        onClosed: (reason) => void reasons.push(reason),
      }).connect(),
    )
    await new Promise((resolve) => setTimeout(resolve, 5))

    fake.closeChannels('mac-disconnected')

    expect(((await connecting) as Error).message).toBe('mac-disconnected')
    expect(reasons).toEqual(['mac-disconnected'])
  })
})
