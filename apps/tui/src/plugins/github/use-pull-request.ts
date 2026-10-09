import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { LinkedPullRequest } from '@dltech/atlas-core'
import { EPullRequestState } from '@dltech/atlas-core'
import {
  checkoutKey,
  EChecksState,
  EPullRequestLookup,
  NO_PULL_REQUEST_READING,
  probeCheckout,
  pullRequestBadge,
  pullRequestEntries,
  type PullRequest,
  type PullRequestBadge,
  type PullRequestEntry,
  type PullRequestPort,
  type PullRequestReading,
  type PullRequestService,
  type RemotePrStateReader,
  type RepositoryCheckout,
} from '@dltech/atlas-harness'
import type { PrStateWire } from '@dltech/atlas-wire'

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

const wireChecksOf = (state: PrStateWire): PullRequest['checks'] => {
  if (state.checksFailed > 0) return EChecksState.Failing
  if (state.checksRunning > 0) return EChecksState.Running
  if (state.checksPassed > 0) return EChecksState.Passing
  return EChecksState.None
}

/**
 * A cloud thread's live state arrives over the channel as a wire record, not a service reading. The
 * tile renders it the same way — only the source differs.
 */
const wireStateOf = (state: PrStateWire['state']): PullRequest['state'] => {
  if (state === 'open') return EPullRequestState.Open
  if (state === 'draft') return EPullRequestState.Draft
  if (state === 'merged') return EPullRequestState.Merged
  return EPullRequestState.Closed
}

const wireReading = (state: PrStateWire): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: state.number,
    title: '',
    url: state.url,
    state: wireStateOf(state.state),
    checks: wireChecksOf(state),
    tally: { running: state.checksRunning, passed: state.checksPassed, failed: state.checksFailed },
    mergeable: state.mergeable,
    comments: [],
    reviews: [],
  },
})

const repoStringOf = (checkout: RepositoryCheckout): string =>
  `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}`

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
  cloud: RepositoryCheckout | null
  /** The channel-fed reader for a cloud thread's live states; absent for local threads. */
  remote?: RemotePrStateReader | null
  /** The badge cache behind the muted fallback when a cloud serve is unreachable. */
  badges?: PullRequestPort | null
  onOpen: (url: string) => void
  probe?: CheckoutProbe
}): PullRequestControl {
  const { service, projectDirectory, working, linked, cloud, onOpen } = args
  const remote = args.remote ?? null
  const badges = args.badges ?? null
  const askGit = args.probe ?? probeCheckout
  const [checkout, setCheckout] = useState<RepositoryCheckout | null>(null)
  const [remoteStates, setRemoteStates] = useState<readonly PrStateWire[]>([])

  const version = useSyncExternalStore(service.subscribe, service.version)

  // A cloud thread renders the serve's live set, pushed over the channel; the local service never
  // tracks it. When the serve is unreachable the badge cache fills the gap with the muted
  // last-known reading.
  useEffect(() => {
    if (cloud === null || remote === null) return

    setCheckout((current) => (sameCheckout(current, cloud) ? current : cloud))
    let owned = true
    const apply = (states: readonly PrStateWire[]) => {
      if (owned) setRemoteStates(states)
    }
    void remote.states().then(apply)
    return remote.onChange(() => {
      void remote.states().then(apply)
    })
  }, [cloud, remote])

  useEffect(() => {
    if (cloud !== null) return
    setRemoteStates([])
  }, [cloud])

  useEffect(() => {
    if (cloud === null || remote !== null) return

    setCheckout((current) => (sameCheckout(current, cloud) ? current : cloud))
    service.track({ checkout: cloud })
  }, [cloud, remote, service])

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
    // A cloud thread with a live serve renders the pushed set; a parked or reaped serve leaves the
    // badge cache's muted last-known reading in its place. Local threads read the local service as
    // they always have.
    if (cloud !== null && remote !== null) {
      const repo = repoStringOf(cloud)
      const fromWire = (key: string): PullRequestReading => {
        const state = remoteStates.find((entry) => `${entry.repo}#${entry.number}` === key)
        if (state !== undefined) return wireReading(state)
        return badges?.peekBadge({ kind: 'linked', repo, number: Number(key.split('#').pop()) }) ?? NO_PULL_REQUEST_READING
      }
      const trackedState = remoteStates.find((entry) => entry.repo === repo && entry.branch === cloud.branch)
      const currentReading =
        trackedState !== undefined
          ? wireReading(trackedState)
          : (badges?.peekBadge({ kind: 'checkout', checkout: cloud }) ?? NO_PULL_REQUEST_READING)
      return pullRequestEntries({
        linked,
        read: fromWire,
        current: checkout === null ? null : { checkout: cloud, reading: currentReading },
      })
    }

    const reading = checkout === null ? null : service.snapshot({ key: checkoutKey(checkout) })
    return pullRequestEntries({
      linked,
      read: (key) => service.snapshot({ key }),
      current: checkout === null || reading === null ? null : { checkout, reading },
    })
  }, [checkout, linked, service, version, cloud, remote, remoteStates, badges])

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
