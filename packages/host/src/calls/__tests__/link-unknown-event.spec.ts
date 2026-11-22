import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, type DaemonConnector } from '../..'
import { fakeTimers } from '../../testing'

const SANDBOX = 'atlas-v2-unknown-event-test'
const SECRET = 'unknown-event-secret'

describe('an event the host does not know', () => {
  it('is dropped and leaves the link and its calls working', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const inject: { text?: (text: string) => void } = {}
    const connector = (): Promise<DaemonConnector> =>
      Promise.resolve((handlers) => {
        inject.text = handlers.onText
        return Promise.resolve(daemon.connectRaw(handlers))
      })
    const calls = new RemoteCalls({
      sessionId: 's-unknown-event',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector,
      timers: fakeTimers(),
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()
    inject.text?.(JSON.stringify({ kind: 'event', event: { type: 'from-a-newer-daemon', at: 1 } }))
    const result = await calls.invoke({ key: 'after-unknown', op: { op: 'stat', path: '/' } })
    expect(result.status).toBe(ECallStatus.Ok)
    calls.close()
    await daemon.stop()
  })
})
