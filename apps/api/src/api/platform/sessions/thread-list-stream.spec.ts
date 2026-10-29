import { EThreadListFrame, type ThreadListFrame } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { attachListStream } from './thread-list-stream'
import { THREAD_STREAM_HEARTBEAT_INTERVAL_MS, THREAD_STREAM_LIFETIME_MS } from './thread-stream'

const fakeSignals = () => {
  let detached = false
  return {
    openListStream: () => () => {
      detached = true
    },
    detached: () => detached,
  }
}

describe('attachListStream', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('beats on the heartbeat interval and closes at the lifetime cap', () => {
    const pushed: ThreadListFrame[] = []
    let closed = false
    const signals = fakeSignals()
    const detach = attachListStream({
      signals,
      userId: 'usr_a',
      sink: { push: (frame) => pushed.push(frame), close: () => (closed = true) },
    })

    jest.advanceTimersByTime(THREAD_STREAM_HEARTBEAT_INTERVAL_MS)
    expect(pushed).toEqual([{ type: EThreadListFrame.Heartbeat }])
    jest.advanceTimersByTime(THREAD_STREAM_LIFETIME_MS)
    expect(closed).toBe(true)

    detach()
    expect(signals.detached()).toBe(true)
  })
})
