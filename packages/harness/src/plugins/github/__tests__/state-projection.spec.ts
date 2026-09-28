import { describe, expect, it } from 'bun:test'

import type { Event, ThreadId } from '@dltech/atlas-core'

import { createPullRequestStateProjection } from '../state-projection'

let nextSeq = 0

const THREAD_A = 'br_1' as ThreadId

const stateEvent = (args: { number: number; checksPassed: number; repo?: string }): Event => {
  nextSeq += 1
  return {
    id: `evt_${nextSeq}`,
    seq: nextSeq,
    threadId: THREAD_A,
    runId: 'run_1',
    depth: 0,
    at: '2026-09-28T12:00:00.000Z',
    type: 'pull-request-state',
    number: args.number,
    url: `https://github.com/dltech/atlas/pull/${args.number}`,
    repo: args.repo ?? 'github.com/dltech/atlas',
    branch: 'dennis/first',
    state: 'open',
    checksRunning: 1,
    checksPassed: args.checksPassed,
    checksFailed: 0,
    mergeable: null,
    recordedAt: '2026-09-28T12:00:00.000Z',
  } as Event
}

describe('the pull request state projection', () => {
  it('is empty until a state is published', () => {
    const projection = createPullRequestStateProjection()

    expect(projection.current()).toEqual([])
  })

  it('folds the published events oldest first', () => {
    const projection = createPullRequestStateProjection()

    projection.publish({
      events: [stateEvent({ number: 401, checksPassed: 5 }), stateEvent({ number: 412, checksPassed: 3 })],
    })

    expect(projection.current().map((pr) => pr.number)).toEqual([401, 412])
  })

  it('keeps only the latest state per pull request', () => {
    const projection = createPullRequestStateProjection()

    projection.publish({
      events: [stateEvent({ number: 401, checksPassed: 5 }), stateEvent({ number: 401, checksPassed: 8 })],
    })

    expect(projection.current()).toHaveLength(1)
    expect(projection.current()[0]?.checksPassed).toBe(8)
  })

  it('keeps the same reference when a republish changes nothing', () => {
    const projection = createPullRequestStateProjection()
    const events = [stateEvent({ number: 401, checksPassed: 5 })]

    projection.publish({ events })
    const first = projection.current()

    let bumped = 0
    projection.subscribe(() => {
      bumped += 1
    })
    projection.publish({ events: [...events] })

    expect(projection.current()).toBe(first)
    expect(bumped).toBe(0)
  })

  it('publishes a fresh reference when a state actually changes', () => {
    const projection = createPullRequestStateProjection()

    projection.publish({ events: [stateEvent({ number: 401, checksPassed: 5 })] })
    const first = projection.current()

    let bumped = 0
    projection.subscribe(() => {
      bumped += 1
    })
    projection.publish({
      events: [stateEvent({ number: 401, checksPassed: 5 }), stateEvent({ number: 401, checksPassed: 8 })],
    })

    expect(projection.current()).not.toBe(first)
    expect(bumped).toBe(1)
  })
})
