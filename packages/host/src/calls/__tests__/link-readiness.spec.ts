import { describe, expect, it } from 'bun:test'

import { LogPort, type LogEntry } from '@dltech/atlas-observability'
import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { ReadyTimeoutError, RemoteCalls, type DaemonConnector } from '../..'
import { ACK_TIMEOUT_MS } from '../remote-calls-state'
import { fakeTimers } from '../../testing'

const SANDBOX = 'atlas-v2-link-readiness'
const SECRET = 'link-readiness-secret'
const PING_MS = 10_000
const HANDSHAKE_MS = 15_000

class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const flush = (): Promise<void> => Bun.sleep(5)

type Knobs = { blackHole: boolean; hangConnects: number; dropAcks: boolean }

const rig = async (args: { readyTimeoutMs?: number } = {}) => {
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
  })
  const timers = fakeTimers()
  const log = new CollectingLog()
  const knobs: Knobs = { blackHole: false, hangConnects: 0, dropAcks: false }
  let connects = 0
  const hungSignals: AbortSignal[] = []
  const connector = (): Promise<DaemonConnector> =>
    Promise.resolve((handlers) => {
      connects += 1
      if (knobs.hangConnects > 0) {
        knobs.hangConnects -= 1
        hungSignals.push(handlers.signal)
        return new Promise(() => {})
      }
      const inner = daemon.connectRaw({
        onText: (text) => {
          if (!knobs.blackHole) handlers.onText(text)
        },
        onClose: (code, reason) => {
          if (!knobs.blackHole) handlers.onClose(code, reason)
        },
      })
      return Promise.resolve({
        send: (text) => {
          if (knobs.blackHole) return
          if (knobs.dropAcks && (JSON.parse(text) as { kind?: string }).kind === 'ack') return
          inner.send(text)
        },
        close: () => inner.close(),
      })
    })
  const calls = new RemoteCalls({
    sessionId: 's-link-readiness',
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector,
    timers,
    pingMs: PING_MS,
    log,
    onFenced: () => {},
    ...(args.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: args.readyTimeoutMs }),
  })
  calls.open({ epoch: 1 })
  await calls.ready()
  const missPings = async (): Promise<void> => {
    for (let round = 0; round < 3; round += 1) {
      timers.advance(PING_MS)
      await flush()
    }
  }
  return { daemon, timers, log, knobs, calls, missPings, hungSignals, connects: () => connects }
}

const outcomeOf = <T>(promise: Promise<T>): { value: T | 'pending' | Error } => {
  const box: { value: T | 'pending' | Error } = { value: 'pending' }
  promise.then(
    (value) => {
      box.value = value
    },
    (error: unknown) => {
      box.value = error instanceof Error ? error : new Error(String(error))
    },
  )
  return box
}

describe('daemon link readiness', () => {
  it('abandons a reconnect whose handshake never finishes and connects again', async () => {
    const { calls, timers, knobs, missPings, connects } = await rig()
    knobs.blackHole = true
    knobs.hangConnects = 1
    await missPings()
    knobs.blackHole = false
    timers.advance(250)
    await flush()
    expect(connects()).toBe(2)

    timers.advance(HANDSHAKE_MS)
    await flush()
    timers.advance(10_000)
    await flush()

    expect(connects()).toBe(3)
    const result = await calls.invoke({ key: 'after-hang.0', op: { op: 'stat', path: '/' } })
    expect(result.status).toBe(ECallStatus.Ok)
    calls.close()
  })

  it('fails a call made while the link is down instead of letting it wait forever', async () => {
    const { calls, timers, knobs, missPings } = await rig({ readyTimeoutMs: 60_000 })
    knobs.blackHole = true
    await missPings()

    const call = outcomeOf(calls.invoke({ key: 'down.0', op: { op: 'stat', path: '/' } }))
    for (let elapsed = 0; elapsed < 60_000; elapsed += 5_000) {
      timers.advance(5_000)
      await flush()
    }

    expect(call.value).toBeInstanceOf(ReadyTimeoutError)
    calls.close()
  })

  it('runs a call made while the link is down once the daemon answers again', async () => {
    const { calls, timers, knobs, missPings } = await rig()
    knobs.blackHole = true
    await missPings()

    const call = outcomeOf(calls.invoke({ key: 'resumed.0', op: { op: 'stat', path: '/' } }))
    await flush()
    expect(call.value).toBe('pending')
    knobs.blackHole = false
    timers.advance(10_000)
    await flush()
    await flush()

    expect(call.value).toMatchObject({ status: ECallStatus.Ok })
    calls.close()
  })

  it('logs why the link went down', async () => {
    const { calls, knobs, log, missPings } = await rig()
    knobs.blackHole = true
    await missPings()

    const down = log.entries.find((entry) => entry.source === 'calls.link')
    expect(down?.message).toContain('3 pings went unanswered')
    calls.close()
  })

  it('rejects ready() once the link drops and its reconnects never finish the handshake', async () => {
    const { calls, timers, knobs, missPings } = await rig({ readyTimeoutMs: 60_000 })
    knobs.blackHole = true
    knobs.hangConnects = 100
    await missPings()

    const ready = outcomeOf(calls.ready())
    for (let elapsed = 0; elapsed < 60_000; elapsed += 5_000) {
      timers.advance(5_000)
      await flush()
    }

    expect(ready.value).toBeInstanceOf(ReadyTimeoutError)
    calls.close()
  })

  it('gives up an ack within one ack deadline while the link is down', async () => {
    const { calls, timers, knobs, log, missPings } = await rig()
    knobs.blackHole = true
    knobs.hangConnects = 100
    await missPings()

    const acked = outcomeOf(calls.ackScope({ scopeKey: 'down' }))
    await flush()
    timers.advance(ACK_TIMEOUT_MS)
    await flush()

    expect(acked.value).toBeUndefined()
    expect(log.entries.some((entry) => entry.source === 'calls.ack')).toBe(true)
    calls.close()
  })

  it('aborts a hung connect when its handshake deadline fires', async () => {
    const { calls, timers, knobs, missPings, hungSignals } = await rig()
    knobs.blackHole = true
    knobs.hangConnects = 1
    await missPings()
    timers.advance(250)
    await flush()
    expect(hungSignals).toHaveLength(1)
    expect(hungSignals[0]?.aborted).toBe(false)

    timers.advance(HANDSHAKE_MS)
    await flush()

    expect(hungSignals[0]?.aborted).toBe(true)
    calls.close()
  })
})
