import { describe, expect, it } from 'bun:test'

import { EClientRequest, EServeFrame } from '@dltech/atlas-client/channel'

import { IDLE_LIVE_THREAD, type LiveThreadView } from '../live-thread-view'
import { threadSourceOf } from '../thread-source'
import { flush, rig } from './live-thread-fixture'

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

  it('clears the queue when the pod parks', async () => {
    const test = await startLive()
    test.receive({
      kind: EServeFrame.Signal,
      seq: 1,
      signal: { type: 'pending-changed', entries },
    })

    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    await flush()

    expect(test.state().pending).toEqual([])
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
    expect(await taken).toEqual({ text: 'later', images: [], uploads: [] })
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

  it('passes pending through while live', () => {
    const source = threadSourceOf({ live: view({ live: true, pending: entries }), polled })
    expect(source.pending).toBe(entries)
  })

  it('has nothing pending while polling', () => {
    const source = threadSourceOf({ live: view({ pending: entries }), polled })
    expect(source.pending).toEqual([])
  })
})
