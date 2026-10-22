import { describe, expect, it } from 'bun:test'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { createFamilyTracker } from '../family-tracker'
import {
  checkoutKey,
  EChecksState,
  EPullRequestLookup,
  EPullRequestState,
  type PullRequest,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../pure'
import type { PullRequestService } from '../pull-request-service'
import { createPullRequestTransitions } from '../pr-transitions'
import type { ThreadKinds } from '../thread-kinds'

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
    headSha: 'abc123',
    state: EPullRequestState.Open,
    checks: EChecksState.Running,
    tally: { running: 2, passed: 1, failed: 0 },
    mergeable: null,
    comments: [],
    reviews: [],
    ...over,
  },
})

const THREAD_A = toThreadId('thread-a')
const THREAD_B = toThreadId('thread-b')

const mateCheckout: RepositoryCheckout = { ...checkout, directory: '/mate', branch: 'mate' }

const harness = (args: { owners?: ReadonlyMap<ThreadId, ThreadId> } = {}) => {
  let listener: (() => void) | null = null
  const readings = new Map<string, PullRequestReading>()
  const held = new Map<string, RepositoryCheckout>()

  const service = {
    subscribe: (l: () => void) => {
      listener = l
      return () => {
        listener = null
      }
    },
    tracked: () => [...held.values()],
    snapshot: ({ key }: { key: string }) => readings.get(key),
  } as unknown as PullRequestService
  const owners = args.owners
  const threadKinds: ThreadKinds = {
    ownerOf: async ({ threadId }) => owners?.get(threadId) ?? threadId,
  }
  const tracker = createFamilyTracker({
    service: { track: () => undefined } as unknown as PullRequestService,
    threadKinds,
  })
  tracker.place({ threadId: THREAD_A, checkout })
  tracker.place({ threadId: THREAD_B, checkout: mateCheckout })

  return {
    transitions: createPullRequestTransitions({ service, tracker }),
    trackerPlace: tracker.place,
    push: (reading: PullRequestReading, on: RepositoryCheckout = checkout) => {
      held.set(checkoutKey(on), on)
      readings.set(checkoutKey(on), reading)
      listener?.()
    },
    clear: () => {
      held.clear()
      readings.clear()
      listener?.()
    },
  }
}

const beforeTurn = (threadId: ThreadId) => ({ threadId, projectDirectory: '/repo' })

describe('createPullRequestTransitions', () => {
  it('buffers a transition and drains it into beforeTurn context', async () => {
    const h = harness()
    h.push(found())
    h.push(found({ tally: { running: 0, passed: 0, failed: 1 }, checks: EChecksState.Failing }))

    const outcome = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    expect(outcome.additionalContext).toContain('PR #7')
    expect(outcome.additionalContext).toContain('failing')
  })

  it('names the tip on a settled checks label', async () => {
    const h = harness()
    h.push(found({ headSha: '0123456789abcdef' }))
    h.push(
      found({
        headSha: '0123456789abcdef',
        tally: { running: 0, passed: 3, failed: 0 },
        checks: EChecksState.Passing,
      }),
    )
    h.push(
      found({
        headSha: '0123456789abcdef',
        tally: { running: 0, passed: 2, failed: 1 },
        checks: EChecksState.Failing,
      }),
    )

    const outcome = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    expect(outcome.additionalContext).toContain('checks passing on 0123456\n')
    expect(outcome.additionalContext).toContain('checks failing (1 failed) on 0123456')
  })

  it('announces the same settled checks again when the tip moves', async () => {
    const h = harness()
    const passing = { tally: { running: 0, passed: 3, failed: 0 }, checks: EChecksState.Passing }
    h.push(found({ ...passing, headSha: 'aaaaaaa1' }))
    h.push(found({ ...passing, headSha: 'bbbbbbb2' }))

    const outcome = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    expect(outcome.additionalContext).toContain('checks passing on bbbbbbb')
  })

  it('leaves the tip off a running label and off an empty sha', async () => {
    const h = harness()
    h.push(found({ headSha: '' }))
    h.push(
      found({
        headSha: '',
        tally: { running: 0, passed: 3, failed: 0 },
        checks: EChecksState.Passing,
      }),
    )
    h.push(
      found({
        headSha: 'cccccc77',
        tally: { running: 1, passed: 3, failed: 0 },
        checks: EChecksState.Running,
      }),
    )

    const outcome = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    expect(outcome.additionalContext).toContain('checks passing\n')
    expect(outcome.additionalContext).not.toContain('running, 3 passed) on')
  })

  it('repeats a steady reading never', async () => {
    const h = harness()
    h.push(found())
    h.push(found())
    h.push(found())

    const outcome = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    expect(outcome.additionalContext).toBeUndefined()
  })

  it('does not seed on a fresh checkout, only on later transitions', async () => {
    const h = harness()
    h.push(found())

    const first = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    expect(first.additionalContext).toBeUndefined()
  })

  it('empties the buffer once drained', async () => {
    const h = harness()
    h.push(found())
    h.push(found({ state: EPullRequestState.Merged, checks: EChecksState.None }))

    await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    const second = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    expect(second.additionalContext).toBeUndefined()
  })

  it('hands a transition only to the thread standing on that checkout', async () => {
    const h = harness()
    h.push(found(), mateCheckout)
    h.push(
      found({ checks: EChecksState.Failing, tally: { running: 0, passed: 0, failed: 2 } }),
      mateCheckout,
    )

    const main = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    const mate = await h.transitions.beforeTurn(beforeTurn(THREAD_B))

    expect(main.additionalContext).toBeUndefined()
    expect(mate.additionalContext).toContain('failing')
  })

  it('diffs each tracked checkout independently', async () => {
    const h = harness()
    h.push(found())
    h.push(found(), mateCheckout)
    h.push(found({ checks: EChecksState.Failing, tally: { running: 0, passed: 0, failed: 1 } }))

    expect((await h.transitions.beforeTurn(beforeTurn(THREAD_A))).additionalContext).toContain(
      'failing',
    )
    expect((await h.transitions.beforeTurn(beforeTurn(THREAD_B))).additionalContext).toBeUndefined()
  })

  it('buffers a subagent’s transition under its owner and drains it on the owner’s turn', async () => {
    const subagent = toThreadId('subagent-a')
    const h = harness({ owners: new Map([[subagent, THREAD_A]]) })
    h.trackerPlace({ threadId: subagent, checkout })
    h.push(found())
    h.push(found({ checks: EChecksState.Failing, tally: { running: 0, passed: 0, failed: 1 } }))

    const sub = await h.transitions.beforeTurn(beforeTurn(subagent))
    expect(sub.additionalContext).toBeUndefined()

    const main = await h.transitions.beforeTurn(beforeTurn(THREAD_A))
    expect(main.additionalContext).toContain('failing')
  })

  it('a subagent’s turn after its owner drained finds nothing', async () => {
    const subagent = toThreadId('subagent-b')
    const h = harness({ owners: new Map([[subagent, THREAD_A]]) })
    h.trackerPlace({ threadId: subagent, checkout })
    h.push(found())
    h.push(found({ state: EPullRequestState.Merged, checks: EChecksState.None }))

    await h.transitions.beforeTurn(beforeTurn(THREAD_A))

    const sub = await h.transitions.beforeTurn(beforeTurn(subagent))
    expect(sub.additionalContext).toBeUndefined()
  })
})
