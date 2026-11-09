import { describe, expect, it } from 'bun:test'

import { EMeterBasis, ESessionStatus } from '@dltech/atlas-core'
import type { SessionViewOutput } from '@dltech/atlas-protocol'

import { checksTallyOf } from '@/features/threads/data/header-model'

import {
  contextOfView,
  pullRequestEntryOf,
  rowPullRequestEntryOf,
  sessionViewModelOf,
} from '../session-view-model'

const sessionViewFixture = {
  at: 413,
  status: { state: ESessionStatus.Thinking, lease: { epoch: 1, holderHostId: 7, live: true } },
  context: null,
  spend: {
    rows: [],
    tally: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      uncachedInputTokens: 0,
      costUsd: null,
    },
  },
  checkouts: { repos: [], primary: null },
  pullRequests: [],
  pluginViews: {},
} satisfies SessionViewOutput

const linked = {
  repo: 'owner/atlas',
  number: 7,
  url: 'https://github.com/owner/atlas/pull/7',
  branch: 'topic',
  state: {
    title: 'Fix it',
    state: 'open',
    headSha: 'abc',
    checks: { running: 2, passed: 3, failed: 0 },
    mergeable: false,
    updatedAt: '2026-11-06T10:00:00.000Z',
  },
}

const viewOf = (overrides: Partial<SessionViewOutput>): SessionViewOutput => ({
  ...sessionViewFixture,
  ...overrides,
})

describe('pullRequestEntryOf', () => {
  it('carries state, checks and mergeability from the server state', () => {
    const entry = pullRequestEntryOf({
      pullRequest: linked,
      primaryBranch: 'topic',
    })
    expect(entry).toMatchObject({
      repo: 'owner/atlas',
      number: 7,
      url: linked.url,
      branch: 'topic',
      state: 'open',
      title: 'Fix it',
      checksRunning: 2,
      checksPassed: 3,
      checksFailed: 0,
      mergeable: false,
      current: true,
    })
    expect(checksTallyOf(entry)).toEqual({ running: 2, passed: 3, failed: 0 })
  })

  it('leaves everything unknown when the server has no state for the pull request', () => {
    const entry = pullRequestEntryOf({
      pullRequest: { ...linked, state: null },
      primaryBranch: undefined,
    })
    expect(entry.state).toBeUndefined()
    expect(entry.checksRunning).toBeUndefined()
    expect(entry.checksPassed).toBeUndefined()
    expect(entry.checksFailed).toBeUndefined()
    expect(entry.mergeable).toBeUndefined()
    expect(entry.current).toBe(false)
  })

  it('marks a pull request on another branch as not current', () => {
    expect(pullRequestEntryOf({ pullRequest: linked, primaryBranch: 'main' }).current).toBe(false)
  })
})

describe('rowPullRequestEntryOf', () => {
  it('maps the row pull request and leaves absent state and checks unknown', () => {
    const entry = rowPullRequestEntryOf({
      repo: 'owner/atlas',
      number: 7,
      url: linked.url,
      state: null,
      checks: null,
    })
    expect(entry.state).toBeUndefined()
    expect(entry.checksRunning).toBeUndefined()
    expect(entry.number).toBe(7)
  })

  it('carries row state and checks', () => {
    const entry = rowPullRequestEntryOf({
      repo: 'owner/atlas',
      number: 7,
      url: linked.url,
      state: 'merged',
      checks: { running: 0, passed: 4, failed: 1 },
    })
    expect(entry).toMatchObject({
      state: 'merged',
      checksPassed: 4,
      checksFailed: 1,
    })
  })
})

describe('contextOfView', () => {
  const meter = {
    used: 1200,
    window: 200000,
    basis: EMeterBasis.Measured,
    measuredThroughSeq: 4,
    estimatedTokens: 0,
  }

  it('is null without a context meter', () => {
    expect(contextOfView(viewOf({ context: null }))).toBeNull()
  })

  it('is null when the model window is unknown', () => {
    expect(contextOfView(viewOf({ context: { ...meter, window: null } }))).toBeNull()
  })

  it('reports used and limit, flagging an estimated basis', () => {
    expect(contextOfView(viewOf({ context: meter }))).toEqual({
      used: 1200,
      limit: 200000,
      estimated: false,
    })
    expect(
      contextOfView(viewOf({ context: { ...meter, basis: EMeterBasis.Estimated } }))?.estimated,
    ).toBe(true)
  })
})

describe('sessionViewModelOf', () => {
  it('is empty without a view', () => {
    expect(sessionViewModelOf(undefined)).toEqual({
      branch: undefined,
      entries: [],
      subscriptions: [],
      shells: { running: 0, awaitingInput: false, labels: [] },
      crew: { running: 0, total: 0 },
      crewRows: [],
      previews: [],
      context: null,
      spend: null,
    })
  })

  it('takes the branch from the primary checkout and the spend tally as served', () => {
    const tally = {
      ...sessionViewFixture.spend.tally,
      inputTokens: 10,
      costUsd: 0.5,
    }
    const model = sessionViewModelOf(
      viewOf({
        checkouts: {
          repos: [],
          primary: { repo: 'owner/atlas', branch: 'topic' },
        },
        pullRequests: [linked],
        spend: { rows: [], tally },
      }),
    )
    expect(model.branch).toBe('topic')
    expect(model.entries.map((entry) => entry.number)).toEqual([7])
    expect(model.spend).toEqual(tally)
  })

  it('has no branch when there is no primary checkout', () => {
    expect(sessionViewModelOf(viewOf({})).branch).toBeUndefined()
  })

  it('lists the active github subscriptions from the plugin view', () => {
    const row = {
      id: 's1',
      provider: 'github.pull-request',
      target: { repo: 'github.com/owner/atlas', number: 31 },
      label: 'owner/atlas#31',
      threadId: 't1',
      createdBy: 'agent',
      status: 'active',
      createdAt: '2026-11-08T10:00:00.000Z',
    }
    const model = sessionViewModelOf(viewOf({ pluginViews: { subscriptions: [row] } }))
    expect(model.subscriptions).toEqual([
      { number: 31, label: 'owner/atlas#31', url: 'https://github.com/owner/atlas/pull/31' },
    ])
  })

  it('rosters the running shells from the plugin view', () => {
    const shell = {
      shellId: 'sh1',
      name: 'dev server',
      command: 'bun run dev',
      status: 'running',
      characters: 0,
      awaitingInput: true,
      changedAt: '2026-11-08T10:00:00.000Z',
    }
    const ended = { ...shell, shellId: 'sh2', name: 'build', status: 'exited' }
    const model = sessionViewModelOf(viewOf({ pluginViews: { shells: [shell, ended] } }))
    expect(model.shells).toEqual({ running: 1, awaitingInput: true, labels: ['dev server'] })
  })

  it('lists the published services from the plugin view as previews', () => {
    const live = {
      serviceId: 'svc1',
      name: 'web',
      command: 'bun run dev',
      port: 4321,
      url: 'https://4321-abc.byatlas.dev',
      status: 'running',
      ready: true,
      changedAt: '2026-11-09T10:00:00.000Z',
    }
    const stopped = { ...live, serviceId: 'svc2', port: 4322, status: 'killed' }
    const model = sessionViewModelOf(viewOf({ pluginViews: { services: [live, stopped] } }))
    expect(model.previews).toEqual([
      { serviceId: 'svc1', label: 'web', port: 4321, url: 'https://4321-abc.byatlas.dev' },
    ])
  })
})
