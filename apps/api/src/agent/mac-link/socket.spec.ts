import 'reflect-metadata'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { AddressInfo } from 'node:net'
import {
  macHostFrameSchema,
  type MacClientFrame,
  type MacHostFrame,
} from '@dltech/atlas-protocol/mac-link'
import { WebSocket } from 'ws'

import type { SessionVerifier } from '../../_core/ports/session-verifier'
import { MacLinkRegistry } from './registry'
import type { MacLinkRelay } from './relay'
import { attachMacLinkSocket, type MacLinkSocket } from './socket'

@Module({})
class SocketTestModule {}

const verifier: SessionVerifier = {
  verify: async ({ headers }) =>
    headers.authorization === 'Bearer good'
      ? { userId: 'u1', sessionId: 's1', email: 'd@example.com' }
      : null,
}

const fakeRelay = (): MacLinkRelay => ({
  presence: async () => undefined,
  claim: async () => undefined,
  release: async () => undefined,
  publish: async () => undefined,
  listen: async () => async () => undefined,
  close: async () => undefined,
})

const fakeTimers = () => {
  const intervals = new Map<number, () => void>()
  const timeouts = new Map<number, () => void>()
  let next = 1
  return {
    timers: {
      setInterval: ((fn: () => void) => {
        const id = next++
        intervals.set(id, fn)
        return id
      }) as unknown as typeof setInterval,
      clearInterval: ((id: number) => {
        intervals.delete(id)
      }) as unknown as typeof clearInterval,
      setTimeout: ((fn: () => void) => {
        const id = next++
        timeouts.set(id, fn)
        return id
      }) as unknown as typeof setTimeout,
      clearTimeout: ((id: number) => {
        timeouts.delete(id)
      }) as unknown as typeof clearTimeout,
    },
    tick: (): void => {
      for (const fn of [...intervals.values()]) fn()
    },
    fireTimeouts: (): void => {
      for (const fn of [...timeouts.values()]) fn()
      timeouts.clear()
    },
  }
}

type Client = {
  frames: MacHostFrame[]
  errors: string[]
  closed: { code: number; reason: string }[]
  ready: Promise<void>
  send: (frame: MacClientFrame) => void
  waitFor: (type: MacHostFrame['type']) => Promise<MacHostFrame>
  waitForSettled: () => Promise<void>
}

describe('the mac-link socket', () => {
  let app: NestExpressApplication
  let socket: MacLinkSocket
  let base = ''
  let clock = 0
  const fake = fakeTimers()
  const registry = new MacLinkRegistry({
    relay: fakeRelay(),
    instanceId: 'i1',
    timers: { setTimeout, clearTimeout },
  })

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(SocketTestModule, { logger: false })
    await app.listen(0)
    const address = (app.getHttpServer() as { address(): AddressInfo }).address()
    base = `ws://127.0.0.1:${address.port}`
    socket = attachMacLinkSocket({
      server: app.getHttpServer() as Parameters<typeof attachMacLinkSocket>[0]['server'],
      verify: verifier,
      registry,
      timers: fake.timers,
      now: () => clock,
    })
  })

  afterAll(async () => {
    await socket.close()
    await app.close()
  })

  const clientOf = (args: { path?: string; authorization?: string } = {}): Client => {
    const ws = new WebSocket(`${base}${args.path ?? '/mac-link'}`, {
      headers: args.authorization === undefined ? {} : { authorization: args.authorization },
    })
    const frames: MacHostFrame[] = []
    const errors: string[] = []
    const closed: { code: number; reason: string }[] = []
    ws.on('message', (raw) => {
      const parsed = macHostFrameSchema.safeParse(JSON.parse(raw.toString()))
      if (parsed.success) frames.push(parsed.data)
    })
    const ready = new Promise<void>((resolve) => {
      ws.on('open', () => resolve())
      ws.on('error', () => resolve())
    })
    ws.on('error', (error: Error) => errors.push(error.message))
    ws.on('close', (code, reason) => closed.push({ code, reason: reason.toString() }))
    const settle = async (done: () => boolean): Promise<void> => {
      const deadline = Date.now() + 3000
      while (!done()) {
        if (Date.now() > deadline)
          throw new Error(`timed out: ${JSON.stringify({ frames, errors, closed })}`)
        await Bun.sleep(5)
      }
    }
    return {
      frames,
      errors,
      closed,
      ready,
      send: (frame) => ws.send(JSON.stringify(frame)),
      waitFor: async (type) => {
        await settle(() => frames.some((frame) => frame.type === type) || closed.length > 0)
        const found = frames.find((frame) => frame.type === type)
        if (found === undefined) throw new Error(`closed before ${type}: ${JSON.stringify(closed)}`)
        return found
      },
      waitForSettled: async () => {
        await settle(() => closed.length > 0 || errors.length > 0)
      },
    }
  }

  const helloOf = (token: string): MacClientFrame => ({
    type: 'hello',
    v: 1,
    token,
    deviceId: 'dev-1',
    appVersion: '1.2.3',
  })

  test('refuses an upgrade without a bearer', async () => {
    const client = clientOf()
    await client.waitForSettled()
    expect(client.errors.join(' ')).toContain('401')
  })

  test('refuses a bearer the session verifier does not know', async () => {
    const client = clientOf({ authorization: 'Bearer nope' })
    await client.waitForSettled()
    expect(client.errors.join(' ')).toContain('401')
  })

  test('answers ready once the Mac says hello with its own bearer', async () => {
    const client = clientOf({ authorization: 'Bearer good' })
    await client.ready
    client.send(helloOf('good'))
    const ready = await client.waitFor('ready')
    expect(ready).toEqual({ type: 'ready', deviceId: 'dev-1' })
  })

  test('closes a socket whose hello carries a different token', async () => {
    const client = clientOf({ authorization: 'Bearer good' })
    await client.ready
    client.send(helloOf('someone-else'))
    await client.waitForSettled()
    expect(client.closed[0]?.code).toBe(4401)
  })

  test('pings the Mac and keeps the socket while pongs arrive', async () => {
    const client = clientOf({ authorization: 'Bearer good' })
    await client.ready
    client.send(helloOf('good'))
    await client.waitFor('ready')

    fake.tick()
    await client.waitFor('ping')
    client.send({ type: 'pong' })
    await Bun.sleep(20)

    clock += 50_000
    fake.tick()
    await client.waitForSettled()
    expect(client.closed.length).toBe(1)
  })

  test('destroys an upgrade on any other path', async () => {
    const client = clientOf({ path: '/stream', authorization: 'Bearer good' })
    await client.waitForSettled()
    expect(client.frames).toEqual([])
  })
})
