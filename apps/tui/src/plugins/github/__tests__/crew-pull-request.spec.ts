import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import {
  createPullRequestService,
  EChecksState,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from '@dltech/atlas-harness'

import { crewPullRequestOf } from '../crew-pull-request'

const mate = toThreadId('mate')
const stranger = toThreadId('stranger')

const checkout: RepositoryCheckout = {
  directory: '/work/mate',
  branch: 'mate-work',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'dennisofficial', repo: 'atlas' },
}

const FOUND: PullRequestReading = {
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: 77,
    title: 'a change',
    url: 'https://github.com/dennisofficial/atlas/pull/77',
    state: EPullRequestState.Open,
    checks: EChecksState.Failing,
    tally: { running: 0, passed: 0, failed: 1 },
    mergeable: null,
    comments: [],
    reviews: [],
  },
}

const port = (): PullRequestPort =>
  new (class extends PullRequestPort {
    readonly pushes = true
    async read(): Promise<PullRequestReading> {
      return FOUND
    }
    async readLinked(): Promise<PullRequestReading> {
      return FOUND
    }
  })()

describe('a teammate row reads its own tracked checkout', () => {
  it('resolves the thread to its checkout and the checkout to its badge', async () => {
    const service = createPullRequestService({ pullRequests: port() })
    const reader = {
      service,
      checkoutFor: ({ threadId }: { threadId: typeof mate }) => (threadId === mate ? checkout : null),
    }
    service.track({ checkouts: [checkout] })
    await service.refresh({ checkout, force: true })

    try {
      expect(crewPullRequestOf({ reader, threadId: mate })?.label).toBe('#77')
      expect(crewPullRequestOf({ reader, threadId: mate })?.checks).toBe(EChecksState.Failing)
      expect(crewPullRequestOf({ reader, threadId: stranger })).toBeNull()
    } finally {
      service.dispose()
    }
  })

  it('says nothing until the checkout has a found pull request', () => {
    const service = createPullRequestService({ pullRequests: port() })
    const reader = { service, checkoutFor: () => checkout }

    try {
      expect(crewPullRequestOf({ reader, threadId: mate })).toBeNull()
    } finally {
      service.dispose()
    }
  })
})
