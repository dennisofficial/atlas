import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'

import { checksLabelOf, entryHasConflicts } from './header-model'
import {
  pinnedPullRequestOf,
  pullRequestEntriesOf,
  pullRequestKeyOf,
  type PullRequestEntry,
} from './pull-request-entries'

export type PullRequestRow = {
  key: string
  label: string
  url: string
  branch: string
  state: string | undefined
  checksLabel: string | undefined
  failing: boolean
  conflicts: boolean
}

export type PullRequestList = {
  entries: PullRequestEntry[]
  rows: PullRequestRow[]
  pinnedKey: string | undefined
}

export function pullRequestRowOf(entry: PullRequestEntry): PullRequestRow {
  const checksLabel = checksLabelOf(entry)
  return {
    key: pullRequestKeyOf(entry),
    label: `#${entry.number}`,
    url: entry.url,
    branch: entry.branch,
    state: entry.state,
    checksLabel,
    failing: checksLabel !== undefined && (entry.checksFailed ?? 0) > 0,
    conflicts: entryHasConflicts(entry),
  }
}

export function pullRequestListOf(args: {
  thread: WireThread | undefined
  states: readonly PrStateWire[]
}): PullRequestList {
  if (args.thread === undefined) return { entries: [], rows: [], pinnedKey: undefined }
  const entries = pullRequestEntriesOf({ thread: args.thread, states: args.states })
  const pinned = pinnedPullRequestOf(entries)
  return {
    entries,
    rows: entries.map(pullRequestRowOf),
    pinnedKey: pinned === undefined ? undefined : pullRequestKeyOf(pinned),
  }
}
