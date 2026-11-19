import { describe, expect, test } from 'bun:test'
import type { MacHostFrame, MacRelayFrame, JsonRpcMessage } from '@dltech/atlas-protocol/mac-link'

import { MacOfflineError } from './port'
import { MacLinkRegistry, type MacSocket } from './registry'
import type { MacLinkRelay, MacPresence } from './relay'

const INSTANCE = 'i1'

const fakeRelay = () => {
  const presence = new Map<string, MacPresence>()
  const listeners = new Map<string, Set<(frame: MacRelayFrame) => void>>()
  const published: { userId: string; frame: MacRelayFrame }[] = []
  const relay: MacLinkRelay = {
    presence: async (userId) => presence.get(userId),
    claim: async (userId, value) => {
      presence.set(userId, value)
    },
    release: async (userId, instanceId) => {
      if (presence.get(userId)?.instanceId === instanceId) presence.delete(userId)
    },
    publish: async (userId, frame) => {
      published.push({ userId, frame })
    },
    listen: async (userId, listener) => {
      const current = listeners.get(userId) ?? new Set()
      current.add(listener)
      listeners.set(userId, current)
      return async () => {
        listeners.get(userId)?.delete(listener)
      }
    },
    close: async () => undefined,
  }
  return {
    relay,
    presence,
    published,
    deliver: (userId: string, frame: MacRelayFrame): void => {
      for (const listener of [...(listeners.get(userId) ?? [])]) listener(frame)
    },
  }
}

const fakeSocket = () => {
  const sent: MacHostFrame[] = []
  const closes: { code: number; reason: string }[] = []
  const socket: MacSocket = {
    send: (frame) => sent.push(frame),
    close: (code, reason) => closes.push({ code, reason }),
  }
  return { socket, sent, closes }
}

const staleTimers = {
  setTimeout: (() => 0) as unknown as typeof setTimeout,
  clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
}

const registryOf = (
  relay: MacLinkRelay,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = staleTimers,
  now: () => number = () => 0,
) => new MacLinkRegistry({ relay, instanceId: INSTANCE, timers, now })

const openArgsOf = (waitMs = 0) => ({
  userId: 'u1',
  server: { name: 'paper', transport: { kind: 'stdio' as const, command: 'paper' } },
  waitMs,
})

