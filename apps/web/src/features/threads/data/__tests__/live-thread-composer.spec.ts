import { describe, expect, it } from 'bun:test'

import { EClientRequest, EServeFrame, toStepId } from '@dltech/atlas-client/channel'
import type { ChannelSignal } from '@dltech/atlas-client/channel'
import { EFinishReason } from '@dltech/atlas-core'

import { IDLE_LIVE_THREAD, type LiveThreadView } from '../live-thread-view'
import { threadSourceOf } from '../thread-source'
import { flush, rig } from './live-thread-fixture'

const step = toStepId('step_1')
const finish = (usage?: { inputTokens: number; outputTokens: number }): ChannelSignal => ({
  type: 'chunk',
  stepId: step,
  chunk: { type: 'finish', reason: EFinishReason.Stop, ...(usage === undefined ? {} : { usage }) },
})

const entries = [{ id: 'p1', text: 'later', reserved: false }]

const startLive = async () => {
  const test = rig()
  test.controller.start()
  await flush()
  test.ready()
  await flush()
  return test
}

describe('live thread pending queue', () => {
  it('starts empty and follows the sandbox queue', async () => {
    const test = await startLive()
    expect(test.state().pending).toEqual([])

    test.receive({
      kind: EServeFrame.Signal,
      seq: 1,
      signal: { type: 'pending-changed', entries },
    })
    expect(test.state().pending).toEqual(entries)

    test.receive({
      kind: EServeFrame.Signal,
      seq: 2,
      signal: { type: 'pending-changed', entries: [] },
    })
    expect(test.state().pending).toEqual([])
  })

  it('clears the queue and the reported usage when the pod parks', async () => {
    const test = await startLive()
    test.receive({
      kind: EServeFrame.Signal,
      seq: 1,
      signal: { type: 'pending-changed', entries },
    })
    test.receive({
      kind: EServeFrame.Signal,
      seq: 2,
      signal: finish({ inputTokens: 5, outputTokens: 1 }),
    })

    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    await flush()

    expect(test.state().pending).toEqual([])
    expect(test.state().reported).toBeNull()
  })
})

describe('live thread take-back', () => {
  it('asks the sandbox to take back and returns the text', async () => {
    const test = await startLive()
    const before = test.requests().length
    const taken = test.controller.takeBackPending()
    await flush()

    const request = test.requests()[before]
    expect(request?.op).toBe(EClientRequest.TakeBackPending)
    expect(request?.params).toEqual({ threadId: 'thr_1' })

    test.reply({ index: before, data: { taken: { text: 'later', images: [], files: [] } } })
    expect(await taken).toBe('later')
  })

  it('resolves null when it is too late', async () => {
    const test = await startLive()
    const before = test.requests().length
    const taken = test.controller.takeBackPending()
    await flush()
    test.reply({ index: before, data: { taken: null } })
    expect(await taken).toBeNull()
  })

  it('rejects when there is no live channel', async () => {
    const test = rig()
    expect(test.controller.takeBackPending()).rejects.toThrow()
  })
})

describe('live thread reported usage', () => {
  it('keeps the last finish usage across event settling', async () => {
    const test = await startLive()
    expect(test.state().reported).toBeNull()

    test.receive({
      kind: EServeFrame.Signal,
      seq: 1,
      signal: finish({ inputTokens: 100, outputTokens: 20 }),
    })
    expect(test.state().reported).toEqual({ inputTokens: 100, outputTokens: 20 })

    test.receive({ kind: EServeFrame.Signal, seq: 2, signal: finish() })
    test.receive({ kind: EServeFrame.Signal, seq: 3, signal: { type: 'events-appended' } })
    await flush()
    expect(test.state().reported).toEqual({ inputTokens: 100, outputTokens: 20 })
  })
})

describe('threadSourceOf composer fields', () => {
  const takeBackPending = async () => null
  const view = (change: Partial<LiveThreadView>): LiveThreadView => ({
    ...IDLE_LIVE_THREAD,
    send: () => false,
    chooseModel: async () => false,
    takeBackPending,
    ...change,
  })
  const polled = { events: [], loaded: true, error: null }

  it('passes pending and usage through while live', () => {
    const reported = { inputTokens: 1, outputTokens: 2 }
    const source = threadSourceOf({
      live: view({ live: true, pending: entries, reported }),
      polled,
    })
    expect(source.pending).toBe(entries)
    expect(source.reported).toBe(reported)
  })

  it('has nothing pending and no usage while polling', () => {
    const source = threadSourceOf({
      live: view({ pending: entries, reported: { inputTokens: 1, outputTokens: 2 } }),
      polled,
    })
    expect(source.pending).toEqual([])
    expect(source.reported).toBeNull()
  })
})
