import { track, trackBeforeUnload } from './analytics'
import { installOpenStreamCounter } from './open-streams'
import {
  createRouteNavigationTracker,
  isRscFetch,
  type RouteNavigationTracker,
} from './route-navigation'

let tracker: RouteNavigationTracker | undefined

function handlePageHide(): void {
  tracker?.abandon()
}

function observeRscFetches(onTiming: RouteNavigationTracker['handleRscTiming']): void {
  if (typeof PerformanceObserver === 'undefined') return
  if (!PerformanceObserver.supportedEntryTypes.includes('resource')) return
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry instanceof PerformanceResourceTiming && isRscFetch(entry.name)) onTiming(entry)
    }
  })
  observer.observe({ type: 'resource' })
}

export function startRouteNavigationTracking(): void {
  if (tracker !== undefined || typeof window === 'undefined') return
  const streams = installOpenStreamCounter(window)
  tracker = createRouteNavigationTracker({
    now: () => performance.now(),
    schedule: ({ delayMs, run }) => {
      const handle = setTimeout(run, delayMs)
      return () => clearTimeout(handle)
    },
    openStreams: streams.count,
    currentPathname: () => window.location.pathname,
    origin: window.location.origin,
    track: ({ event, props, atUnload }) =>
      atUnload ? trackBeforeUnload(event, props) : track(event, props),
  })
  observeRscFetches(tracker.handleRscTiming)
  window.addEventListener('pagehide', handlePageHide)
}

export function markRouteNavigationStart(args: { url: string; navigationType: string }): void {
  tracker?.start(args)
}

export function markRouteCommitted(pathname: string): void {
  tracker?.commit(pathname)
}
