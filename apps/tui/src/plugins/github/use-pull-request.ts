import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { LinkedPullRequest, PullRequestState } from '@dltech/atlas-core'
import {
  checkoutKey,
  EChecksState,
  EPullRequestLookup,
  probeCheckout,
  pullRequestBadge,
  pullRequestEntries,
  type PullRequest,
  type PullRequestBadge,
  type PullRequestEntry,
  type PullRequestReading,
  type PullRequestService,
  type RepositoryCheckout,
} from '@dltech/atlas-harness'

import { useShimmerClock } from '../../ui/hooks/use-shimmer-clock'
import type { SidebarRowSplit } from '../../ui/sidebar-section'
import { SPINNER_FRAME_MS, theme } from '../../ui/theme'
import { ESidebarPlace, type SidebarSection, type SidebarSectionRow } from '../surface'
import { pullRequestRow } from './pull-request-row'

export type FooterPullRequest = {
  badge: PullRequestBadge | null
  label: string
  url: string
  overflow: number
}

export type PullRequestControl = {
  footer: FooterPullRequest | null
  section: SidebarSection | null
}

export type CheckoutProbe = (args: { directory: string }) => Promise<RepositoryCheckout | null>

const sameCheckout = (
  left: RepositoryCheckout | null,
  right: RepositoryCheckout | null,
): boolean => {
  if (left === null || right === null) return left === right

  return left.directory === right.directory && checkoutKey(left) === checkoutKey(right)
}

const foundPullRequest = (entry: PullRequestEntry) =>
  entry.reading !== null && entry.reading.lookup === EPullRequestLookup.Found
    ? entry.reading.pullRequest
    : null

const checksOf = (state: PullRequestState): PullRequest['checks'] => {
  if (state.checksFailed > 0) return EChecksState.Failing
  if (state.checksRunning > 0) return EChecksState.Running
  if (state.checksPassed > 0) return EChecksState.Passing
  return EChecksState.None
}

/**
 * The session log's last-known state for one PR, as a reading the tile can render before the
 * live source (gh poll or SSE) has answered. The live answer always wins — this only fills the
 * gap where the service still has nothing `Found` to show.
 */
const recordedReading = (
  recorded: readonly PullRequestState[],
  key: string,
): PullRequestReading | null => {
  const state = recorded.find((entry) => `${entry.repo}#${entry.number}` === key)
  if (state === undefined) return null

  return {
    lookup: EPullRequestLookup.Found,
    pullRequest: {
      number: state.number,
      title: '',
      url: state.url,
      state: state.state,
      checks: checksOf(state),
      tally: { running: state.checksRunning, passed: state.checksPassed, failed: state.checksFailed },
    },
  }
}

const withRecordedFallback = (
  live: PullRequestReading,
  recorded: readonly PullRequestState[],
  key: string,
): PullRequestReading =>
  live.lookup === EPullRequestLookup.Found ? live : (recordedReading(recorded, key) ?? live)

const rowOf = (args: {
  entry: PullRequestEntry
  now: number
  onOpen: (url: string) => void
}): SidebarSectionRow => {
  const { entry, now, onOpen } = args
  const pullRequest = foundPullRequest(entry)

  const spans =
    pullRequest !== null
      ? pullRequestRow({ pullRequest, now })
      : (): SidebarRowSplit => ({
          left: [
            { text: `#${entry.number}`, fg: theme.code },
            { text: ` ${entry.branch}`, fg: theme.hint },
          ],
          right: [],
        })

  return {
    id: entry.current ? 'pull-request-current' : `pull-request-${entry.key}`,
    spans,
    onActivate: () => onOpen(entry.url),
  }
}

/**
 * The branch is probed rather than read off the log, and it is re-probed when the turn ends: a
 * `git checkout -b` inside a worktree changes the branch without changing the project directory,
 * so the directory effect alone would miss it.
 *
 * Every probe is disowned by its effect's cleanup, because two `git` calls started against
 * different directories can land in either order and the loser would otherwise re-track the
 * directory the session has already left.
 */
export function usePullRequest(args: {
  service: PullRequestService
  projectDirectory: string
  working: boolean
  linked: readonly LinkedPullRequest[]
  recorded?: readonly PullRequestState[]
  cloud: RepositoryCheckout | null
  onOpen: (url: string) => void
  probe?: CheckoutProbe
}): PullRequestControl {
  const { service, projectDirectory, working, linked, recorded = [], cloud, onOpen } = args
  const askGit = args.probe ?? probeCheckout
  const [checkout, setCheckout] = useState<RepositoryCheckout | null>(null)

  const version = useSyncExternalStore(service.subscribe, service.version)

  useEffect(() => {
    if (cloud === null) return

    setCheckout((current) => (sameCheckout(current, cloud) ? current : cloud))
    service.track({ checkout: cloud })
  }, [cloud, service])

  const probe = useCallback(
    async (owned: () => boolean): Promise<void> => {
      if (cloud !== null) return

      const probed = await askGit({ directory: projectDirectory })
      if (!owned()) return

      setCheckout((current) => (sameCheckout(current, probed) ? current : probed))
      if (probed === null) {
        service.stopTracking()
        return
      }

      service.track({ checkout: probed })
    },
    [askGit, cloud, projectDirectory, service],
  )

  useEffect(() => {
    let owned = true
    void probe(() => owned)

    return () => {
      owned = false
    }
  }, [probe])

  const turnWasRunning = useRef(false)
  useEffect(() => {
    const ended = turnWasRunning.current && !working
    turnWasRunning.current = working
    if (!ended) return

    let owned = true
    void probe(() => owned)

    return () => {
      owned = false
    }
  }, [probe, working])

  const entries = useMemo(() => {
    const reading =
      checkout === null
        ? null
        : withRecordedFallback(service.snapshot({ key: checkoutKey(checkout) }), recorded, checkoutKey(checkout))
    return pullRequestEntries({
      linked,
      read: (key) => withRecordedFallback(service.snapshot({ key }), recorded, key),
      current: checkout === null || reading === null ? null : { checkout, reading },
    })
  }, [checkout, linked, recorded, service, version])

  const anyRunning = entries.some((entry) => {
    const pullRequest = foundPullRequest(entry)
    return (pullRequest?.tally.running ?? 0) > 0
  })
  const now = useShimmerClock({ active: anyRunning, intervalMs: SPINNER_FRAME_MS })

  const footer = useMemo((): FooterPullRequest | null => {
    const latest = entries[entries.length - 1]
    if (latest === undefined) return null

    const pullRequest = foundPullRequest(latest)
    return {
      badge: pullRequest === null ? null : pullRequestBadge(pullRequest),
      label: `#${latest.number}`,
      url: latest.url,
      overflow: entries.length - 1,
    }
  }, [entries])

  const section = useMemo((): SidebarSection | null => {
    const rows: SidebarSectionRow[] = []

    if (checkout !== null) {
      rows.push({
        id: 'branch',
        spans: { left: [{ text: checkout.branch, fg: theme.hover }], right: [] },
      })
    }
    for (const entry of entries) rows.push(rowOf({ entry, now, onOpen }))
    if (rows.length === 0) return null

    return { id: 'github', place: ESidebarPlace.Facts, rows }
  }, [checkout, entries, now, onOpen])

  return useMemo(() => ({ footer, section }), [footer, section])
}
