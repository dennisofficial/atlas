import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { FencedError, RemoteCalls, systemTimers, type DaemonConnector } from '../..'

const SANDBOX = 'atlas-v2-lease-fence-test'
const SECRET = 'lease-fence-test-secret'

const waitForFence = async (count: () => number): Promise<void> => {
  for (let waited = 0; count() === 0 && waited < 5_000; waited += 25) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('the lease fence of a superseded holder', () => {
  it('refuses calls at the epoch that lost the lease and accepts them again at a higher epoch', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const token = inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX })
    const connector = (): Promise<DaemonConnector> =>
      Promise.resolve((handlers) => Promise.resolve(daemon.connectRaw(handlers)))
    let fenced = 0
    const calls = new RemoteCalls({
      sessionId: 's-lease-fence',
      token,
      connector,
      timers: systemTimers,
      onFenced: () => {
        fenced += 1
      },
    })
    const rival = new RemoteCalls({
      sessionId: 's-lease-fence',
      token,
      connector,
      timers: systemTimers,
      onFenced: () => {},
    })
    try {
      calls.open({ epoch: 4 })
      await calls.ready()
      rival.open({ epoch: 5 })
      await rival.ready()
      await waitForFence(() => fenced)
      expect(fenced).toBe(1)

      await expect(
        calls.invoke({ key: 'at-4', op: { op: 'stat', path: '/' } }),
      ).rejects.toBeInstanceOf(FencedError)

      calls.open({ epoch: 4 })
      await expect(
        calls.invoke({ key: 'still-4', op: { op: 'stat', path: '/' } }),
      ).rejects.toBeInstanceOf(FencedError)

      calls.open({ epoch: 6 })
      const taken = await calls.invoke({ key: 'at-6', op: { op: 'stat', path: '/' } })
      expect(taken.status).toBe(ECallStatus.Ok)
      await expect(
        rival.invoke({ key: 'rival-at-5', op: { op: 'stat', path: '/' } }),
      ).rejects.toBeInstanceOf(FencedError)
    } finally {
      calls.close()
      rival.close()
      await daemon.stop()
    }
  }, 15000)
})
