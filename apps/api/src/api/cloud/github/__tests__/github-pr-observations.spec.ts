import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
import { EPrSource, EPrState } from '@dltech/atlas-core'
import { GithubSubscribeStateWriter } from '../github-subscribe-state-writer'

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
  updated_at: '2026-01-01T00:00:03Z',
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

    expect(observation?.sample).toMatchObject({
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

describe('a pull the state schema cannot hold', () => {
  const restOf = (args: { pull?: unknown; updatedAt?: unknown }) =>
    pullObservationOfRest({
      repoFullName: 'acme/api',
      pull: (args.pull ?? pull) as typeof pull,
      updatedAt: ('updatedAt' in args ? args.updatedAt : pull.updated_at) as string,
      observedAt: '2026-01-01T00:00:04Z',
      source: EPrSource.Poll,
    })

  it('refuses a REST pull whose updated_at is missing or unparseable', () => {
    expect(restOf({ pull: { ...pull, updated_at: undefined }, updatedAt: undefined })).toBeNull()
    expect(restOf({ updatedAt: 'not-a-date' })).toBeNull()
  })

  it('refuses a REST pull missing the head or base coordinates', () => {
    expect(restOf({ pull: { ...pull, head: { ref: '', sha: '', repo: null } } })).toBeNull()
    expect(restOf({ pull: { ...pull, base: { ref: '' } } })).toBeNull()
    expect(restOf({ pull: { ...pull, html_url: '' } })).toBeNull()
  })

  it('refuses a webhook pull whose updated_at is missing', () => {
    const payload = {
      pull_request: {
        number: 7,
        title: 'Fold observations',
        html_url: 'https://github.com/acme/api/pull/7',
        state: 'open',
        draft: false,
        merged_at: null,
        closed_at: null,
        mergeable: null,
        mergeable_state: 'unknown',
        base: { ref: 'main', repo: { full_name: 'acme/api' } },
        head: { ref: 'feat', sha: 'sha-1', repo: { full_name: 'dennis/api' } },
      },
      repository: { full_name: 'acme/api' },
    }

    expect(pullObservationOfWebhook({ payload, observedAt: '2026-01-01T00:00:04Z' })).toBeNull()
  })
})

describe('a producer holding an incomplete pull', () => {
  useTestDatabase()

  it('skips the observation instead of applying an invalid date', async () => {
    const apply = vi.fn()
    const writer = new GithubSubscribeStateWriter({
      prs: {
        readPullRequestObservation: async () => ({
          pull: { ...pull, updated_at: undefined },
          mergeability: {
            headSha: 'sha-1',
            baseBranch: 'main',
            mergeable: null,
            mergeClean: null,
            observedAt: '2026-01-01T00:00:04Z',
          },
        }),
      } as never,
      store: { apply } as never,
    })

    const result = await writer.pullOnSubscribe({
      userId: 'usr-a',
      token: 'ghu_a',
      owner: 'acme',
      repo: 'api',
      repoFullName: 'acme/api',
      prNumber: 7,
      covered: false,
    })

    expect(result).toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })
})
