import { describe, expect, it } from 'bun:test'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { IDLE_LIVE_THREAD, type LiveThreadView } from '../live-thread-view'
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

const polled = { events: [event(1)], loaded: true, error: null }
const send = () => false
const chooseModel = async () => false
const liveView = (change: Partial<LiveThreadView>): LiveThreadView => ({
  ...IDLE_LIVE_THREAD,
  send,
  chooseModel,
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
