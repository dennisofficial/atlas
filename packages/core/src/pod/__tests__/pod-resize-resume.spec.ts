import { describe, expect, it } from 'bun:test'

import type { RecordEvent } from '../../record/event'
import {
  initialSessionViewState,
  stepSessionView,
  type SessionViewState,
} from '../../record/views/session-view'
import { eventsOf, NOW, type Op } from '../../record/views/__tests__/support'
import { podBusyFactsOf, type PodBusyFacts } from '../pod-busy'
import { podBusyFactsOfView, podResizeResumeOf, podResizeWentIdle } from '../pod-resize-resume'

const fold = (events: readonly RecordEvent[]): SessionViewState =>
  events.reduce(stepSessionView, initialSessionViewState)

const op = (kind: Op['kind'], a = 0): Op => ({ kind, a, b: 0 })

const factsOf = (over: Partial<PodBusyFacts>): PodBusyFacts => ({
  ...podBusyFactsOf({ state: undefined, shellsRunning: 0, servicesRunning: 0 }),
  ...over,
})

const viewFacts = (ops: readonly Op[]): PodBusyFacts =>
  podBusyFactsOfView({ state: fold(eventsOf(ops)), now: NOW, shellsRunning: 0, servicesRunning: 0 })

describe('podBusyFactsOfView', () => {
  it('reads a foreground bash call in flight from the folded view', () => {
    const facts = viewFacts([
      op('turn-start'),
      op('user'),
      op('assistant-tools'),
      op('dispatched', 2),
    ])

    expect(facts.bashRunning).toBe(true)
  })

  it('reads no bash once its result is in', () => {
    const facts = viewFacts([
      op('turn-start'),
      op('user'),
      op('assistant-tools'),
      op('dispatched', 2),
      op('result', 2),
    ])

    expect(facts.bashRunning).toBe(false)
  })

  it('does not count another tool as bash', () => {
    expect(
      viewFacts([op('turn-start'), op('user'), op('assistant-tools'), op('dispatched', 1)])
        .bashRunning,
    ).toBe(false)
  })

  it('carries the shells and services the plugin views count', () => {
    const facts = podBusyFactsOfView({
      state: initialSessionViewState,
      now: NOW,
      shellsRunning: 2,
      servicesRunning: 1,
    })

    expect(facts).toMatchObject({ shellsRunning: 2, servicesRunning: 1, setupRunning: false })
  })
})

describe('podResizeWentIdle', () => {
  it('fires when the last process a resize waits for ends', () => {
    expect(podResizeWentIdle({ before: factsOf({ shellsRunning: 1 }), after: factsOf({}) })).toBe(
      true,
    )
  })

  it('fires when a foreground bash call ends', () => {
    expect(podResizeWentIdle({ before: factsOf({ bashRunning: true }), after: factsOf({}) })).toBe(
      true,
    )
  })

  it('stays quiet while another process still runs', () => {
    expect(
      podResizeWentIdle({
        before: factsOf({ shellsRunning: 2 }),
        after: factsOf({ shellsRunning: 1 }),
      }),
    ).toBe(false)
  })

  it('stays quiet when the pod was already idle', () => {
    expect(podResizeWentIdle({ before: factsOf({}), after: factsOf({}) })).toBe(false)
  })

  it('ignores an agent turn, which never holds a resize', () => {
    expect(podResizeWentIdle({ before: factsOf({ turnInFlight: true }), after: factsOf({}) })).toBe(
      false,
    )
  })
})

describe('podResizeResumeOf', () => {
  const waiting = { podSizeGeneration: 3, podWaitingSince: '2026-11-25T10:00:00.000Z' }

  it('resumes the waiting generation when the pod went idle', () => {
    expect(podResizeResumeOf({ wentIdle: true, session: waiting })).toEqual({
      generation: 3,
      waitedSince: '2026-11-25T10:00:00.000Z',
    })
  })

  it('resumes nothing when no resize waits', () => {
    expect(
      podResizeResumeOf({ wentIdle: true, session: { ...waiting, podWaitingSince: null } }),
    ).toBeUndefined()
  })

  it('resumes nothing while the pod stays busy', () => {
    expect(podResizeResumeOf({ wentIdle: false, session: waiting })).toBeUndefined()
  })

  it('resumes nothing for a session that is gone', () => {
    expect(podResizeResumeOf({ wentIdle: true, session: undefined })).toBeUndefined()
  })
})
