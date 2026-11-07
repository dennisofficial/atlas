import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { pullRequestsOf } from '../../../workspace/pull-requests'
import { normalizedPrRepo } from '../../../github/pr-repo'
import { contextMeterOf, EMeterBasis, type ContextMeter } from '../../context-meter'
import type { V2Event } from '../../event'
import { sessionStatusOf } from '../../session-status'
import { visibleEvents } from '../../visibility'
import {
  initialSessionViewState,
  needsRebuild,
  rebuildEditSensitive,
  sessionViewOf,
  stepSessionView,
  type SessionViewState,
} from '../session-view'
import { eventsOf, NOW, opsWithEdits, opsWithoutEdits, type Op } from './support'

const fold = (events: readonly V2Event[]): SessionViewState =>
  events.reduce(stepSessionView, initialSessionViewState)

const foldWithRebuilds = (events: readonly V2Event[]): SessionViewState => {
  let state = initialSessionViewState
  events.forEach((event, index) => {
    state = stepSessionView(state, event)
    if (!needsRebuild(event)) return
    state = rebuildEditSensitive({
      state,
      visibleTail: visibleEvents(events.slice(0, index + 1)),
    })
  })
  return state
}

const inputs = fc.record({
  live: fc.boolean(),
  unconsumedInbox: fc.boolean(),
  messageAfterFailure: fc.constantFrom(undefined, true, false),
})

const expectContext = (actual: ContextMeter | null, oracle: ContextMeter): void => {
  if (actual === null) {
    expect(oracle.basis).toBe(EMeterBasis.Estimated)
    expect(oracle.estimatedTokens).toBe(0)
    expect(oracle.window).toBeNull()
    return
  }
  expect(actual).toEqual(oracle)
}

