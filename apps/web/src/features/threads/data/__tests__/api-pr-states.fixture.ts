import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '../api-pr-states-source'

export function prStatesSourceRig() {
  const connections: { handlers: Parameters<ApiPrStatesSubscribe>[0]; stops: number }[] = []
  let active = 0
  let peak = 0
  const subscribe: ApiPrStatesSubscribe = (handlers) => {
    active += 1
    peak = Math.max(peak, active)
    const connection = { handlers, stops: 0 }
    connections.push(connection)
    return {
      unsubscribe: () => {
        connection.stops += 1
        active -= 1
      },
    }
  }
  return {
    subscribe,
    connections,
    active: () => active,
    peak: () => peak,
    latest: () => connections.at(-1)?.handlers,
  }
}

export const prStateFrameOf = (checksPassed: number): GithubPrStatesFrame => ({
  type: EGithubPrStatesFrame.PrState,
  state: {
    repoFullName: 'owner/repo',
    prNumber: 1,
    title: 'Live checks',
    url: 'https://github.com/owner/repo/pull/1',
    state: 'open',
    headBranch: 'topic',
    headSha: 'abc',
    checksRunning: 0,
    checksPassed,
    checksFailed: 0,
    mergeable: true,
    version: checksPassed,
    updatedAt: '',
  },
})
