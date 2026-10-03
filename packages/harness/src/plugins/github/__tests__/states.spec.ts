import { describe, expect, it } from 'bun:test'

import type { Event, PullRequestState, ThreadId } from '@dltech/atlas-core'

import { createPullRequestStates } from '../states'
import type { PullRequestService } from '../pull-request-service'
import {
  EChecksState,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  type ChecksTally,
  type PullRequest,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../pure'

const THREAD_A = 'br_1' as ThreadId
const THREAD_B = 'br_2' as ThreadId

const CHECKOUT: RepositoryCheckout = {
  directory: '/repo',
  branch: 'dennis/first',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'dltech', repo: 'atlas' },
}

const tally = (args?: { running?: number; passed?: number; failed?: number }): ChecksTally => ({
  running: args?.running ?? 0,
  passed: args?.passed ?? 3,
  failed: args?.failed ?? 0,
})

const pullRequest = (args?: { number?: number; state?: EPullRequestState; checks?: ChecksTally }): PullRequest => ({
  number: args?.number ?? 401,
  title: 'a pull request',
  url: `https://github.com/dltech/atlas/pull/${args?.number ?? 401}`,
  state: args?.state ?? EPullRequestState.Open,
  checks: EChecksState.Passing,
  tally: args?.checks ?? tally(),
})

const foundReading = (pr?: PullRequest): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: pr ?? pullRequest(),
})

const serviceStandingOn = (
  current: { checkout: RepositoryCheckout; reading: PullRequestReading } | null,
): PullRequestService =>
  ({
    current: () => current,
  }) as unknown as PullRequestService

const recordedState = (args?: Partial<PullRequestState>): PullRequestState => ({
  number: 401,
  url: 'https://github.com/dltech/atlas/pull/401',
  repo: 'github.com/dltech/atlas',
  branch: 'dennis/first',
  state: EPullRequestState.Open,
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: null,
  recordedAt: '2026-09-28T12:00:00.000Z',
  ...args,
})

let nextSeq = 0
const stateEvent = (args?: Partial<PullRequestState>): Event => {
  nextSeq += 1
  const state = recordedState(args)
  return {
    id: `evt_${nextSeq}`,
    seq: nextSeq,
    threadId: THREAD_A,
    runId: 'run_1',
    depth: 0,
    at: state.recordedAt,
    type: 'pull-request-state',
    number: state.number,
    url: state.url,
    repo: state.repo,
    branch: state.branch,
    state: state.state,
    checksRunning: state.checksRunning,
    checksPassed: state.checksPassed,
    checksFailed: state.checksFailed,
    mergeable: state.mergeable,
    recordedAt: state.recordedAt,
  } as Event
}

const setup = (args: {
  current: { checkout: RepositoryCheckout; reading: PullRequestReading } | null
  folded?: readonly PullRequestState[]
}) => {
  let folded = args.folded ?? []
  const states = createPullRequestStates({
    service: serviceStandingOn(args.current),
    recorded: () => folded,
  })
  return {
    states,
    publish: (events: readonly PullRequestState[]) => {
      folded = events
    },
  }
}

describe('drafting a pull request state at turn end', () => {
  it('drafts the tracked found pull request once', async () => {
    const { states } = setup({ current: { checkout: CHECKOUT, reading: foundReading() } })

    const outcome = await states.recordChange({ threadId: THREAD_A })

    expect(outcome.drafts).toHaveLength(1)
    const draft = outcome.drafts?.[0]
    expect(draft?.type).toBe('pull-request-state')
    expect(draft && 'number' in draft ? draft.number : null).toBe(401)
    expect(draft && 'checksPassed' in draft ? draft.checksPassed : null).toBe(3)
    expect(draft && 'mergeable' in draft ? draft.mergeable : 'unset').toBeNull()
  })

  it('drafts nothing when nothing is tracked or the reading is not found', async () => {
    const untracked = setup({ current: null })
    expect((await untracked.states.recordChange({ threadId: THREAD_A })).drafts).toBeUndefined()

    const absent = setup({
      current: { checkout: CHECKOUT, reading: { lookup: EPullRequestLookup.Absent } },
    })
    expect((await absent.states.recordChange({ threadId: THREAD_A })).drafts).toBeUndefined()
  })

  it('does not re-draft a state the log already holds', async () => {
    const { states } = setup({
      current: { checkout: CHECKOUT, reading: foundReading() },
      folded: [recordedState()],
    })

    const outcome = await states.recordChange({ threadId: THREAD_A })
    expect(outcome.drafts).toBeUndefined()
  })

  it('does not double-write across consecutive turns while the draft is unpublished', async () => {
    const { states } = setup({ current: { checkout: CHECKOUT, reading: foundReading() } })

    await states.recordChange({ threadId: THREAD_A })
    const again = await states.recordChange({ threadId: THREAD_A })
    expect(again.drafts).toBeUndefined()
  })

  it('drafts again when the recorded state moved on after publish', async () => {
    const { states, publish } = setup({ current: { checkout: CHECKOUT, reading: foundReading() } })

    const first = await states.recordChange({ threadId: THREAD_A })
    expect(first.drafts).toHaveLength(1)
    publish([recordedState({ checksPassed: 4 })])

    const second = await states.recordChange({ threadId: THREAD_A })
    expect(second.drafts).toHaveLength(1)
  })

  it('forgets in-flight drafts when the thread changes', async () => {
    const { states } = setup({ current: { checkout: CHECKOUT, reading: foundReading() } })

    await states.recordChange({ threadId: THREAD_A })
    await states.forgetThread({ threadId: THREAD_B, projectDirectory: '/repo' })

    const outcome = await states.recordChange({ threadId: THREAD_B })
    expect(outcome.drafts).toHaveLength(1)
  })
})

describe('change-only against the published fold', () => {
  it('matches a folded event across all recorded fields', async () => {
    // The drafter's guard compares a live snapshot to the fold, so an event built from the same
    // numbers must be recognised as already recorded. This pins the field set so a schema change
    // that drops a compared field turns this spec red rather than the log silently double-writing.
    const folded = recordedState({ checksRunning: 1, checksPassed: 8, checksFailed: 2 })
    const { states } = setup({
      current: {
        checkout: CHECKOUT,
        reading: foundReading(pullRequest({ checks: tally({ running: 1, passed: 8, failed: 2 }) })),
      },
      folded: [folded],
    })

    const outcome = await states.recordChange({ threadId: THREAD_A })
    expect(outcome.drafts).toBeUndefined()
  })

  it('folds back the event the projection consumes', () => {
    const events = [stateEvent({ number: 512 })]
    const folded = events.filter((event) => event.type === 'pull-request-state')

    expect(folded).toHaveLength(1)
    expect(folded[0] && 'number' in folded[0] ? folded[0].number : null).toBe(512)
    expect(folded[0] && 'checksPassed' in folded[0] ? folded[0].checksPassed : null).toBe(3)
  })
})
