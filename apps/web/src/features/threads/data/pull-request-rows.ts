import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'

import { checksTallyOf, entryHasConflicts, type ChecksTally } from './header-model'
import {
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
  checks: ChecksTally | undefined
  conflicts: boolean
  via: string | undefined
}

export type PullRequestList = {
  entries: PullRequestEntry[]
  rows: PullRequestRow[]
}

export function pullRequestRowOf(entry: PullRequestEntry): PullRequestRow {
  return {
    key: pullRequestKeyOf(entry),
    label: `#${entry.number}`,
    url: entry.url,
    branch: entry.branch,
    state: entry.state,
    checks: checksTallyOf(entry),
    conflicts: entryHasConflicts(entry),
    via: entry.via === undefined ? undefined : `via ${entry.via.title ?? 'teammate'}`,
  }
}

export function pullRequestListOf(args: {
  thread: WireThread | undefined
  states: readonly PrStateWire[]
}): PullRequestList {
  if (args.thread === undefined) return { entries: [], rows: [] }
  const entries = pullRequestEntriesOf({ thread: args.thread, states: args.states })
  return { entries, rows: entries.map(pullRequestRowOf) }
}
