import { afterAll, describe, expect, test } from 'bun:test'

import type { MacClientFrame } from '@dltech/atlas-protocol/mac-link'

import { openHttpChannel } from '../http-channel'

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error('timed out waiting for a frame')
}

const recorder = () => {
  const frames: MacClientFrame[] = []
  const logs: string[] = []
  return {
    frames,
    logs,
    args: {
      channelId: 'c1',
      emit: (frame: MacClientFrame) => {
        frames.push(frame)
      },
      now: () => Date.now(),
      log: (line: string) => {
        logs.push(line)
      },
    },
  }
}

const posts: { session: string | null; method: string | undefined }[] = []
const deletes: (string | null)[] = []
let failNext = false

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.method === 'DELETE') {
      deletes.push(request.headers.get('mcp-session-id'))
      return new Response(null, { status: 204 })
    }
    const body = (await request.json()) as { id?: unknown; method?: string }
    posts.push({ session: request.headers.get('mcp-session-id'), method: body.method })
    if (failNext) {
      failNext = false
      return new Response('boom', { status: 500 })
    }
    if (body.method === 'initialize')
      return Response.json(
        { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } },
        { headers: { 'mcp-session-id': 's1' } },
      )
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (body.method === 'tools/list')
      return new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      )
    return Response.json({ jsonrpc: '2.0', id: body.id, result: {} })
  },
})

afterAll(() => {
  void server.stop(true)
})

const open = async () => {
  const record = recorder()
  const channel = await openHttpChannel({
    ...record.args,
    transport: { kind: 'http', url: `http://127.0.0.1:${server.port}/mcp` },
  })
  return { channel, record }
}

describe('openHttpChannel', () => {
  test('relays a JSON body and an SSE body, reusing the session id', async () => {
    posts.length = 0
    const { channel, record } = await open()

    channel.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    await waitFor(() => record.frames.length === 1)
    channel.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await waitFor(() => record.frames.length === 2)

    expect(record.frames).toEqual([
      {
        type: 'rpc',
        channelId: 'c1',
        message: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
      },
      { type: 'rpc', channelId: 'c1', message: { jsonrpc: '2.0', id: 2, result: { tools: [] } } },
    ])
    expect(posts[1]?.session).toBe('s1')

    channel.close('done')
    await waitFor(() => deletes.length === 1)
    expect(deletes).toEqual(['s1'])
    expect(record.frames.at(-1)).toEqual({ type: 'closed', channelId: 'c1', reason: 'done' })
  })

  test('answers a failed request with a JSON-RPC error and keeps the channel open', async () => {
    posts.length = 0
    const { channel, record } = await open()

    channel.send({ jsonrpc: '2.0', id: 7, method: 'initialize', params: {} })
    await waitFor(() => record.frames.length === 1)
    failNext = true
    channel.send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: {} })
    await waitFor(() => record.frames.length === 2)

    expect(record.frames[1]).toEqual({
      type: 'rpc',
      channelId: 'c1',
      message: {
        jsonrpc: '2.0',
        id: 8,
        error: { code: -32000, message: 'answered 500' },
      },
    })
    expect(record.frames.some((frame) => frame.type === 'closed')).toBe(false)
    channel.close('done')
  })

  test('emits closed when the first post cannot reach the server', async () => {
    const record = recorder()
    const channel = await openHttpChannel({
      ...record.args,
      transport: { kind: 'http', url: 'http://127.0.0.1:1/mcp' },
    })

    channel.send({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} })
    await waitFor(() => record.frames.some((frame) => frame.type === 'closed'))

    expect(record.frames[0]?.type).toBe('rpc')
    expect(record.frames.at(-1)).toMatchObject({ type: 'closed', channelId: 'c1' })
    expect(() => channel.close('done')).not.toThrow()
  })
})
