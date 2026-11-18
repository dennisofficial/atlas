import { describe, expect, it } from 'bun:test'
import { EPrSource, EPrState } from '@dltech/atlas-core'

import {
  mergeabilityObservationOf,
  pullObservationOfRest,
  pullObservationOfWebhook,
} from '../github-pr-observations'

const pull = {
  number: 7,
  title: 'Fold observations',
  html_url: 'https://github.com/acme/api/pull/7',
  state: 'open',
  draft: false,
  merged_at: null,
  mergeable: true,
  mergeable_state: 'clean',
  head: { ref: 'feat', sha: 'sha-1', repo: { full_name: 'dennis/api' } },
  base: { ref: 'main' },
}

const payload = {
  pull_request: {
    number: 7,
    title: 'Fold observations',
    html_url: 'https://github.com/acme/api/pull/7',
    state: 'closed',
    draft: false,
    merged_at: '2026-01-01T00:00:00Z',
    closed_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:01Z',
    mergeable: null,
    mergeable_state: 'unknown',
    base: { ref: 'main', repo: { full_name: 'acme/api' } },
    head: { ref: 'feat', sha: 'sha-1', repo: { full_name: 'dennis/api' } },
  },
}

describe('pull observations', () => {
  it('maps a webhook delivery through the core sample', () => {
    const observation = pullObservationOfWebhook({ payload, observedAt: '2026-01-01T00:00:02Z' })

    expect(observation).toMatchObject({
      kind: 'pull',
      source: EPrSource.WebhookPull,
      sample: { repoFullName: 'acme/api', prNumber: 7, state: EPrState.Merged },
    })
  })

  it('refuses a payload that is not a pull request', () => {
    expect(pullObservationOfWebhook({ payload: {}, observedAt: '2026-01-01T00:00:02Z' })).toBeNull()
  })

  it('maps a REST read with the GitHub clock the sample ranks by', () => {
    const observation = pullObservationOfRest({
      repoFullName: 'acme/api',
      pull,
      updatedAt: '2026-01-01T00:00:03Z',
      observedAt: '2026-01-01T00:00:04Z',
      source: EPrSource.Poll,
    })

    expect(observation.sample).toMatchObject({
      state: EPrState.Open,
      baseBranch: 'main',
      headRepoFullName: 'dennis/api',
      pullUpdatedAt: '2026-01-01T00:00:03Z',
    })
  })

  it('keeps an unsettled mergeable read unknown instead of guessing', () => {
    const observation = mergeabilityObservationOf({
      pull: { ...pull, mergeable: null },
      observedAt: '2026-01-01T00:00:05Z',
      source: EPrSource.Poll,
    })

    expect(observation).toMatchObject({ sample: { mergeable: null, mergeClean: null } })
  })
})
