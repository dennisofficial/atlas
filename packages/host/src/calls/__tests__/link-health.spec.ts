import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, type DaemonConnector, type DaemonSocket } from '../..'
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
})
