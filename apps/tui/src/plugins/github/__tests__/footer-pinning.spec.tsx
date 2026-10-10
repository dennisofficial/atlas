import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import type { LinkedPullRequest } from '@dltech/atlas-core'
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

import { settle, teardown } from '../../../ui/markdown/__tests__/harness'
import { usePullRequest, type PullRequestControl } from '../use-pull-request'

const RENDER_MS = 60

const checkoutOn = (args: { directory: string; branch: string }): RepositoryCheckout => ({
  ...args,
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'dennisofficial', repo: 'atlas' },
})

const foundAs = (number: number): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number,
    title: 'a change',
    url: `https://github.com/dennisofficial/atlas/pull/${number}`,
    state: EPullRequestState.Open,
    checks: EChecksState.Passing,
    tally: { running: 0, passed: 1, failed: 0 },
    mergeable: null,
    comments: [],
    reviews: [],
  },
})

const linkOf = (args: { number: number; branch: string }): LinkedPullRequest => ({
  number: args.number,
  url: `https://github.com/dennisofficial/atlas/pull/${args.number}`,
  repo: 'github.com/dennisofficial/atlas',
  branch: args.branch,
})

const byBranch = (answers: Record<string, PullRequestReading>): PullRequestPort =>
  new (class extends PullRequestPort {
    readonly pushes = true
    async read(args: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
      return answers[args.checkout.branch] ?? { lookup: EPullRequestLookup.Absent }
    }
    async readLinked(): Promise<PullRequestReading> {
      return { lookup: EPullRequestLookup.Absent }
    }
  })()

type Probe = { control: PullRequestControl | null }

describe('the footer chip with a teammate on another checkout', () => {
  it('stays on the visible thread even when the teammate holds the newest pull request', async () => {
    const mine = checkoutOn({ directory: '/work/main', branch: 'main-work' })
    const theirs = checkoutOn({ directory: '/work/mate', branch: 'mate-work' })
    const service = createPullRequestService({
      pullRequests: byBranch({ 'main-work': foundAs(10), 'mate-work': foundAs(20) }),
    })
    service.track({ checkouts: [mine, theirs], visible: mine })

    const probe: Probe = { control: null }
    function Watcher(): React.ReactNode {
      probe.control = usePullRequest({
        service,
        projectDirectory: mine.directory,
        working: false,
        linked: [
          linkOf({ number: 10, branch: 'main-work' }),
          linkOf({ number: 20, branch: 'mate-work' }),
        ],
        cloud: null,
        onOpen: () => undefined,
        probe: async () => mine,
      })
      return <text>{probe.control.footer?.label ?? 'none'}</text>
    }

    const setup = await testRender(<Watcher />, { width: 40, height: 3 })
    try {
      await act(async () => {
        await settle(RENDER_MS)
      })
      await setup.flush()

      expect(probe.control?.footer?.label).toBe('#10')
      expect(probe.control?.footer?.overflow).toBe(1)
      expect(probe.control?.section?.rows.map((row) => row.id)).toEqual([
        'branch',
        'pull-request-current',
        'pull-request-github.com/dennisofficial/atlas#20',
      ])
    } finally {
      await teardown(setup)
      service.dispose()
    }
  })
})
