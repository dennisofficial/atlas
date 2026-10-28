import { existsSync } from 'node:fs'

import { EPullRequestLookup, type PullRequestEntry } from '@dltech/atlas-harness'

import type { SidebarRowAction, SidebarRowSplit, SidebarSectionRow } from '../../ui/sidebar-section'
import { theme } from '../../ui/theme'
import { pullRequestRow } from './pull-request-row'

export type PullRequestBell = (args: {
  repo: string
  number: number
}) => SidebarRowAction | undefined

export const foundPullRequest = (entry: PullRequestEntry) =>
  entry.reading !== null && entry.reading.lookup === EPullRequestLookup.Found
    ? entry.reading.pullRequest
    : null

const worktreeGone = (entry: PullRequestEntry): boolean =>
  entry.current === false && entry.worktreePath !== undefined && !existsSync(entry.worktreePath)

export const rowOf = (args: {
  entry: PullRequestEntry
  now: number
  onOpen: (url: string) => void
  bell?: PullRequestBell | undefined
}): SidebarSectionRow => {
  const { entry, now, onOpen } = args
  const pullRequest = foundPullRequest(entry)
  const gone = worktreeGone(entry)

  const spans =
    pullRequest !== null
      ? pullRequestRow({ pullRequest, now, gone })
      : (): SidebarRowSplit => ({
          left: [
            { text: `#${entry.number}`, fg: theme.code, strike: gone },
            { text: ` ${entry.branch}`, fg: theme.hint, strike: gone },
          ],
          right: [],
        })

  return {
    id: entry.current ? 'pull-request-current' : `pull-request-${entry.key}`,
    spans,
    onActivate: () => onOpen(entry.url),
    action: args.bell?.({ repo: entry.key.slice(0, entry.key.indexOf('#')), number: entry.number }),
  }
}
