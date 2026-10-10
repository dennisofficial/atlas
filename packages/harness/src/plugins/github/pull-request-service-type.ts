import type { LinkedPullRequest } from '@dltech/atlas-core'
import type { PrStateWire } from '@dltech/atlas-wire'

import type { PullRequestReading, RepositoryCheckout } from './pure'

export type PullRequestService = {
  snapshot: (args: { key: string }) => PullRequestReading
  version: () => number
  subscribe: (listener: () => void) => () => void
  /** A pushing port's frame, keyed exactly as a polled read would be. Arms no schedule. */
  ingest: (args: { key: string; reading: PullRequestReading }) => void
  /**
   * The whole set of checkouts the session's threads stand on, reconciled: a gained one is read at
   * once, a lost one is forgotten. `visible`, when given, names the one the footer shows; leaving it
   * out keeps the previous choice.
   */
  track: (args: {
    checkouts: readonly RepositoryCheckout[]
    visible?: RepositoryCheckout | null
  }) => void
  setVisible: (args: { checkout: RepositoryCheckout | null }) => void
  tracked: () => readonly RepositoryCheckout[]
  watch: (args: { links: readonly LinkedPullRequest[] }) => void
  /** The visible thread's tracked checkout and what the screen shows for it. */
  current: () => { checkout: RepositoryCheckout; reading: PullRequestReading } | null
  /** Every currently-Found reading the service holds — the channel snapshot a serve broadcasts. */
  states: () => readonly PrStateWire[]
  expectChecks: (args: { checkout: RepositoryCheckout }) => void
  recheck: (args: { checkout: RepositoryCheckout }) => void
  refresh: (args: { checkout: RepositoryCheckout; force?: boolean }) => Promise<void>
  dispose: () => void
}
