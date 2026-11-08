import { describe, expect, it } from 'bun:test'

import { ECallFailure, ECallStatus } from '@dltech/atlas-protocol'

import { ReadyTimeoutError, RemoteCalls, systemTimers, type DaemonConnector } from '../..'

const silentDaemon = (): Promise<DaemonConnector> => new Promise<DaemonConnector>(() => {})

const openSilent = (readyTimeoutMs = 30): RemoteCalls => {
  const calls = new RemoteCalls({
    sessionId: 's-ready-deadline',
    token: 'token',
    connector: silentDaemon,
    timers: systemTimers,
    onFenced: () => {},
    readyTimeoutMs,
  })
  calls.open({ epoch: 1 })
  return calls
}

describe('the daemon ready wait', () => {
  it('rejects an invoke with ReadyTimeoutError when the daemon never answers', async () => {
    const calls = openSilent()
    const started = Date.now()
    await expect(
      calls.invoke({ key: 'k-1', op: { op: 'stat', path: '/' } }),
    ).rejects.toBeInstanceOf(ReadyTimeoutError)
    expect(Date.now() - started).toBeLessThan(1000)
    calls.close()
  })

  it('names the bound in the message', async () => {
    const calls = openSilent()
    await expect(calls.invoke({ key: 'k-2', op: { op: 'stat', path: '/' } })).rejects.toThrow(
      'the sandbox did not answer within 1s',
    )
    calls.close()
  })

  it('resolves an ack false instead of hanging', async () => {
    const calls = openSilent()
    await expect(calls.ack({ key: 'k-3' })).resolves.toBeUndefined()
    await expect(calls.ackScope({ scopeKey: 'scope' })).resolves.toBeUndefined()
    calls.close()
  })

  it('does not leave a timed-out call behind to be sent later', async () => {
    const calls = openSilent()
    await expect(
      calls.invoke({ key: 'k-4', op: { op: 'stat', path: '/' } }),
    ).rejects.toBeInstanceOf(ReadyTimeoutError)
    await expect(
      calls.invoke({ key: 'k-4', op: { op: 'stat', path: '/' } }),
    ).rejects.toBeInstanceOf(ReadyTimeoutError)
    calls.close()
  })
})

describe('Stop on a call that was never sent', () => {
  it('settles the call as interrupted while the daemon is still not ready', async () => {
    const calls = openSilent(5_000)
    const controller = new AbortController()
    const started = Date.now()
    const outcome = calls.invoke({
      key: 'k-5',
      op: { op: 'stat', path: '/' },
      signal: controller.signal,
    })
    controller.abort()
    const result = await outcome
    expect(result.status).toBe(ECallStatus.Failed)
    if (result.status === ECallStatus.Failed) {
      expect(result.error.code).toBe(ECallFailure.Interrupted)
    }
    expect(Date.now() - started).toBeLessThan(1000)
    calls.close()
  })

  it('settles a call whose signal was already aborted', async () => {
    const calls = openSilent(5_000)
    const result = await calls.invoke({
      key: 'k-6',
      op: { op: 'stat', path: '/' },
      signal: AbortSignal.abort(),
    })
    expect(result.status).toBe(ECallStatus.Failed)
    calls.close()
  })
})
