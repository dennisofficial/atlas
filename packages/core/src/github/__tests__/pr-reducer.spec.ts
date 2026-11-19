import { describe, expect, it } from 'bun:test'

import { EChecksState } from '../checks'
import type { PrFoldState } from '../pr-fold-state'
import { EPrSource, EPrState, type PrObservation, type PullSample } from '../pr-observation'
import {
  applyPrObservation,
  comparePullSamples,
  foldPrObservations,
  uncertaintyOf,
  withDerivedChecks,
} from '../pr-reducer'

const pullSample = (overrides: Partial<PullSample> = {}): PullSample => ({
  repoFullName: 'dennisofficial/atlas-payload-probe',
  prNumber: 4,
  title: 'probe PR D',
  url: 'https://github.com/dennisofficial/atlas-payload-probe/pull/4',
  state: EPrState.Open,
  headBranch: 'feature-d',
  headSha: '4b26d3e559172662b7567b8fc9c8992be2062691',
  headRepoFullName: 'dennisofficial/atlas-payload-probe',
  baseBranch: 'main',
  pullUpdatedAt: '2026-11-18T21:03:49Z',
  closedAt: null,
  mergedAt: null,
  ...overrides,
})

const pullObservation = (sample: PullSample): PrObservation => ({
  kind: 'pull',
  source: EPrSource.WebhookPull,
  observedAt: '2026-11-18T21:06:00.000Z',
  sample,
})

const mergeabilityObservation = (args: {
  headSha: string
  mergeable: boolean | null
  observedAt: string
}): PrObservation => ({
  kind: 'mergeability',
  source: EPrSource.Poll,
  observedAt: args.observedAt,
  sample: {
    headSha: args.headSha,
    baseBranch: 'main',
    mergeable: args.mergeable,
    mergeClean: args.mergeable === null ? null : args.mergeable,
    observedAt: args.observedAt,
  },
})

const stateOf = (sample: PullSample, extra: Partial<PrFoldState> = {}): PrFoldState => ({
  repoFullName: sample.repoFullName,
  prNumber: sample.prNumber,
  pull: { ...sample, source: EPrSource.WebhookPull },
  mergeability: null,
  checks: null,
  version: 7,
  ...extra,
})

const fold = (observations: readonly PrObservation[], state: PrFoldState | null = null) =>
  foldPrObservations({ observations, state })

describe('comparePullSamples', () => {
  it('orders by updated_at first', () => {
    const older = pullSample({ pullUpdatedAt: '2026-11-18T21:03:43Z' })
    const newer = pullSample({ pullUpdatedAt: '2026-11-18T21:03:49Z' })

    expect(comparePullSamples({ a: older, b: newer })).toBeLessThan(0)
    expect(comparePullSamples({ a: newer, b: older })).toBeGreaterThan(0)
    expect(comparePullSamples({ a: newer, b: newer })).toBe(0)
  })

  it('breaks a same-second tie towards the terminal state', () => {
    const at = '2026-11-18T21:03:49Z'
    const open = pullSample({ state: EPrState.Open, pullUpdatedAt: at })
    const draft = pullSample({ state: EPrState.Draft, pullUpdatedAt: at })
    const closed = pullSample({ state: EPrState.Closed, closedAt: at, pullUpdatedAt: at })
    const merged = pullSample({
      state: EPrState.Merged,
      closedAt: '2026-11-18T21:04:22Z',
      mergedAt: '2026-11-18T21:04:22Z',
      pullUpdatedAt: '2026-11-18T21:04:22Z',
    })

    expect(comparePullSamples({ a: closed, b: draft })).toBeGreaterThan(0)
    expect(comparePullSamples({ a: draft, b: open })).toBeGreaterThan(0)
    expect(comparePullSamples({ a: merged, b: closed })).toBeGreaterThan(0)
    expect(comparePullSamples({ a: open, b: closed })).toBeLessThan(0)
  })

  it('breaks a state tie on closed_at and then on the head sha', () => {
    const at = '2026-11-18T21:03:49Z'
    const withoutClose = pullSample({ state: EPrState.Closed, closedAt: null })
    const withClose = pullSample({ state: EPrState.Closed, closedAt: at })
    const otherHead = pullSample({
      headSha: 'ffffffff',
      state: EPrState.Closed,
      closedAt: at,
    })

    expect(comparePullSamples({ a: withClose, b: withoutClose })).toBeGreaterThan(0)
    expect(comparePullSamples({ a: otherHead, b: withClose })).toBeGreaterThan(0)
  })
})

