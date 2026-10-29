import type { Event } from '@dltech/atlas-core'

import type { PullRequestsView } from '../../data/use-pull-requests'

export type DetailsInput = {
  title: string | null
  events: readonly Event[]
  branch: string | undefined
  repoPath: string | undefined
  worktreePath: string | undefined
  pullRequests: PullRequestsView
  settingsHref: string | undefined
  onResize: (vcpus: number) => Promise<void>
}

export const EMPTY_DETAILS: DetailsInput = {
  title: null,
  events: [],
  branch: undefined,
  repoPath: undefined,
  worktreePath: undefined,
  pullRequests: {
    rows: [],
    bells: {},
    handleToggle: () => undefined,
  },
  settingsHref: undefined,
  onResize: async () => undefined,
}
