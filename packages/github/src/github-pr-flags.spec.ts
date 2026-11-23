import { describe, expect, it } from 'bun:test'

import { EPrSource, EPrState, type PrFoldState } from '@dltech/atlas-core'
import type { Row } from '@dltech/atlas-db'

import { mergeFlagsOf } from './github-pr-flags'

const stateOf = (state: EPrState): PrFoldState => ({
  repoFullName: 'acme/app',
  prNumber: 1,
  pull: {
    repoFullName: 'acme/app',
    prNumber: 1,
    title: 'Fix it',
    url: 'https://github.com/acme/app/pull/1',
    state,
    headBranch: 'feat',
    headSha: 'b2',
    headRepoFullName: 'acme/app',
    baseBranch: 'main',
    pullUpdatedAt: null,
    closedAt: null,
    mergedAt: null,
    source: EPrSource.WebhookPull,
  },
  mergeability: null,
  checks: null,
  version: 1,
})

const storedOf = (flags: { mergeQueued: boolean; autoMerge: boolean }): Row<'GithubPrState'> =>
  flags as unknown as Row<'GithubPrState'>

describe('mergeFlagsOf', () => {
  it('keeps the flags a webhook wrote across an unrelated fold change', () => {
    expect(
      mergeFlagsOf({
        stored: storedOf({ mergeQueued: true, autoMerge: true }),
        state: stateOf(EPrState.Open),
      }),
    ).toEqual({ mergeQueued: true, autoMerge: true })
  })

  it('starts a freshly stored pull request with both flags off', () => {
    expect(mergeFlagsOf({ stored: null, state: stateOf(EPrState.Open) })).toEqual({
      mergeQueued: false,
      autoMerge: false,
    })
  })

  it('clears both flags once the pull request closes or merges', () => {
    for (const state of [EPrState.Closed, EPrState.Merged]) {
      expect(
        mergeFlagsOf({
          stored: storedOf({ mergeQueued: true, autoMerge: true }),
          state: stateOf(state),
        }),
      ).toEqual({ mergeQueued: false, autoMerge: false })
    }
  })
})
