import { describe, expect, it } from 'bun:test'

import {
  createRouteNavigationTracker,
  ERouteNavigationOutcome,
  isRscFetch,
  NAVIGATION_TIMEOUT_MS,
  ROUTE_NAVIGATED_EVENT,
  routePatternOf,
  RSC_SETTLE_MS,
  type RscTiming,
} from '../route-navigation'

const ORIGIN = 'http://127.0.0.1:4100'

function harness() {
  let clock = 0
  let pathname = '/sessions/ses_a'
  let streams = 3
  const timers: { at: number; run: () => void; cancelled: boolean }[] = []
  const events: { event: string; props: Record<string, unknown> }[] = []
  const tracker = createRouteNavigationTracker({
    now: () => clock,
    schedule: ({ delayMs, run }) => {
      const timer = { at: clock + delayMs, run, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    openStreams: () => streams,
    currentPathname: () => pathname,
    origin: ORIGIN,
    track: (event, props) => events.push({ event, props }),
  })
  const advance = (ms: number) => {
    clock += ms
    for (const timer of timers.filter((t) => !t.cancelled && t.at <= clock)) {
      timer.cancelled = true
      timer.run()
    }
  }
  return {
    tracker,
    events,
    advance,
    setPathname: (next: string) => {
      pathname = next
    },
    setStreams: (next: number) => {
      streams = next
    },
    now: () => clock,
  }
}

const rscTiming = (overrides: Partial<RscTiming> = {}): RscTiming => ({
  name: `${ORIGIN}/sessions/ses_b?_rsc=abc12`,
  startTime: 10,
  fetchStart: 10,
  requestStart: 4010,
  responseStart: 4110,
  responseEnd: 4130,
  nextHopProtocol: 'http/1.1',
  ...overrides,
})

describe('routePatternOf', () => {
  it('replaces ids after known collections', () => {
    expect(routePatternOf('/sessions/ses_123')).toBe('/sessions/[id]')
    expect(routePatternOf('/projects/p1/settings/skills/s1')).toBe(
      '/projects/[id]/settings/skills/[id]',
    )
  })

  it('keeps literal children and static routes', () => {
    expect(routePatternOf('/threads/new')).toBe('/threads/new')
    expect(routePatternOf('/settings/agent')).toBe('/settings/agent')
  })
})

describe('isRscFetch', () => {
  it('matches only flight requests', () => {
    expect(isRscFetch(`${ORIGIN}/sessions/x?_rsc=1a2b`)).toBe(true)
    expect(isRscFetch(`${ORIGIN}/v1/trpc/sessions.list`)).toBe(false)
  })
})

describe('route navigation tracker', () => {
  it('reports the click-to-commit time with the flight request breakdown', () => {
    const h = harness()
    h.advance(10)
    h.tracker.start({ url: '/sessions/ses_b', navigationType: 'push' })
    h.setStreams(9)
    h.tracker.handleRscTiming(rscTiming())
    h.advance(4140)
    h.tracker.commit('/sessions/ses_b')

    expect(h.events).toEqual([
      {
        event: ROUTE_NAVIGATED_EVENT,
        props: {
          route: '/sessions/[id]',
          navigation_type: 'push',
          outcome: ERouteNavigationOutcome.Committed,
          ms_to_commit: 4140,
          open_streams: 3,
          rsc_fetched: true,
          rsc_protocol: 'http/1.1',
          rsc_total_ms: 4120,
          rsc_stall_ms: 4000,
          rsc_server_ms: 100,
          rsc_download_ms: 20,
        },
      },
    ])
  })

  it('waits for a flight timing that lands after the commit', () => {
    const h = harness()
    h.tracker.start({ url: '/sessions/ses_b', navigationType: 'push' })
    h.advance(300)
    h.tracker.commit('/sessions/ses_b')
    expect(h.events).toEqual([])

    h.tracker.handleRscTiming(rscTiming({ startTime: 0 }))
    expect(h.events[0]?.props.rsc_fetched).toBe(true)
    expect(h.events[0]?.props.ms_to_commit).toBe(300)
  })

  it('reports a navigation without a flight request after the settle window', () => {
    const h = harness()
    h.tracker.start({ url: '/sessions/ses_b', navigationType: 'push' })
    h.advance(40)
    h.tracker.commit('/sessions/ses_b')
    h.advance(RSC_SETTLE_MS)

    expect(h.events.map((e) => [e.props.ms_to_commit, e.props.rsc_fetched])).toEqual([[40, false]])
  })

  it('omits the breakdown when the browser hides the request phases', () => {
    const h = harness()
    h.tracker.start({ url: '/sessions/ses_b', navigationType: 'push' })
    h.tracker.handleRscTiming(rscTiming({ startTime: 0, requestStart: 0, responseStart: 0 }))
    h.tracker.commit('/sessions/ses_b')

    expect(h.events[0]?.props).not.toHaveProperty('rsc_stall_ms')
    expect(h.events[0]?.props.rsc_total_ms).toBe(4130)
  })

  it('marks a navigation that a newer click replaced as superseded', () => {
    const h = harness()
    h.tracker.start({ url: '/sessions/ses_b', navigationType: 'push' })
    h.advance(900)
    h.tracker.start({ url: '/sessions/ses_c', navigationType: 'push' })
    h.advance(50)
    h.tracker.commit('/sessions/ses_c')
    h.advance(RSC_SETTLE_MS)

    expect(h.events.map((e) => [e.props.outcome, e.props.ms_to_commit])).toEqual([
      [ERouteNavigationOutcome.Superseded, 900],
      [ERouteNavigationOutcome.Committed, 50],
    ])
  })

  it('reports a navigation that never commits as timed out', () => {
    const h = harness()
    h.tracker.start({ url: '/sessions/ses_b', navigationType: 'push' })
    h.advance(NAVIGATION_TIMEOUT_MS)
    h.advance(RSC_SETTLE_MS)

    expect(h.events.map((e) => [e.props.outcome, e.props.ms_to_commit])).toEqual([
      [ERouteNavigationOutcome.TimedOut, NAVIGATION_TIMEOUT_MS],
    ])
  })

  it('ignores navigations to the current path and commits for other paths', () => {
    const h = harness()
    h.tracker.start({ url: `${ORIGIN}/sessions/ses_a?tab=files`, navigationType: 'replace' })
    h.tracker.start({ url: '/sessions/ses_b', navigationType: 'push' })
    h.tracker.commit('/sessions/ses_z')
    h.advance(RSC_SETTLE_MS)

    expect(h.events).toEqual([])
  })
})
