import { describe, expect, it } from 'bun:test'

import { elapsedMs, navigationMetrics, sessionOpenedProps, sidebarSnapshotProps } from '../perf'

describe('navigationMetrics', () => {
  it('derives durations from the navigation timing entry', () => {
    expect(
      navigationMetrics({
        startTime: 20,
        responseStart: 120,
        domContentLoadedEventEnd: 420,
        loadEventEnd: 720,
      }),
    ).toEqual({ ttfb_ms: 100, dom_content_loaded_ms: 400, load_ms: 700 })
  })

  it('rounds fractional timings', () => {
    expect(
      navigationMetrics({
        startTime: 0,
        responseStart: 12.6,
        domContentLoadedEventEnd: 40.2,
        loadEventEnd: 99.5,
      }),
    ).toEqual({ ttfb_ms: 13, dom_content_loaded_ms: 40, load_ms: 100 })
  })
})

describe('elapsedMs', () => {
  it('never reports a negative duration', () => {
    expect(elapsedMs({ from: 40, to: 10 })).toBe(0)
  })
})

describe('sessionOpenedProps', () => {
  it('reports v2 and the time from the route change to first content', () => {
    expect(sessionOpenedProps({ sessionId: 'ses_1', routeAt: 1000, firstContentAt: 1420 })).toEqual(
      {
        session_id: 'ses_1',
        v2: true,
        ms_to_first_content: 420,
      },
    )
  })
})

describe('sidebarSnapshotProps', () => {
  it('reports the row count and the time since mount', () => {
    expect(sidebarSnapshotProps({ rows: 7, mountedAt: 100, now: 340 })).toEqual({
      rows: 7,
      ms_since_mount: 240,
    })
  })
})
