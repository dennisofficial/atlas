import { describe, expect, it } from 'bun:test'

import { inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { FencedError } from '../../calls/errors'
import { RemoteCalls } from '../../calls/remote-calls'
import type { DaemonConnector } from '../../calls/socket'
import { flushUntil, makeRig, SANDBOX, SECRET, seedSession, SESSION } from './holder-rig'

describe('SessionHolder drop releases the slot', () => {
  it('a partitioned session dropped mid-tool frees the slot for another wake at maxSessions=1', async () => {
    const a = await makeRig({
      holderId: 'holder-a',
      maxSessions: 1,
      script: [
        {
          calls: [
            {
              callId: 'call-1',
              name: 'bash',
              input: { command: 'echo started; sleep 600; echo late' },
            },
          ],
        },
        { text: 'after' },
      ],
    })
    await seedSession(a)
    await a.plane.createSession({
      sessionId: 'session-other',
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: 'thread-other',
    })
    await a.holder.start()
    await a.post('long exec')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    a.plane.renew = () => new Promise(() => {})
    a.clock.advance(31_000)
    const dropped = await flushUntil({ check: () => !a.holder.heldIds().includes(SESSION) })
    expect(dropped).toBe(true)

    await a.bus.wake('session-other')
    const claimed = await flushUntil({ check: () => a.holder.heldIds().includes('session-other') })
    expect(claimed).toBe(true)
  }, 15_000)
})

describe('RemoteCalls.close', () => {
  it('close rejects a pending invoke and a pending ready waiter', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    const hanging = new RemoteCalls({
      sessionId: SESSION,
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () => new Promise(() => {}),
      timers: a.clock,
      onFenced: () => {},
    })
    hanging.open({ epoch: 1 })
    const readyWaiter = hanging.ready()
    hanging.close()
    let readyError: unknown
    let invokeError: unknown
    await readyWaiter.catch((error: unknown) => {
      readyError = error
    })
    await hanging
      .invoke({ key: 'k1', op: { op: 'exec', argv: ['/bin/true'] } })
      .catch((error: unknown) => {
        invokeError = error
      })
    expect(readyError).toBeInstanceOf(FencedError)
    expect(invokeError).toBeInstanceOf(FencedError)
  })

  it('close rejects an invoke in flight against a live daemon', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    await seedSession(a)
    const calls = new RemoteCalls({
      sessionId: SESSION,
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () =>
        Promise.resolve<DaemonConnector>((handlers: Parameters<DaemonConnector>[0]) =>
          Promise.resolve(a.daemon.connectRaw(handlers)),
        ),
      timers: a.clock,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()
    const inFlight = calls.invoke({
      key: 'k2',
      op: { op: 'exec', argv: ['/bin/sh', '-c', 'sleep 600'] },
    })
    await flushUntil({ check: () => a.daemon.runCount() === 1 })
    calls.close()
    await expect(inFlight).rejects.toBeInstanceOf(FencedError)
  })
})
