import { describe, expect, it } from 'bun:test'

import { EPullRequestStateWire, type GithubPrState, type PrStateWire } from '@dltech/atlas-wire/web'

import { threadOf } from '@/features/shell/__tests__/fixtures'

import { mergePrStates, prStateWireOfApi } from '../pr-states-merge'
import { pullRequestListOf } from '../pull-request-rows'

const apiState = (over: Partial<GithubPrState> = {}): GithubPrState => ({
  repoFullName: 'o/r',
  prNumber: 760,
  title: 'fix',
  url: 'https://github.com/o/r/pull/760',
  state: 'open',
  headBranch: 'dennis/fix',
  headSha: 'abc',
  checksRunning: 1,
  checksPassed: 5,
  checksFailed: 2,
  mergeable: true,
  updatedAt: '2026-10-29T00:00:00.000Z',
  ...over,
})

const podState = (over: Partial<PrStateWire> = {}): PrStateWire => ({
  repo: 'o/r',
  number: 760,
  url: 'https://github.com/o/r/pull/760',
  branch: 'dennis/fix',
  state: EPullRequestStateWire.Open,
  checksRunning: 0,
  checksPassed: 9,
  checksFailed: 0,
  mergeable: null,
  ...over,
})

describe('prStateWireOfApi', () => {
  it('maps the api dto onto the pod wire shape', () => {
    expect(prStateWireOfApi(apiState())).toEqual({
      repo: 'o/r',
      number: 760,
      url: 'https://github.com/o/r/pull/760',
      branch: 'dennis/fix',
      state: EPullRequestStateWire.Open,
      checksRunning: 1,
      checksPassed: 5,
      checksFailed: 2,
      mergeable: true,
    })
  })

  it('drops states the wire does not know', () => {
    expect(prStateWireOfApi(apiState({ state: 'weird' }))).toBeUndefined()
  })
})

describe('mergePrStates', () => {
  it('merges a host-prefixed live state with the bare api state of the same pull request', () => {
    const merged = mergePrStates({
      live: [podState({ repo: 'github.com/o/r', checksPassed: 9 })],
      api: [prStateWireOfApi(apiState())].filter((state) => state !== undefined),
    })
    expect(merged).toHaveLength(1)
    expect(merged[0]?.checksPassed).toBe(9)
  })

  it('lets the api fill gaps and the live pod win per key', () => {
    const merged = mergePrStates({
      live: [podState()],
      api: [podState({ checksPassed: 1 }), podState({ number: 761, url: 'u761' })],
    })
    expect(merged.map((state) => [state.number, state.checksPassed])).toEqual([
      [760, 9],
      [761, 9],
    ])
  })
})

describe('parked pod pull request row', () => {
  it('shows a checks tally from api states when the pod reports none', () => {
    const thread = threadOf({
      id: 't',
      pullRequests: [
        {
          number: 760,
          url: 'https://github.com/o/r/pull/760',
          repo: 'o/r',
          branch: 'dennis/fix',
        },
      ],
    })
    const states = mergePrStates({
      live: [],
      api: [podState({ checksFailed: 2 })],
    })
    const list = pullRequestListOf({ thread, states })
    expect(list.rows[0]?.checks).toEqual({ running: 0, passed: 9, failed: 2 })
  })
})
