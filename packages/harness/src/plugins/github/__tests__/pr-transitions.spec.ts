import { describe, expect, it } from 'bun:test'

import {
  EChecksState,
  EPullRequestLookup,
  EPullRequestState,
  type PullRequest,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../pure'
import type { PullRequestService } from '../pull-request-service'
import { createPullRequestTransitions } from '../pr-transitions'

const checkout: RepositoryCheckout = {
  directory: '/repo',
  branch: 'feature',
  forge: 0 as never,
  remote: { host: 'github.com', owner: 'owner', repo: 'repo' },
}

const found = (over: Partial<PullRequest> = {}): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: 7,
    title: 'A thing',
    url: 'https://github.com/owner/repo/pull/7',
    state: EPullRequestState.Open,
    checks: EChecksState.Running,
    tally: { running: 2, passed: 1, failed: 0 },
    ...over,
  },
})

const harness = () => {
  let listener: (() => void) | null = null
  let current: { checkout: RepositoryCheckout; reading: PullRequestReading } | null = null

  const service = {
    subscribe: (l: () => void) => {
      listener = l
      return () => {
        listener = null
      }
    },
    current: () => current,
  } as unknown as PullRequestService

  return {
    transitions: createPullRequestTransitions({ service }),
    push: (reading: PullRequestReading) => {
      current = { checkout, reading }
      listener?.()
    },
    clear: () => {
      current = null
      listener?.()
    },
  }
}

describe('createPullRequestTransitions', () => {
  it('buffers a transition and drains it into beforeTurn context', async () => {
    const h = harness()
    h.push(found())
    h.push(found({ tally: { running: 0, passed: 0, failed: 1 }, checks: EChecksState.Failing }))

    const outcome = await h.transitions.beforeTurn({} as never)
    expect(outcome.additionalContext).toContain('PR #7')
    expect(outcome.additionalContext).toContain('failing')
  })

  it('repeats a steady reading never', async () => {
    const h = harness()
    h.push(found())
    h.push(found())
    h.push(found())

    const outcome = await h.transitions.beforeTurn({} as never)
    expect(outcome.additionalContext).toBeUndefined()
  })

  it('does not seed on a fresh checkout, only on later transitions', async () => {
    const h = harness()
    h.push(found())

    const first = await h.transitions.beforeTurn({} as never)
    expect(first.additionalContext).toBeUndefined()
  })

  it('empties the buffer once drained', async () => {
    const h = harness()
    h.push(found())
    h.push(found({ state: EPullRequestState.Merged, checks: EChecksState.None }))

    await h.transitions.beforeTurn({} as never)
    const second = await h.transitions.beforeTurn({} as never)
    expect(second.additionalContext).toBeUndefined()
  })
})