describe('MacLinkRegistry', () => {
  test('attach claims presence, listens and answers ready', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket, sent } = fakeSocket()

    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })

    expect(fake.presence.get('u1')).toEqual({ instanceId: INSTANCE, deviceId: 'mac-1' })
    expect(sent).toEqual([{ type: 'ready', deviceId: 'mac-1' }])
    expect(await registry.online('u1')).toBe(true)
  })

  test('opens a channel when the Mac answers opened', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket, sent } = fakeSocket()
    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })

    const opening = registry.open(openArgsOf())
    await Bun.sleep(0)
    const open = sent.find((frame) => frame.type === 'open')
    expect(open?.type).toBe('open')
    const channelId = open?.type === 'open' ? open.channelId : ''

    await registry.handleSocketFrame('u1', { type: 'opened', channelId })
    const channel = await opening
    expect(channel).toBeDefined()
  })

  test('routes rpc in both directions on an open channel', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket, sent } = fakeSocket()
    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })

    const opening = registry.open(openArgsOf())
    await Bun.sleep(0)
    const open = sent.at(-1)
    const channelId = open?.type === 'open' ? open.channelId : ''
    await registry.handleSocketFrame('u1', { type: 'opened', channelId })
    const channel = await opening

    const received: JsonRpcMessage[] = []
    channel.onMessage((message) => received.push(message))
    await registry.handleSocketFrame('u1', {
      type: 'rpc',
      channelId,
      message: { jsonrpc: '2.0', id: 1, result: { tools: [] } },
    })
    expect(received).toEqual([{ jsonrpc: '2.0', id: 1, result: { tools: [] } }])

    channel.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await Bun.sleep(0)
    expect(sent.at(-1)).toEqual({
      type: 'rpc',
      channelId,
      message: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    })
  })

  test('fires onClosed when the Mac closes the channel', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket, sent } = fakeSocket()
    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })

    const opening = registry.open(openArgsOf())
    await Bun.sleep(0)
    const open = sent.at(-1)
    const channelId = open?.type === 'open' ? open.channelId : ''
    await registry.handleSocketFrame('u1', { type: 'opened', channelId })
    const channel = await opening

    const reasons: string[] = []
    channel.onClosed((reason) => reasons.push(reason))
    await registry.handleSocketFrame('u1', { type: 'closed', channelId, reason: 'spawn failed' })

    expect(reasons).toEqual(['spawn failed'])
  })

  test('rejects the open when the Mac answers open-failed', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket, sent } = fakeSocket()
    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })

    const opening = registry.open(openArgsOf())
    await Bun.sleep(0)
    const open = sent.at(-1)
    const channelId = open?.type === 'open' ? open.channelId : ''
    await registry.handleSocketFrame('u1', {
      type: 'open-failed',
      channelId,
      reason: 'no such binary',
    })

    expect(opening).rejects.toThrow('no such binary')
  })

  test('a second attach closes the first socket with 4409', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const first = fakeSocket()
    const second = fakeSocket()

    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket: first.socket })
    await registry.attach({ userId: 'u1', deviceId: 'mac-2', socket: second.socket })

    expect(first.closes).toEqual([{ code: 4409, reason: 'replaced' }])
    expect(second.sent).toEqual([{ type: 'ready', deviceId: 'mac-2' }])
    expect(fake.presence.get('u1')).toEqual({ instanceId: INSTANCE, deviceId: 'mac-2' })
  })

  test('detach closes every open channel of that user', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket, sent } = fakeSocket()
    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })

    const opening = registry.open(openArgsOf())
    await Bun.sleep(0)
    const open = sent.at(-1)
    const channelId = open?.type === 'open' ? open.channelId : ''
    await registry.handleSocketFrame('u1', { type: 'opened', channelId })
    const channel = await opening
    const reasons: string[] = []
    channel.onClosed((reason) => reasons.push(reason))

    await registry.detach('u1', socket)

    expect(reasons).toEqual(['mac-disconnected'])
    expect(await registry.online('u1')).toBe(false)
  })

  test('detach ignores a socket that is no longer the holder', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket } = fakeSocket()
    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })

    await registry.detach('u1', fakeSocket().socket)

    expect(await registry.online('u1')).toBe(true)
  })

  test('open rejects MacOfflineError once waitMs elapses without presence', async () => {
    const fake = fakeRelay()
    let time = 0
    const timers = {
      setTimeout: ((fn: () => void, ms: number) => {
        time += ms
        fn()
        return 0
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    }
    const registry = registryOf(fake.relay, timers, () => time)

    const failure = await registry.open(openArgsOf(1000)).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MacOfflineError)
    expect((failure as MacOfflineError).waitedMs).toBe(1000)
  })

  test('an offline open with no wait rejects at once', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)

    expect(registry.open(openArgsOf(0))).rejects.toBeInstanceOf(MacOfflineError)
  })

  test('publishes to the owning instance when the socket lives elsewhere', async () => {
    const fake = fakeRelay()
    fake.presence.set('u1', { instanceId: 'i2', deviceId: 'mac-9' })
    const registry = registryOf(fake.relay)

    const opening = registry.open(openArgsOf())
    await Bun.sleep(0)

    expect(fake.published[0]?.userId).toBe('u1')
    expect(fake.published[0]?.frame.target).toBe('i2')
    expect(fake.published[0]?.frame.frame.type).toBe('open')
    const channelId =
      fake.published[0]?.frame.frame.type === 'open' ? fake.published[0].frame.frame.channelId : ''

    fake.deliver('u1', {
      origin: 'i2',
      target: INSTANCE,
      frame: { type: 'opened', channelId },
    })
    expect(await opening).toBeDefined()
  })

  test('ignores a relayed frame addressed to another instance', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket, sent } = fakeSocket()
    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })
    sent.length = 0

    fake.deliver('u1', {
      origin: 'i3',
      target: 'i9',
      frame: {
        type: 'open',
        channelId: 'c1',
        server: { name: 'x', transport: { kind: 'stdio', command: 'x' } },
      },
    })

    expect(sent).toEqual([])
  })

  test('relays a Mac reply up to the instance that owns the channel', async () => {
    const fake = fakeRelay()
    const registry = registryOf(fake.relay)
    const { socket } = fakeSocket()
    await registry.attach({ userId: 'u1', deviceId: 'mac-1', socket })

    fake.deliver('u1', {
      origin: 'i2',
      target: INSTANCE,
      frame: {
        type: 'open',
        channelId: 'c9',
        server: { name: 'x', transport: { kind: 'stdio', command: 'x' } },
      },
    })
    await registry.handleSocketFrame('u1', { type: 'opened', channelId: 'c9' })

    expect(fake.published.at(-1)).toEqual({
      userId: 'u1',
      frame: { origin: INSTANCE, target: 'i2', frame: { type: 'opened', channelId: 'c9' } },
    })
  })
})
