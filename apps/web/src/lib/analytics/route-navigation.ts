import { elapsedMs } from './perf'

export enum ERouteNavigationOutcome {
  Committed = 'committed',
  Superseded = 'superseded',
  TimedOut = 'timed_out',
}

export interface RscTiming {
  name: string
  startTime: number
  fetchStart: number
  requestStart: number
  responseStart: number
  responseEnd: number
  nextHopProtocol: string
}

export interface RouteNavigationPorts {
  now: () => number
  schedule: (args: { delayMs: number; run: () => void }) => () => void
  openStreams: () => number
  currentPathname: () => string
  origin: string
  track: (event: string, props: Record<string, unknown>) => void
}

export interface RouteNavigationTracker {
  start: (args: { url: string; navigationType: string }) => void
  commit: (pathname: string) => void
  handleRscTiming: (timing: RscTiming) => void
}

export const ROUTE_NAVIGATED_EVENT = 'route_navigated'
export const NAVIGATION_TIMEOUT_MS = 30_000
export const RSC_SETTLE_MS = 2_000
const RSC_TIMING_LIMIT = 20
const RSC_START_SLACK_MS = 50
const RSC_QUERY = '_rsc'
const ID_PARENTS = new Set(['sessions', 'threads', 'routines', 'artifacts', 'projects', 'skills'])
const LITERAL_CHILDREN = new Set(['new'])

interface Navigation {
  path: string
  navigationType: string
  startedAt: number
  openStreams: number
}

interface Pending extends Navigation {
  cancelTimeout: () => void
}

interface Settling extends Navigation {
  outcome: ERouteNavigationOutcome
  endedAt: number
  cancelSettle: () => void
}

export function routePatternOf(pathname: string): string {
  const segments = pathname.split('/')
  return segments
    .map((segment, index) => {
      const parent = segments[index - 1]
      if (parent === undefined || !ID_PARENTS.has(parent)) return segment
      if (segment.length === 0 || LITERAL_CHILDREN.has(segment)) return segment
      return '[id]'
    })
    .join('/')
}

export function isRscFetch(url: string): boolean {
  return URL.canParse(url) && new URL(url).searchParams.has(RSC_QUERY)
}

function rscProps(timing: RscTiming | undefined): Record<string, unknown> {
  if (timing === undefined) return { rsc_fetched: false }
  const sent = timing.requestStart > 0
  return {
    rsc_fetched: true,
    rsc_protocol: timing.nextHopProtocol,
    rsc_total_ms: elapsedMs({ from: timing.startTime, to: timing.responseEnd }),
    ...(sent
      ? {
          rsc_stall_ms: elapsedMs({ from: timing.fetchStart, to: timing.requestStart }),
          rsc_server_ms: elapsedMs({ from: timing.requestStart, to: timing.responseStart }),
          rsc_download_ms: elapsedMs({ from: timing.responseStart, to: timing.responseEnd }),
        }
      : {}),
  }
}

export function routeNavigatedProps(args: {
  navigation: Navigation
  outcome: ERouteNavigationOutcome
  endedAt: number
  rsc: RscTiming | undefined
}): Record<string, unknown> {
  return {
    route: routePatternOf(args.navigation.path),
    navigation_type: args.navigation.navigationType,
    outcome: args.outcome,
    ms_to_commit: elapsedMs({ from: args.navigation.startedAt, to: args.endedAt }),
    open_streams: args.navigation.openStreams,
    ...rscProps(args.rsc),
  }
}

function pathOf({ url, origin }: { url: string; origin: string }): string | undefined {
  if (!URL.canParse(url, origin)) return undefined
  return new URL(url, origin).pathname
}

export function createRouteNavigationTracker(ports: RouteNavigationPorts): RouteNavigationTracker {
  let pending: Pending | undefined
  let lastCommittedPattern: string | undefined
  const settling = new Set<Settling>()
  const rscTimings: RscTiming[] = []

  const matches = ({ navigation, timing }: { navigation: Navigation; timing: RscTiming }) =>
    timing.startTime >= navigation.startedAt - RSC_START_SLACK_MS &&
    pathOf({ url: timing.name, origin: ports.origin }) === navigation.path

  const report = (navigation: Settling): void => {
    if (!settling.delete(navigation)) return
    navigation.cancelSettle()
    const rsc = rscTimings.find((timing) => matches({ navigation, timing }))
    ports.track(
      ROUTE_NAVIGATED_EVENT,
      routeNavigatedProps({
        navigation,
        outcome: navigation.outcome,
        endedAt: navigation.endedAt,
        rsc,
      }),
    )
  }

  const finish = (outcome: ERouteNavigationOutcome): void => {
    if (pending === undefined) return
    const { cancelTimeout, ...navigation } = pending
    pending = undefined
    cancelTimeout()
    const ended: Settling = {
      ...navigation,
      outcome,
      endedAt: ports.now(),
      cancelSettle: () => undefined,
    }
    settling.add(ended)
    if (rscTimings.some((timing) => matches({ navigation: ended, timing }))) {
      report(ended)
      return
    }
    ended.cancelSettle = ports.schedule({ delayMs: RSC_SETTLE_MS, run: () => report(ended) })
  }

  return {
    start: ({ url, navigationType }) => {
      const path = pathOf({ url, origin: ports.origin })
      if (path === undefined || path === ports.currentPathname()) return
      if (routePatternOf(path) === lastCommittedPattern) return
      finish(ERouteNavigationOutcome.Superseded)
      pending = {
        path,
        navigationType,
        startedAt: ports.now(),
        openStreams: ports.openStreams(),
        cancelTimeout: ports.schedule({
          delayMs: NAVIGATION_TIMEOUT_MS,
          run: () => finish(ERouteNavigationOutcome.TimedOut),
        }),
      }
    },
    commit: (pathname) => {
      if (pending?.path !== pathname) return
      finish(ERouteNavigationOutcome.Committed)
      lastCommittedPattern = routePatternOf(pathname)
    },
    handleRscTiming: (timing) => {
      rscTimings.push(timing)
      if (rscTimings.length > RSC_TIMING_LIMIT) rscTimings.shift()
      for (const navigation of settling) {
        if (matches({ navigation, timing })) report(navigation)
      }
    },
  }
}
