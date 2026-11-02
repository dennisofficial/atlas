import type { Event } from '@dltech/atlas-core'

import type { PullRequestsView } from '../../data/use-pull-requests'

export type DetailsInput = {
  title: string | null
  events: readonly Event[]
  repoPath: string | undefined
  worktreePath: string | undefined
  pullRequests: PullRequestsView
  settingsHref: string | undefined
  onResize: (vcpus: number) => Promise<void>
}

export const EMPTY_DETAILS: DetailsInput = {
  title: null,
  events: [],
  repoPath: undefined,
  worktreePath: undefined,
  pullRequests: {
    rows: [],
    bells: {},
    handleToggle: () => undefined,
    checkouts: [],
    looseKeys: [],
  },
  settingsHref: undefined,
  onResize: async () => undefined,
}
