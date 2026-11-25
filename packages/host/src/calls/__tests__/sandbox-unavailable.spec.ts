import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import {
  RemoteCalls,
  SANDBOX_UNREACHABLE_GUIDANCE,
  SandboxUnavailableError,
  systemTimers,
  type DaemonConnector,
} from '../..'

const SANDBOX = 'atlas-v2-unavailable-test'
const SECRET = 'unavailable-test-secret'

describe('the text a model reads when its sandbox does not answer', () => {
  it('keeps the reason, says nothing ran, and tells the agent to stop and tell the operator', () => {
    const error = new SandboxUnavailableError(
      'sandbox for s-1 is unavailable: wake failed: no answer on port 3000',
    )

    expect(error.message).toBe(
      `sandbox for s-1 is unavailable: wake failed: no answer on port 3000. Nothing ran. ${SANDBOX_UNREACHABLE_GUIDANCE}`,
    )
    expect(error.message).toContain('more tool calls this turn will not help')
    expect(error.message).toContain('end your turn')
    expect(error.message).toContain('next message tries to wake it again')
    expect(error.message).not.toContain('is offline')
    expect(error.message).not.toContain('is down')
    expect(error.name).toBe('SandboxUnavailableError')
  })
})

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
