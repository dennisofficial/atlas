import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, type DaemonConnector, type DaemonSocket } from '../..'
import type { DaemonLinkHandlers } from '../socket'
import { DaemonLink } from '../link'
import { fakeTimers } from '../../testing'

const SANDBOX = 'atlas-v2-health-test'
const SECRET = 'health-test-secret'

describe('link health on a fake clock', () => {
  it('declares a black-holed link dead after three missed pings and reconnects within backoff bounds', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const timers = fakeTimers()
    let blackHole = false
    const connector = (): Promise<DaemonConnector> =>
      Promise.resolve((handlers) => {
        const inner = daemon.connectRaw({
          onText: (text) => {
            if (!blackHole) handlers.onText(text)
          },
          onClose: (code, reason) => handlers.onClose(code, reason),
        })
        const socket: DaemonSocket = {
          send: (text) => {
            if (!blackHole) inner.send(text)
          },
          close: () => {
            const hole = blackHole
            blackHole = false
            inner.close()
            if (hole) handlers.onClose(1006, 'black hole')
          },
        }
        return Promise.resolve(socket)
      })
    const waits: number[] = []
    let connecting = 0
    const measured = new RemoteCalls({
      sessionId: 's-health-2',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () => {
        connecting += 1
        return connector()
      },
      timers: {
        ...timers,
        setTimeout: (handler: () => void, ms: number) => {
          if (ms !== 10_000) waits.push(ms)
          return timers.setTimeout(handler, ms)
        },
      },
      onFenced: () => {},
    })
    measured.open({ epoch: 1 })
    await measured.ready()
    blackHole = true
    timers.advance(10_000)
    timers.advance(10_000)
    timers.advance(10_000)
    expect(connecting).toBe(1)
    timers.advance(250)
    expect(connecting).toBe(2)
    for (const wait of waits) {
      expect(wait).toBeGreaterThanOrEqual(0)
      expect(wait).toBeLessThanOrEqual(10_000)
    }
    blackHole = false
    const result = await measured.invoke({ key: 'health-1', op: { op: 'stat', path: '/' } })
    expect(result.status).toBe(ECallStatus.Ok)
    measured.close()
    await daemon.stop()
  })

  it('starts its reconnect backoff from the minimum again after a successful hello', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const timers = fakeTimers()
    let refuse = false
    const sockets: DaemonSocket[] = []
    const connector = (): Promise<DaemonConnector> => {
      if (refuse) return Promise.reject(new Error('refused'))
      return Promise.resolve((handlers) => {
        const socket = daemon.connectRaw(handlers)
        sockets.push(socket)
        return Promise.resolve(socket)
      })
    }
    const waits: number[] = []
    const calls = new RemoteCalls({
      sessionId: 's-health-3',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector,
      timers: {
        ...timers,
        setTimeout: (handler: () => void, ms: number) => {
          if (ms !== 10_000) waits.push(ms)
          return timers.setTimeout(handler, ms)
        },
      },
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()

    refuse = true
    sockets.at(-1)?.close()
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve()
      timers.advance(10_000)
    }
    refuse = false
    await Promise.resolve()
    timers.advance(10_000)
    const result = await calls.invoke({ key: 'health-3', op: { op: 'stat', path: '/' } })
    expect(result.status).toBe(ECallStatus.Ok)

    waits.length = 0
    sockets.at(-1)?.close()
    await Promise.resolve()
    expect(waits[0]).toBe(125)
    calls.close()
    await daemon.stop()
  })

  it('keeps the link alive while output frames arrive, even with no pongs for 40 s', async () => {
    const timers = fakeTimers()
    let handlers: DaemonLinkHandlers | null = null
    let closed = false
    let fatal: Error | null = null
    const socket: DaemonSocket = {
      send: () => {},
      close: () => {
        closed = true
      },
    }
    const link = new DaemonLink({
      timers,
      events: {
        onFrame: () => {},
        onSuperseded: () => {},
        onUnauthenticated: () => {},
        onFatal: (error) => {
          fatal = error
        },
      },
    })
    link.start({
      connector: () =>
        Promise.resolve((given: DaemonLinkHandlers) => {
          handlers = given
          return Promise.resolve(socket)
        }),
      hello: () => ({ kind: 'hello', sessionId: 's-health-4', epoch: 1, token: 'tok' }),
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(handlers).not.toBeNull()
    link.markReady()
    link.schedulePing()
    const outputFrame = JSON.stringify({ kind: 'output', key: 'k', offset: 0, bytes: 'AA==' })
    for (let elapsed = 0; elapsed < 40_000; elapsed += 10_000) {
      timers.advance(9_000)
      ;(handlers as DaemonLinkHandlers | null)?.onText(outputFrame)
      timers.advance(1_000)
    }
    expect(fatal).toBeNull()
    expect(closed).toBe(false)
    link.teardown()
  })
})
