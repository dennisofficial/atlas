'use client'

import { useMemo } from 'react'

import type { Event } from '@dltech/atlas-core'
import type { WireThread } from '@dltech/atlas-wire/web'

import type { DetailsInput } from '../panel/details/details-input'
import { branchOf, sandboxSettingsHrefOf } from './header-model'
import type { PullRequestsView } from './use-pull-requests'

export function useDetailsInput(args: {
  thread: WireThread | undefined
  events: readonly Event[]
  pullRequests: PullRequestsView
  onResize: (vcpus: number) => Promise<void>
}): DetailsInput {
  const { thread, events, pullRequests, onResize } = args
  return useMemo(
    () => ({
      title: thread?.title ?? null,
      events,
      branch: branchOf(thread),
      repoPath: thread?.repo ?? undefined,
      worktreePath: thread?.worktree?.path,
      pullRequests,
      settingsHref: sandboxSettingsHrefOf(thread),
      onResize,
    }),
    [thread, events, pullRequests, onResize],
  )
}
