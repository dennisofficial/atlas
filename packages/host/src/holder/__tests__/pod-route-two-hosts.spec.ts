import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { ECallStatus, type CallOp } from '@dltech/atlas-protocol'
import { createInMemoryDaemon } from '@dltech/atlas-protocol/testing'

import { createMemoryPodCallHub } from '../../testing/memory-pod-call-bus'
import {
  FakeClock,
  flushUntil,
  makeRig,
  SANDBOX,
  SECRET,
  seedSession,
  SESSION,
  type HolderRig,
} from './holder-rig'

const STAT: CallOp = { op: 'stat', path: '/w/a.ts' }

type TwoHosts = { a: HolderRig; b: HolderRig; stop(): Promise<void> }

const twoHosts = async (): Promise<TwoHosts> => {
  const store = new InMemoryControlStore({ clock: () => new Date().toISOString() })
  const plane = new ControlPlane({ store })
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
  })
  const hub = createMemoryPodCallHub()
  const a = await makeRig({
    store,
    plane,
    daemon,
    clock: new FakeClock(),
    podCallBus: hub.bus(),
    sweepMs: 1_000,
    terminalStreams: () => 1,
  })
  const b = await makeRig({
    store,
    plane,
    daemon,
    clock: new FakeClock(),
    podCallBus: hub.bus(),
    sweepMs: 0,
  })
  await seedSession(a)
  await a.holder.start()
  await b.holder.start()
  return {
    a,
    b,
    stop: async () => {
      a.holder.discard()
      b.holder.discard()
      await daemon.stop()
    },
  }
}

const runTurn = async (rig: HolderRig): Promise<boolean> => {
  await rig.post('hello')
  await rig.wake()
  return flushUntil({
    check: async () =>
      (await rig.events()).filter((event) => event.type === 'assistant-said').length === 1,
    clock: rig.clock,
    advanceMs: 2_000,
    attempts: 200,
  })
}

const pump = (rig: HolderRig): Promise<void> =>
  flushUntil({ check: () => false, clock: rig.clock, advanceMs: 1_000, attempts: 300 }).then(
    () => undefined,
  )

describe('a pod call that reaches the wrong host', () => {
  it('answers from the pod of the host that holds the session', async () => {
    const hosts = await twoHosts()
    expect(await runTurn(hosts.a)).toBe(true)
    expect(hosts.a.holder.heldIds()).toContain(SESSION)
    expect(hosts.a.runtimes).toHaveLength(1)

    const outcome = await hosts.b.holder.podRouter().invoke({
      sessionId: SESSION,
      op: STAT,
      waitForHolder: true,
    })
    const local = await hosts.a.holder.podCalls().invoke({ sessionId: SESSION, op: STAT })

    expect(local.state).toBe('ok')
    expect(outcome).toEqual(local)
    expect(hosts.b.runtimes).toEqual([])
    await hosts.stop()
  }, 20_000)

  it('streams terminal output of the holder to the other host', async () => {
    const hosts = await twoHosts()
    expect(await runTurn(hosts.a)).toBe(true)
    const runtime = hosts.a.runtimes[0]
    if (runtime === undefined) throw new Error('the holder has no runtime')
    const closed: string[] = []
    const frames: string[] = []

    const dispose = await hosts.b.holder.podRouter().follow({
      sessionId: SESSION,
      listener: (frame) => frames.push(frame.event.type),
      onClose: (reason) => closed.push(reason),
    })
    expect(dispose).not.toBeNull()

    const opened = await runtime.remoteCalls.invoke({
      key: 'term-open',
      op: { op: 'terminal.open', terminalId: 't1', cols: 80, rows: 24, cwd: '/w' },
    })
    expect(opened.status).toBe(ECallStatus.Ok)
    await runtime.remoteCalls.invoke({
      key: 'term-write',
      op: { op: 'terminal.write', terminalId: 't1', data: 'hello\n' },
    })

    const delivered = await flushUntil({
      check: () => frames.includes('terminal.output'),
      clock: hosts.b.clock,
      attempts: 100,
    })
    expect(delivered).toBe(true)
    expect(hosts.b.runtimes).toEqual([])

    await hosts.a.holder.drain()
    const stopped = await flushUntil({
      check: () => closed.length > 0,
      clock: hosts.b.clock,
      attempts: 100,
    })
    expect(stopped).toBe(true)
    expect(closed).toEqual(['restarted'])
    await hosts.stop()
  }, 20_000)
})

describe('a pod call for a session nobody holds', () => {
  it('wakes the session and answers once its runtime opens', async () => {
    const hosts = await twoHosts()
    const pending = hosts.b.holder.podRouter().invoke({
      sessionId: SESSION,
      op: STAT,
      waitForHolder: true,
    })

    const outcome = await Promise.race([pending, pump(hosts.a)])

    expect(outcome).toBeDefined()
    expect(outcome?.state).toBe('ok')
    expect(hosts.a.holder.heldIds()).toContain(SESSION)
    expect(hosts.b.runtimes).toEqual([])
    await hosts.stop()
  }, 20_000)
})
