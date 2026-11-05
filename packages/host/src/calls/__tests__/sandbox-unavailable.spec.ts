import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, SandboxUnavailableError, systemTimers, type DaemonConnector } from '../..'

const SANDBOX = 'atlas-v2-unavailable-test'
const SECRET = 'unavailable-test-secret'

describe('a daemon link that gave up on an unavailable sandbox', () => {
  it('fails the waiting calls, then reconnects on the next call instead of staying dead', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    let reachable = false
    let connects = 0
    const unavailable = new SandboxUnavailableError('sandbox did not answer after 3 wakes')
    const calls = new RemoteCalls({
      sessionId: 's-unavailable',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: (): Promise<DaemonConnector> => {
        connects += 1
        if (!reachable) return Promise.reject(unavailable)
        return Promise.resolve((handlers) => Promise.resolve(daemon.connectRaw(handlers)))
      },
      timers: systemTimers,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })

    await expect(calls.ready()).rejects.toBe(unavailable)
    await expect(calls.invoke({ key: 'down-1', op: { op: 'stat', path: '/' } })).rejects.toBe(
      unavailable,
    )
    expect(connects).toBe(2)

    reachable = true
    const result = await calls.invoke({ key: 'up-1', op: { op: 'stat', path: '/' } })
    expect(result.status).toBe(ECallStatus.Ok)
    expect(connects).toBe(3)

    calls.close()
    await daemon.stop()
  })
})
