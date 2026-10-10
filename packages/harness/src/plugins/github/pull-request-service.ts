import type { LinkedPullRequest } from '@dltech/atlas-core'

import { createExpectingWindows } from './expecting-windows'
import {
  checkoutKey,
  EPollDecision,
  POLL_FLOOR_MS,
  pollDecision,
  type PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from './pure'
import { announcePolled, type PolledPullRequest } from './polled-pull-request'
import { createInFlightReads } from './in-flight-reads'
import { createPullRequestReadings } from './pull-request-readings'
import type { PullRequestService } from './pull-request-service-type'
import { keyOf, linkKey, readTarget, type PullTarget } from './pull-target'
import { createTrackedCheckouts } from './tracked-checkouts'
import { pullRequestStatesWireOf, repoOf, type TrackedReading } from './pull-request-state-wire'

export type { PullRequestService } from './pull-request-service-type'

export const PULL_REQUEST_TICK_MS = 5_000

/**
 * How long after a push the schedule stays eager. GitHub usually registers a check run within
 * seconds, so this is sized for a congested Actions queue rather than the common case, and it costs
 * at most the window divided by the running cadence — six reads — because inside it the schedule
 * asks at exactly the rate running checks already earn.
 */
export const EXPECTING_CHECKS_MS = 3 * 60_000

export function createPullRequestService(args: {
  pullRequests: PullRequestPort
  now?: () => number
  tickMs?: number
  floorMs?: number
  expectingMs?: number
  onPolled?: (polled: PolledPullRequest) => void
}): PullRequestService {
  const now = args.now ?? Date.now
  const floorMs = args.floorMs ?? POLL_FLOOR_MS
  const tickMs = args.tickMs ?? PULL_REQUEST_TICK_MS
  const expectingMs = args.expectingMs ?? EXPECTING_CHECKS_MS

  const listeners = new Set<() => void>()
  const inFlight = createInFlightReads()
  const watched = new Map<string, LinkedPullRequest>()

  const tracked = createTrackedCheckouts()
  const windows = createExpectingWindows({ now, windowMs: expectingMs })

  let version = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  const notify = (): void => {
    version += 1
    for (const listener of listeners) listener()
  }

  const readings = createPullRequestReadings({ notify })

  const ask = async (request: {
    key: string
    target: PullTarget
    owned: () => boolean
  }): Promise<void> => {
    readings.markAsked({ key: request.key, at: now() })
    const reading = await readTarget({ port: args.pullRequests, target: request.target })
    if (disposed || !request.owned()) return
    if (request.target.kind === 'link' && !watched.has(request.key)) return

    readings.record({ key: request.key, reading })
    if (args.pullRequests.pushes) return

    announcePolled({
      listener: args.onPolled,
      key: request.key,
      repo: request.target.kind === 'checkout' ? repoOf(request.target.checkout) : request.target.link.repo,
      reading,
    })
  }

  const begin = (request: { key: string; target: PullTarget }): Promise<void> =>
    inFlight.start({
      key: request.key,
      run: (owned) => ask({ ...request, owned }),
    })

  const refreshTarget = async (request: {
    target: PullTarget
    force?: boolean
  }): Promise<void> => {
    if (disposed) return

    const key = keyOf(request.target)
    const running = inFlight.running({ key })
    if (running !== undefined) return running

    const schedule = readings.scheduleOf({ key })
    const decision = pollDecision({
      lastAskedAt: schedule.lastAskedAt,
      lastReading: schedule.lastReading,
      consecutiveFailures: schedule.consecutiveFailures,
      now: now(),
      floorMs,
      expectingUntil: windows.untilOf({ key }),
    })
    if (decision === EPollDecision.Hold) return
    if (decision === EPollDecision.Never && request.force !== true) return

    return begin({ key, target: request.target })
  }

  const refresh = (request: {
    checkout: RepositoryCheckout
    force?: boolean
  }): Promise<void> =>
    refreshTarget({
      target: { kind: 'checkout', checkout: request.checkout },
      force: request.force === true,
    })

  /**
   * The schedule has nothing useful to say about a key whose answer we have just been told changed,
   * so this consults the floor and nothing else. `force` on `refresh` is a different request — it
   * means "a trigger rather than the timer", and it deliberately leaves the cadence in charge so a
   * turn ending does not buy a read every ten seconds.
   */
  const askNow = async (checkout: RepositoryCheckout): Promise<void> => {
    const key = checkoutKey(checkout)
    const running = inFlight.running({ key })
    if (running !== undefined) return running

    const last = readings.scheduleOf({ key }).lastAskedAt
    if (last !== null && now() - last < floorMs) return

    return begin({ key, target: { kind: 'checkout', checkout } })
  }

  const untick = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const tick = (): void => {
    for (const checkout of tracked.list()) void refresh({ checkout })
    for (const link of watched.values()) {
      void refreshTarget({ target: { kind: 'link', link } })
    }
  }

  /**
   * One interval serves every tracked checkout and every watched link, so it lives while either
   * does. A pushing port arms nothing, as before.
   */
  const syncTimer = (): void => {
    untick()
    if (disposed || args.pullRequests.pushes) return
    if (tracked.list().length === 0 && watched.size === 0) return

    timer = setInterval(tick, tickMs)
    timer.unref?.()
  }

  return {
    snapshot: readings.snapshot,
    version: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ingest: ({ key, reading }) => {
      if (disposed) return
      readings.record({ key, reading })
    },
    refresh,
    /**
     * Mirrors `watch`: a key the set loses is forgotten in the same tick and any read still in
     * flight for it is disowned, so a worktree hop or a thread leaving cannot leave its pull request
     * on the footer for a poll interval or have a late answer resurrect it.
     */
    track: ({ checkouts, visible }) => {
      if (disposed) return

      const { gained, lost, visibleChanged } = tracked.reconcile({
        checkouts,
        ...(visible === undefined ? {} : { visible }),
      })
      for (const key of lost) {
        inFlight.disown({ key })
        windows.forget({ key })
        readings.forget({ key })
      }
      if (lost.length > 0 || visibleChanged) notify()

      for (const checkout of gained) {
        void refreshTarget({ target: { kind: 'checkout', checkout }, force: true })
      }
      syncTimer()
    },
    setVisible: ({ checkout }) => {
      if (disposed) return

      const { visibleChanged } = tracked.reconcile({ checkouts: tracked.list(), visible: checkout })
      if (visibleChanged) notify()
    },
    tracked: () => tracked.list(),
    /**
     * The durable link set, mirrored: a key the set gains is asked at once, and a key it loses is
     * forgotten exactly as a hopped-away checkout is — mid-flight reads for it are dropped on
     * landing rather than resurrecting the key.
     */
    watch: ({ links }) => {
      if (disposed) return

      const next = new Map(links.map((link) => [linkKey(link), link]))
      let dropped = false
      for (const key of [...watched.keys()]) {
        if (next.has(key)) continue

        watched.delete(key)
        readings.forget({ key })
        dropped = true
      }
      for (const [key, link] of next) {
        if (watched.has(key)) continue

        watched.set(key, link)
        void refreshTarget({ target: { kind: 'link', link }, force: true })
      }
      if (dropped) notify()
      syncTimer()
    },
    current: () => {
      const checkout = tracked.visible()
      if (checkout === null) return null

      return { checkout, reading: readings.snapshot({ key: checkoutKey(checkout) }) }
    },
    states: () => {
      const readingsHeld: TrackedReading[] = tracked.list().map((checkout) => ({
        key: checkoutKey(checkout),
        checkout,
        reading: readings.snapshot({ key: checkoutKey(checkout) }),
      }))
      for (const [key, link] of watched) {
        readingsHeld.push({ key, link, reading: readings.snapshot({ key }) })
      }
      return pullRequestStatesWireOf(readingsHeld)
    },
    /**
     * The window is remembered even before the checkout is tracked, because the hook that hears a
     * push can run a beat ahead of the tracker that learns the thread stands there.
     */
    expectChecks: ({ checkout }) => {
      if (disposed) return

      const key = checkoutKey(checkout)
      windows.arm({ key })
      if (tracked.get({ key }) === null) return

      void askNow(checkout)
    },
    /**
     * One read and no window. After something that has already settled the pull request there is
     * nothing pending to chase, so staying eager for three minutes would poll a merged branch that
     * the settled cadence would otherwise have quieted.
     */
    recheck: ({ checkout }) => {
      if (disposed || tracked.get({ key: checkoutKey(checkout) }) === null) return

      void askNow(checkout)
    },
    dispose: () => {
      disposed = true
      windows.clear()
      tracked.clear()
      watched.clear()
      untick()
      listeners.clear()
      readings.clear()
      inFlight.clear()
    },
  }
}
