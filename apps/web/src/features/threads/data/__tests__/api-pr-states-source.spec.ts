import { describe, expect, it } from 'bun:test'

import { EGithubPrStatesFrame, type PrStateWire } from '@dltech/atlas-wire/web'

import { subscribeApiPrStates, type ApiPrStatesSubscribe } from '../api-pr-states-source'

describe('subscribeApiPrStates', () => {
  it('accumulates api states by repo and number', () => {
    let push: Parameters<ApiPrStatesSubscribe>[0] | undefined
    const seen: (readonly PrStateWire[])[] = []
    const stop = subscribeApiPrStates({
      subscribe: (handlers) => {
        push = handlers
        return { unsubscribe: () => undefined }
      },
      onStates: (states) => seen.push(states),
    })
    const state = (checksPassed: number) => ({
      type: EGithubPrStatesFrame.PrState as const,
      state: {
        repoFullName: 'o/r',
        prNumber: 760,
        title: 't',
        url: 'u',
        state: 'open',
        headBranch: 'b',
        headSha: 's',
        checksRunning: 0,
        checksPassed,
        checksFailed: 0,
        mergeable: null,
        updatedAt: '',
      },
    })
    push?.onData({ type: EGithubPrStatesFrame.Heartbeat })
    push?.onData(state(1))
    push?.onData(state(2))
    stop()
    expect(seen.map((states) => states.map((s) => s.checksPassed))).toEqual([[1], [2]])
  })
})
