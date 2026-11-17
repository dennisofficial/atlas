import {
  EGithubPrStatesFrame,
  type GithubPrStatesFrame,
  type WireSessionNode,
  type WireThread,
} from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '@/features/threads/data/api-pr-states-source'

import { updatedAt } from './production-sidebar-fixtures'

type StateFrame = Extract<GithubPrStatesFrame, { type: EGithubPrStatesFrame.PrState }>

function fixtureThreadsOf(sessions: readonly WireSessionNode[]): WireThread[] {
  return sessions.flatMap((session) => [session.mainThread, ...fixtureThreadsOf(session.teammates)])
}

function fixtureFramesOf(args: {
  sessions: readonly WireSessionNode[]
  failed: boolean
  version: number
}): StateFrame[] {
  return fixtureThreadsOf(args.sessions).flatMap((thread) =>
    (thread.pullRequests ?? []).map((pr) => {
      const changing = pr.number === 1488 || pr.number === 1602
      const conflicts = pr.number === 1489 || pr.number === 1605
      return {
        type: EGithubPrStatesFrame.PrState,
        state: {
          repoFullName: pr.repo,
          prNumber: pr.number,
          title: pr.title ?? '',
          url: pr.url,
          state: pr.state ?? 'open',
          headBranch: pr.branch,
          headSha: 'storybook-fixture',
          checksRunning: changing && !args.failed ? 1 : 0,
          checksPassed: changing ? 3 : 4,
          checksFailed: (changing && args.failed) || conflicts ? 1 : 0,
          mergeable: !conflicts,
          version: args.version,
          updatedAt,
        },
      }
    }),
  )
}

export function createFixtureSource(sessions: readonly WireSessionNode[]) {
  let failed = false
  let version = 0
  const channels = new Set<(frame: GithubPrStatesFrame) => void>()

  const emit = (onData: (frame: GithubPrStatesFrame) => void) => {
    version += 1
    for (const frame of fixtureFramesOf({ sessions, failed, version })) onData(frame)
  }

  const subscribe: ApiPrStatesSubscribe = ({ onData }) => {
    channels.add(onData)
    emit(onData)
    return {
      unsubscribe: () => {
        channels.delete(onData)
      },
    }
  }

  return {
    subscribe,
    toggle: () => {
      failed = !failed
      for (const onData of channels) emit(onData)
      return failed
    },
  }
}

export type FixtureSource = ReturnType<typeof createFixtureSource>