describe('applyPrObservation', () => {
  it('creates the state from the first pull sample', () => {
    const sample = pullSample({ state: EPrState.Closed, closedAt: '2026-11-18T21:03:49Z' })
    const result = applyPrObservation({ observation: pullObservation(sample), state: null })

    expect(result.changed).toEqual(['pull'])
    expect(result.state?.prNumber).toBe(4)
    expect(result.state?.pull?.source).toBe(EPrSource.WebhookPull)
    expect(result.state?.pull?.state).toBe(EPrState.Closed)
  })

  it('ignores an older sample and reports nothing changed', () => {
    const held = stateOf(pullSample())
    const older = pullSample({ title: 'stale', pullUpdatedAt: '2026-11-18T21:03:43Z' })
    const result = applyPrObservation({ observation: pullObservation(older), state: held })

    expect(result.state).toBe(held)
    expect(result.changed).toEqual([])
  })

  it('treats a replay of the same sample as a no-op', () => {
    const sample = pullSample()
    const held = stateOf(sample)
    const result = applyPrObservation({ observation: pullObservation(sample), state: held })

    expect(result.state?.pull?.title).toBe(sample.title)
    expect(result.changed).toEqual([])
    expect(result.state?.version).toBe(7)
  })

  it('replaces the pull group only when the newer sample keeps the head', () => {
    const held = stateOf(pullSample({ state: EPrState.Closed }), {
      mergeability: {
        headSha: pullSample().headSha,
        baseBranch: 'main',
        mergeable: true,
        mergeClean: true,
        observedAt: '2026-11-18T21:03:50Z',
      },
    })
    const edited = pullSample({
      title: 'probe PR D renamed',
      state: EPrState.Closed,
      pullUpdatedAt: '2026-11-18T21:03:52Z',
    })
    const result = applyPrObservation({ observation: pullObservation(edited), state: held })

    expect(result.changed).toEqual(['pull'])
    expect(result.state?.pull?.title).toBe('probe PR D renamed')
    expect(result.state?.mergeability).toBe(held.mergeability)
  })

  it('clears mergeability and checks when the head moves', () => {
    const held = stateOf(pullSample({ state: EPrState.Open }), {
      mergeability: {
        headSha: pullSample().headSha,
        baseBranch: 'main',
        mergeable: true,
        mergeClean: true,
        observedAt: '2026-11-18T21:03:50Z',
      },
      checks: {
        headSha: pullSample().headSha,
        running: 0,
        passed: 2,
        failed: 0,
        ignored: 0,
        rollup: EChecksState.Passing,
      },
    })
    const pushed = pullSample({
      headSha: '27a153b84e77f1d7d7b4fde94a4a14922cff99c6',
      pullUpdatedAt: '2026-11-18T21:05:28Z',
    })
    const result = applyPrObservation({ observation: pullObservation(pushed), state: held })

    expect(result.changed).toEqual(['pull', 'mergeability', 'checks'])
    expect(result.state?.mergeability).toBeNull()
    expect(result.state?.checks).toBeNull()
  })

  it('ignores a mergeability observation when there is no pull yet', () => {
    const result = applyPrObservation({
      observation: mergeabilityObservation({
        headSha: pullSample().headSha,
        mergeable: true,
        observedAt: '2026-11-18T21:03:50Z',
      }),
      state: null,
    })

    expect(result.state).toBeNull()
    expect(result.changed).toEqual([])
  })
})

describe('withDerivedChecks', () => {
  const held = stateOf(pullSample())

  it('accepts the tally for the current head', () => {
    const result = withDerivedChecks({
      derived: {
        headSha: held.pull?.headSha ?? null,
        running: 1,
        passed: 2,
        failed: 0,
        ignored: 0,
        rollup: EChecksState.Running,
        requiredContexts: ['probe'],
      },
      state: held,
    })

    expect(result.changed).toEqual(['checks'])
    expect(result.state?.checks?.rollup).toBe(EChecksState.Running)
    expect(result.uncertainty).toEqual(['mergeability-unknown'])
  })

  it('clears checks derived for another head', () => {
    const withChecks = withDerivedChecks({
      derived: {
        headSha: held.pull?.headSha ?? null,
        running: 0,
        passed: 1,
        failed: 0,
        ignored: 0,
        rollup: EChecksState.Passing,
        requiredContexts: [],
      },
      state: held,
    }).state
    const stale = withDerivedChecks({
      derived: {
        headSha: 'ffffffff',
        running: 0,
        passed: 1,
        failed: 0,
        ignored: 0,
        rollup: EChecksState.Passing,
        requiredContexts: [],
      },
      state: stateOf(pullSample(), { checks: withChecks?.checks ?? null }),
    })

    expect(stale.state?.checks).toBeNull()
    expect(stale.changed).toEqual(['checks'])
  })
})

describe('uncertaintyOf', () => {
  it('names every absent group on an empty state', () => {
    expect(uncertaintyOf({ state: null })).toEqual([
      'pull-absent',
      'mergeability-unknown',
      'checks-absent',
    ])
  })
})

describe('foldPrObservations', () => {
  it('folds an empty list to the input state', () => {
    expect(fold([], null)).toEqual({
      state: null,
      changed: [],
      uncertainty: ['pull-absent', 'mergeability-unknown', 'checks-absent'],
    })
  })
})
