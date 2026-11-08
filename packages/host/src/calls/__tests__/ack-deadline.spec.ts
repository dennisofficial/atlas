import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, type DaemonConnector } from '../..'
import { ACK_TIMEOUT_MS } from '../remote-calls-state'
import { fakeTimers } from '../../testing'

const SANDBOX = 'atlas-v2-ack-deadline'
const SECRET = 'ack-deadline-secret'

const tokenOf = (): string => inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX })

const settledWithin = async <T>(args: { promise: Promise<T>; ms: number }): Promise<T | 'hung'> =>
  Promise.race([
    args.promise,
    new Promise<'hung'>((resolve) => {
      setTimeout(() => resolve('hung'), args.ms)
    }),
  ])

describe('scope acks', () => {
  it('stops acking a scope whose acks the daemon never answers instead of waiting forever', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const timers = fakeTimers()
    const connector = (): Promise<DaemonConnector> =>
      Promise.resolve((handlers) => {
        const inner = daemon.connectRaw({
          onText: (text) => handlers.onText(text),
          onClose: (code, reason) => handlers.onClose(code, reason),
        })
        return Promise.resolve({
          send: (text) => {
            const frame: { kind?: string } = JSON.parse(text)
            if (frame.kind === 'ack') return
            inner.send(text)
          },
          close: () => inner.close(),
        })
      })
    const calls = new RemoteCalls({
      sessionId: 's-ack-silent',
      token: tokenOf(),
      connector,
      timers,
      pingMs: 600_000,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()
    const call = await calls.invoke({ key: 'scope.0', op: { op: 'stat', path: '/' } })
    expect(call.status).toBe(ECallStatus.Ok)

    const acked = calls.ackScope({ scopeKey: 'scope' })
    await Bun.sleep(5)
    timers.advance(ACK_TIMEOUT_MS)

    expect(await settledWithin({ promise: acked, ms: 2000 })).toBeUndefined()
    calls.close()
  })

  it('returns from an ack the daemon refuses because the call is still running', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const calls = new RemoteCalls({
      sessionId: 's-ack-refused',
      token: tokenOf(),
      connector: () =>
        Promise.resolve((handlers) => {
          const inner = daemon.connectRaw({
            onText: (text) => handlers.onText(text),
            onClose: (code, reason) => handlers.onClose(code, reason),
          })
          return Promise.resolve({
            send: (text) => inner.send(text),
            close: () => inner.close(),
          })
        }),
      timers: {
        setTimeout: (handler, ms) => setTimeout(handler, ms),
        clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        random: () => 0.5,
      },
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()
    const running = calls.invoke({
      key: 'live.0',
      op: { op: 'exec', argv: ['/bin/sh', '-c', 'sleep 5'], cwd: '/' },
    })
    running.catch(() => undefined)
    await Bun.sleep(50)

    const acked = await settledWithin({ promise: calls.ack({ key: 'live.0' }), ms: 2000 })

    expect(acked).toBeUndefined()
    calls.close()
    await running.catch(() => undefined)
  })
})