const spendOracle = (events: readonly V2Event[]) => {
  const rows = new Map<
    string,
    {
      providerId: string
      modelId: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
    }
  >()
  for (const event of events) {
    if (event.type !== 'assistant-said' && event.type !== 'tool-called') continue
    const usage = event.usage
    if (usage === undefined) continue
    const providerId = usage.providerId ?? 'unknown'
    const modelId = usage.modelId ?? 'unknown'
    const key = `${providerId}/${modelId}`
    const row = rows.get(key) ?? {
      providerId,
      modelId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    row.inputTokens += usage.inputTokens
    row.outputTokens += usage.outputTokens
    row.cacheReadTokens += usage.cacheReadTokens ?? 0
    row.cacheWriteTokens += usage.cacheWriteTokens ?? 0
    rows.set(key, row)
  }
  return [...rows.values()]
}

const linksOracle = (events: readonly V2Event[]) =>
  pullRequestsOf(events).map((link) => ({
    repo: normalizedPrRepo(link.repo),
    number: link.number,
    url: link.url,
    branch: link.branch,
  }))

describe('session view fold against the whole-log oracles', () => {
  it('equals every oracle over logs with history edits', () => {
    fc.assert(
      fc.property(opsWithEdits, inputs, (ops, live) => {
        const events = eventsOf(ops)
        const view = sessionViewOf({ state: foldWithRebuilds(events), now: NOW, ...live })
        expect(view.status).toEqual(
          sessionStatusOf({ events: visibleEvents(events), now: NOW, ...live }),
        )
        expectContext(view.context, contextMeterOf(events))
        expect(view.pullRequests).toEqual(linksOracle(events))
        expect(view.spend).toEqual(spendOracle(events))
      }),
      { numRuns: 300 },
    )
  })

  it('equals every oracle over logs without history edits', () => {
    fc.assert(
      fc.property(opsWithoutEdits, inputs, (ops, live) => {
        const events = eventsOf(ops)
        const view = sessionViewOf({ state: fold(events), now: NOW, ...live })
        expect(view.status).toEqual(sessionStatusOf({ events, now: NOW, ...live }))
        expectContext(view.context, contextMeterOf(events))
      }),
      { numRuns: 300 },
    )
  })

  it('reads no meter between an edit and its rebuild, and keeps world facts', () => {
    fc.assert(
      fc.property(opsWithEdits, inputs, (ops, live) => {
        const events = eventsOf(ops)
        const folded = fold(events)
        const view = sessionViewOf({ state: folded, now: NOW, ...live })
        const rebuilt = sessionViewOf({ state: foldWithRebuilds(events), now: NOW, ...live })
        if (events.some(needsRebuild)) {
          const lastEdit = events.findLastIndex(needsRebuild)
          const stale = fold(events.slice(0, lastEdit + 1))
          expect(sessionViewOf({ state: stale, now: NOW, ...live }).context).toBeNull()
        }
        expect(rebuilt.spend).toEqual(view.spend)
        expect(rebuilt.checkouts).toEqual(view.checkouts)
        expect(rebuilt.pullRequests).toEqual(view.pullRequests)
      }),
      { numRuns: 200 },
    )
  })

  it('round-trips through JSON and keeps folding identically', () => {
    fc.assert(
      fc.property(opsWithEdits, opsWithEdits, (head, tail) => {
        const events = eventsOf([...head, ...tail])
        const split = eventsOf(head).length
        const state = foldWithRebuilds(events.slice(0, split))
        const restored: SessionViewState = JSON.parse(JSON.stringify(state))
        const args = { live: true, unconsumedInbox: false, messageAfterFailure: false, now: NOW }
        expect(sessionViewOf({ state: restored, ...args })).toEqual(
          sessionViewOf({ state, ...args }),
        )
        const rest = events.slice(split)
        expect(sessionViewOf({ state: rest.reduce(stepSessionView, restored), ...args })).toEqual(
          sessionViewOf({ state: rest.reduce(stepSessionView, state), ...args }),
        )
      }),
      { numRuns: 100 },
    )
  })
})

describe('history edits', () => {
  const ops: Op[] = [
    { kind: 'user', a: 1, b: 1 },
    { kind: 'assistant-usage', a: 40, b: 30 },
    { kind: 'rewind', a: 0, b: 0 },
  ]

  it('leaves spend unchanged by a rewind to seq 0 while the meter drops', () => {
    const events = eventsOf(ops)
    const args = { live: true, unconsumedInbox: false, messageAfterFailure: false, now: NOW }
    const before = sessionViewOf({ state: foldWithRebuilds(events.slice(0, 2)), ...args })
    const after = sessionViewOf({ state: foldWithRebuilds(events), ...args })
    expect(after.spend).toEqual(before.spend)
    expect(after.spend).not.toEqual([])
    expect(before.context?.basis).toBe(EMeterBasis.Measured)
    expect(after.context?.used ?? 0).toBeLessThan(before.context?.used ?? 0)
  })

  it('flags only rewinds and summaries for rebuild', () => {
    const events = eventsOf([
      { kind: 'user', a: 1, b: 1 },
      { kind: 'user', a: 1, b: 1 },
      { kind: 'rewind', a: 0, b: 0 },
      { kind: 'summarise', a: 0, b: 0 },
    ])
    expect(events.map(needsRebuild)).toEqual([false, false, true, true])
  })
})

describe('context meter nullability', () => {
  it('is null with no reading and nothing to estimate', () => {
    const view = sessionViewOf({
      state: initialSessionViewState,
      live: true,
      unconsumedInbox: false,
      messageAfterFailure: false,
      now: NOW,
    })
    expect(view.context).toBeNull()
  })
})

describe('state size', () => {
  it('stays under 16 KB after 20k events', () => {
    const kinds = [
      'user',
      'assistant-usage',
      'tool-called',
      'dispatched',
      'result',
      'retry',
    ] as const
    const ops: Op[] = Array.from({ length: 20_000 }, (_, index) => ({
      kind: kinds[index % kinds.length] ?? 'user',
      a: index % 100,
      b: (index * 7) % 100,
    }))
    const state = fold(eventsOf(ops))
    expect(JSON.stringify(state).length).toBeLessThan(16_000)
  })
})

describe('fold performance', () => {
  it('folds 20k events within 200ms', () => {
    const kinds = ['user', 'assistant-usage', 'tool-called', 'dispatched', 'result'] as const
    const ops: Op[] = Array.from({ length: 20_000 }, (_, index) => ({
      kind: kinds[index % kinds.length] ?? 'user',
      a: index % 100,
      b: (index * 7) % 100,
    }))
    const events = eventsOf(ops)
    const started = performance.now()
    fold(events)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
