import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer } from '@dltech/atlas-core'
import { ECallStatus, EExecOutcome, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { openCall, type CallLane } from '../call-open'
import type { DaemonAnswer } from '../errors'
import { handleHello } from '../hello-reply'
import type { Pending } from '../remote-calls-frames'

const EXEC: CallOp = { op: 'exec', argv: ['work'] }
const SETUP: CallOp = { op: 'exec', argv: ['bash', '-lc', 'bun install'] }
const KEY = 'run-1:call-1.0'
const SETUP_KEY = 'setup:attempt-1.0'

const journaled: CallResult = {
  status: ECallStatus.Ok,
  op: 'exec',
  value: { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 4 },
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const deferred = (): { promise: Promise<DaemonAnswer>; answer(value: DaemonAnswer): void } => {
  let answer: (value: DaemonAnswer) => void = () => {}
  const promise = new Promise<DaemonAnswer>((resolve) => {
    answer = resolve
  })
  return { promise, answer: (value) => answer(value) }
}

const laneOf = (args: {
  bootId: string
  answers: readonly (DaemonAnswer | Promise<DaemonAnswer>)[]
}) => {
  const state = { bootId: args.bootId, answers: [...args.answers], asked: [] as string[] }
  const link = { up: true }
  const pending = new Map<string, Pending>()
  const sends: string[] = []
  const cancels: string[] = []
  const settles: CallResult[] = []
  const lane: CallLane = {
    pending,
    answers: {
      ask: async (key) => {
        state.asked.push(key)
        return await (state.answers.shift() ?? 'unavailable')
      },
    },
    detached: () => false,
    gone: () => false,
    linkReady: () => link.up,
    bootId: () => state.bootId,
    ready: async () => ({ bootId: state.bootId, version: 'test' }),
    arrived: (frame) => {
      state.bootId = frame.bootId
    },
    flushAcks: () => 0,
    logged: () => {},
    helloReady: () => {},
    listed: () => [...pending.values()],
    sendCancel: (call) => {
      cancels.push(call.key)
    },
    sendRun: (call) => {
      call.sent = true
      sends.push(call.key)
    },
    resizeReason: () => undefined,
    settle: (call, result) => {
      call.done = true
      pending.delete(call.key)
      settles.push(result)
      for (const waiter of call.waiters) waiter.settle(result)
    },
    schedulePing: () => {},
  }
  return { lane, state, link, sends, cancels, settles, pending }
}

describe('an answer the daemon could not give is a wait', () => {
  it('holds a call across a pod restart, then settles it with the real result', async () => {
    const { lane, sends, settles, pending } = laneOf({
      bootId: 'boot-a',
      answers: ['unavailable', EDaemonAnswer.Done],
    })
    const started = openCall({ lane, request: { key: KEY, op: EXEC }, dispatchedBootId: 'boot-a' })
    await tick()
    expect(sends).toEqual([KEY])

    handleHello(lane, { bootId: 'boot-b', version: 'test' })
    await tick()
    expect(settles).toEqual([])
    expect(pending.get(KEY)?.waiting).toBe(true)

    handleHello(lane, { bootId: 'boot-b', version: 'test' })
    await tick()
    expect(sends).toEqual([KEY, KEY])
    expect(settles).toEqual([])

    const call = pending.get(KEY)
    if (call === undefined) throw new Error('the call was settled instead of held')
    lane.settle(call, journaled)
    expect(await started).toEqual(journaled)
  })

  it('asks before running a replay whose dispatch boot was never recorded', async () => {
    const { lane, sends, pending } = laneOf({
      bootId: 'boot-a',
      answers: ['unavailable', EDaemonAnswer.Done],
    })
    void openCall({
      lane,
      request: { key: KEY, op: EXEC },
      dispatchedBootId: undefined,
      replayed: true,
    })
    await tick()
    expect(sends).toEqual([])
    expect(pending.get(KEY)?.waiting).toBe(true)

    handleHello(lane, { bootId: 'boot-a', version: 'test' })
    await tick()
    expect(sends).toEqual([KEY])
  })

  it('never invents the dispatch boot of a replay that recorded none', async () => {
    const { lane, sends, pending } = laneOf({
      bootId: 'boot-a',
      answers: ['unavailable', EDaemonAnswer.NeverSeen],
    })
    void openCall({
      lane,
      request: { key: KEY, op: EXEC },
      dispatchedBootId: undefined,
      replayed: true,
    })
    await tick()
    expect(pending.get(KEY)?.dispatchBootId).toBeUndefined()
    expect(pending.get(KEY)?.waiting).toBe(true)

    handleHello(lane, { bootId: 'boot-a', version: 'test' })
    await tick()
    expect(sends).toEqual([])
    expect(pending.get(KEY)?.waiting).toBe(true)
  })

  it('keeps retrying a setup attachment as an attachment, never as a first run', async () => {
    const { lane, sends, settles, pending } = laneOf({
      bootId: 'boot-b',
      answers: ['unavailable', EDaemonAnswer.NeverSeen],
    })
    const started = openCall({
      lane,
      request: { key: SETUP_KEY, op: SETUP, attachOnly: true },
      dispatchedBootId: 'boot-b',
    })
    await tick()
    expect(sends).toEqual([])
    expect(pending.get(SETUP_KEY)?.waiting).toBe(true)

    handleHello(lane, { bootId: 'boot-b', version: 'test' })
    await tick()
    expect(sends).toEqual([])
    expect(settles).toHaveLength(1)
    expect((await started).status).toBe(ECallStatus.Failed)
  })

  it('runs a first dispatch with no boot marker without asking the daemon first', async () => {
    const { lane, state, sends } = laneOf({ bootId: 'boot-a', answers: [] })
    void openCall({
      lane,
      request: { key: KEY, op: EXEC },
      dispatchedBootId: undefined,
      replayed: false,
    })
    await tick()
    expect(sends).toEqual([KEY])
    expect(state.asked).toEqual([])
  })

  it('ends a held call when the operator stops the turn', async () => {
    const { lane, settles, pending } = laneOf({ bootId: 'boot-a', answers: ['unavailable'] })
    const stop = new AbortController()
    const started = openCall({
      lane,
      request: { key: KEY, op: EXEC, signal: stop.signal },
      dispatchedBootId: undefined,
      replayed: true,
    })
    await tick()
    expect(pending.get(KEY)?.waiting).toBe(true)

    stop.abort()
    const result = await started
    expect(result.status).toBe(ECallStatus.Failed)
    expect(settles).toHaveLength(1)
    expect(pending.size).toBe(0)
  })

  it('ends a call that was sent, then held, when the operator stops the turn', async () => {
    const { lane, link, cancels, sends, settles, pending } = laneOf({
      bootId: 'boot-a',
      answers: ['unavailable'],
    })
    const stop = new AbortController()
    const started = openCall({
      lane,
      request: { key: KEY, op: EXEC, signal: stop.signal },
      dispatchedBootId: 'boot-a',
    })
    await tick()
    expect(sends).toEqual([KEY])

    link.up = false
    handleHello(lane, { bootId: 'boot-b', version: 'test' })
    await tick()
    expect(pending.get(KEY)?.waiting).toBe(true)
    expect(pending.get(KEY)?.sent).toBe(true)

    stop.abort()
    const result = await started
    expect(result.status).toBe(ECallStatus.Failed)
    expect(settles).toHaveLength(1)
    expect(pending.size).toBe(0)
    expect(cancels).toEqual([KEY])
  })

  it('ends a call the operator stopped while it awaited the answer', async () => {
    const answer = deferred()
    const { lane, settles, pending } = laneOf({ bootId: 'boot-a', answers: [answer.promise] })
    const stop = new AbortController()
    const started = openCall({
      lane,
      request: { key: KEY, op: EXEC, signal: stop.signal },
      dispatchedBootId: undefined,
      replayed: true,
    })
    await tick()
    expect(pending.get(KEY)?.awaitingAnswer).toBe(true)

    stop.abort()
    answer.answer('unavailable')
    const result = await started
    await tick()
    expect(result.status).toBe(ECallStatus.Failed)
    expect(settles).toHaveLength(1)
    expect(pending.size).toBe(0)
  })
})

describe('a proven restart still ends the call', () => {
  it('interrupts an effectful replay the new boot never saw, and never sends it', async () => {
    const { lane, sends, settles } = laneOf({
      bootId: 'boot-b',
      answers: [EDaemonAnswer.NeverSeen],
    })
    const result = await openCall({
      lane,
      request: { key: KEY, op: EXEC },
      dispatchedBootId: 'boot-a',
      replayed: true,
    })
    expect(sends).toEqual([])
    expect(result.status).toBe(ECallStatus.Failed)
    expect(settles).toHaveLength(1)
    expect(settles[0]?.status).toBe(ECallStatus.Failed)
  })
})
