import { describe, expect, test } from 'bun:test'

import {
  jsonRpcMessageSchema,
  macClientFrameSchema,
  macHostFrameSchema,
  macLinkChannel,
  macLinkPresenceKey,
  macRelayFrameSchema,
  macServerTransportSchema,
} from '../mac-link'

const transportOf = { kind: 'stdio' as const, command: 'paper', args: ['mcp'] }

describe('mac-link keys', () => {
  test('namespaces presence and frames per user', () => {
    expect(macLinkPresenceKey('u1')).toBe('atlas:mac-link:presence:u1')
    expect(macLinkChannel('u1')).toBe('atlas:mac-link:frames:u1')
  })
})

describe('macServerTransportSchema', () => {
  test('round-trips a stdio transport with args and env', () => {
    const parsed = macServerTransportSchema.parse({
      ...transportOf,
      env: { PAPER_KEY: 'k' },
    })
    expect(parsed).toEqual({
      kind: 'stdio',
      command: 'paper',
      args: ['mcp'],
      env: { PAPER_KEY: 'k' },
    })
  })

  test('round-trips an http transport', () => {
    const parsed = macServerTransportSchema.parse({
      kind: 'http',
      url: 'http://127.0.0.1:7777/mcp',
      headers: { authorization: 'Bearer x' },
    })
    expect(parsed.kind).toBe('http')
  })

  test('rejects a transport without a kind', () => {
    expect(macServerTransportSchema.safeParse({ command: 'paper' }).success).toBe(false)
  })

  test('rejects a non-http url', () => {
    expect(macServerTransportSchema.safeParse({ kind: 'http', url: 'ftp://x' }).success).toBe(false)
  })
})

describe('macClientFrameSchema', () => {
  test('round-trips every Mac to host frame', () => {
    const frames = [
      { type: 'hello', v: 1, token: 'tok', deviceId: 'dev', appVersion: '1.0.0' },
      { type: 'opened', channelId: 'c1' },
      { type: 'open-failed', channelId: 'c1', reason: 'spawn failed' },
      { type: 'rpc', channelId: 'c1', message: { jsonrpc: '2.0', id: 1, result: {} } },
      { type: 'closed', channelId: 'c1', reason: 'exit' },
      { type: 'pong' },
    ]
    for (const frame of frames) expect(macClientFrameSchema.parse(frame)).toEqual(frame as never)
  })

  test('rejects a hello without a token', () => {
    const parsed = macClientFrameSchema.safeParse({
      type: 'hello',
      v: 1,
      deviceId: 'dev',
      appVersion: '1.0.0',
    })
    expect(parsed.success).toBe(false)
  })

  test('rejects an unknown type', () => {
    expect(macClientFrameSchema.safeParse({ type: 'nope' }).success).toBe(false)
  })

  test('rejects an open frame on the client union', () => {
    expect(
      macClientFrameSchema.safeParse({
        type: 'open',
        channelId: 'c1',
        server: { name: 'paper', transport: transportOf },
      }).success,
    ).toBe(false)
  })
})

describe('macHostFrameSchema', () => {
  test('round-trips every host to Mac frame', () => {
    const frames = [
      { type: 'ready', deviceId: 'dev' },
      { type: 'open', channelId: 'c1', server: { name: 'paper', transport: transportOf } },
      { type: 'rpc', channelId: 'c1', message: { jsonrpc: '2.0', method: 'tools/list' } },
      { type: 'close', channelId: 'c1' },
      { type: 'ping' },
    ]
    for (const frame of frames) expect(macHostFrameSchema.parse(frame)).toEqual(frame as never)
  })

  test('rejects an open frame whose transport is missing a kind', () => {
    const parsed = macHostFrameSchema.safeParse({
      type: 'open',
      channelId: 'c1',
      server: { name: 'paper', transport: { command: 'paper' } },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('macRelayFrameSchema', () => {
  test('accepts a relayed open', () => {
    const parsed = macRelayFrameSchema.parse({
      origin: 'i1',
      target: 'i2',
      frame: { type: 'open', channelId: 'c1', server: { name: 'paper', transport: transportOf } },
    })
    expect(parsed.frame.type).toBe('open')
  })

  test('rejects a relayed hello, which carries the bearer', () => {
    const parsed = macRelayFrameSchema.safeParse({
      origin: 'i1',
      target: 'i2',
      frame: { type: 'hello', v: 1, token: 'tok', deviceId: 'dev', appVersion: '1.0.0' },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('jsonRpcMessageSchema', () => {
  test('accepts an MCP tools/call result carrying members beyond the known ones', () => {
    const parsed = jsonRpcMessageSchema.safeParse({
      jsonrpc: '2.0',
      id: 'call-1',
      result: { content: [{ type: 'text', text: 'hi' }], structuredContent: { ok: true } },
      extra: 'kept',
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts an id-less notification', () => {
    expect(
      jsonRpcMessageSchema.safeParse({ jsonrpc: '2.0', method: 'notifications/initialized' })
        .success,
    ).toBe(true)
  })
})
