import { describe, expect, it } from 'bun:test'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { IDLE_LIVE_THREAD, type LiveThreadView, type ServeChannel } from '../live-thread-view'
import { pollingEnabledFor, threadSourceOf } from '../thread-source'

const event = (seq: number): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'user-said',
  body: '{}',
})

const polled = { events: [event(1)], loaded: true, error: null, poke: () => undefined }
const send = () => false
const chooseModel = async () => false
const takeBackPending = async () => null
const interrupt = () => false
const liveView = (change: Partial<LiveThreadView>): LiveThreadView => ({
  ...IDLE_LIVE_THREAD,
  steps: [],
  send,
  chooseModel,
  takeBackPending,
  interrupt,
  ...change,
})

describe('threadSourceOf', () => {
  it('serves the polled events while the stream is not live', () => {
    const source = threadSourceOf({ live: liveView({}), polled })
    expect(source.live).toBe(false)
    expect(source.events).toBe(polled.events)
    expect(source.working).toBe(false)
  })

  it('serves the streamed events and working flag while live', () => {
    const streamed = [event(1), event(2)]
    const source = threadSourceOf({
      live: liveView({ live: true, events: streamed, working: true }),
      polled,
    })
    expect(source).toMatchObject({ live: true, working: true, loaded: true, error: null })
    expect(source.events).toBe(streamed)
  })
})

describe('threadSourceOf channel', () => {
  const channel = {} as ServeChannel

  it('carries the live channel while streaming', () => {
    const source = threadSourceOf({ live: liveView({ live: true, channel }), polled })
    expect(source.channel).toBe(channel)
  })

  it('has no channel while polling', () => {
    const source = threadSourceOf({ live: liveView({ channel }), polled })
    expect(source.channel).toBeNull()
  })
})

describe('threadSourceOf interrupt', () => {
  it('exposes interrupt from the live source', () => {
    const source = threadSourceOf({ live: liveView({ live: true }), polled })
    expect(source.interrupt).toBe(interrupt)
  })

  it('exposes interrupt in the polled branch', () => {
    const source = threadSourceOf({ live: liveView({}), polled })
    expect(source.interrupt).toBe(interrupt)
    expect(source.interrupt()).toBe(false)
  })
})

describe('pollingEnabledFor', () => {
  it('polls until the stream is live, stops while live, and resumes after a fallback', () => {
    const states = [
      liveView({}),
      liveView({ live: true }),
      liveView({ live: false, working: false }),
    ]
    expect(states.map((live) => pollingEnabledFor(live))).toEqual([true, false, true])
  })
})

describe('threadSourceOf operator input', () => {
  const request = { requestId: 'opin_1', description: 'Paste the code', path: '/tmp/code' }

  it('surfaces the pending request while live', () => {
    const source = threadSourceOf({
      live: liveView({ live: true, operatorInput: request }),
      polled,
    })
    expect(source.operatorInput).toBe(request)
    expect(source.waitingOnOperator).toBe(true)
  })

  it('is not waiting without a request or while polling', () => {
    expect(threadSourceOf({ live: liveView({ live: true }), polled }).waitingOnOperator).toBe(false)
    const polling = threadSourceOf({ live: liveView({ operatorInput: request }), polled })
    expect(polling).toMatchObject({ operatorInput: null, waitingOnOperator: false })
  })
})
