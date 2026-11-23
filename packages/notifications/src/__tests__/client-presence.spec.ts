import { describe, expect, it } from 'bun:test'

import { PRESENCE_REPORT_MS } from '@dltech/atlas-core'

import { startPresenceReports, type PresenceClock, type PresenceState } from '../client'

class FakeClock implements PresenceClock<number> {
  private handler: (() => void) | undefined
  private nextHandle = 1
  intervals = 0

  setInterval(handler: () => void): number {
    this.handler = handler
    this.intervals += 1
    const handle = this.nextHandle
    this.nextHandle += 1
    return handle
  }

  clearInterval(_handle: number): void {
    this.handler = undefined
  }

  tick(): void {
    this.handler?.()
  }

  get repeating(): boolean {
    return this.handler !== undefined
  }
}

const harness = () => {
  const clock = new FakeClock()
  const reported: PresenceState[] = []
  let state: PresenceState = { sessionId: 'session-1', foreground: true }
  const listeners: (() => void)[] = []
  let unsubscribed = 0

  const stop = startPresenceReports({
    read: () => state,
    report: (next) => {
      reported.push(next)
    },
    subscribe: (onChange) => {
      listeners.push(onChange)
      return () => {
        unsubscribed += 1
      }
    },
    clock,
  })

  const change = (next: PresenceState): void => {
    state = next
    for (const listener of listeners) listener()
  }

  return {
    clock,
    reported,
    change,
    stop,
    listeners,
    unsubscribed: () => unsubscribed,
  }
}

describe('startPresenceReports', () => {
  it('reports on start', () => {
    const test = harness()
    expect(test.reported).toEqual([{ sessionId: 'session-1', foreground: true }])
  })

  it('starts the repeat only while foreground', () => {
    const test = harness()
    expect(test.clock.repeating).toBe(true)
    expect(test.clock.intervals).toBe(1)
  })

  it('repeats the current state on every interval', () => {
    const test = harness()
    test.clock.tick()
    test.clock.tick()
    expect(test.reported).toEqual([
      { sessionId: 'session-1', foreground: true },
      { sessionId: 'session-1', foreground: true },
      { sessionId: 'session-1', foreground: true },
    ])
  })

  it('repeats every 30 s by default', () => {
    const clock = new FakeClock()
    const every: number[] = []
    const recording: PresenceClock<number> = {
      setInterval: (handler, ms) => {
        every.push(ms)
        return clock.setInterval(handler)
      },
      clearInterval: (handle) => clock.clearInterval(handle),
    }
    startPresenceReports({
      read: () => ({ sessionId: null, foreground: true }),
      report: () => undefined,
      subscribe: () => () => undefined,
      clock: recording,
    })

    expect(every).toEqual([PRESENCE_REPORT_MS])
  })

  it('reports a change of session', () => {
    const test = harness()
    test.change({ sessionId: 'session-2', foreground: true })
    expect(test.reported.at(-1)).toEqual({ sessionId: 'session-2', foreground: true })
  })

  it('does not report a change listener that brings no new state', () => {
    const test = harness()
    test.change({ sessionId: 'session-1', foreground: true })
    expect(test.reported).toHaveLength(1)
  })

  it('reports away on blur and stops repeating', () => {
    const test = harness()
    test.change({ sessionId: 'session-1', foreground: false })
    const before = test.reported.length
    test.clock.tick()
    expect(test.reported.at(-1)).toEqual({ sessionId: 'session-1', foreground: false })
    expect(test.reported).toHaveLength(before)
    expect(test.clock.repeating).toBe(false)
  })

  it('reports foreground again when the client comes back', () => {
    const test = harness()
    test.change({ sessionId: 'session-1', foreground: false })
    test.change({ sessionId: 'session-1', foreground: true })
    expect(test.reported.at(-1)).toEqual({ sessionId: 'session-1', foreground: true })
    expect(test.clock.repeating).toBe(true)
  })

  it('stops the subscription and the repeat when stopped', () => {
    const test = harness()
    test.stop()
    expect(test.unsubscribed()).toBe(1)
    expect(test.clock.repeating).toBe(false)
  })
})
