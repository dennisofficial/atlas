import { describe, expect, it } from 'bun:test'
import { compareCheckAttempts, type CheckIdentity } from '../check-identity'
import { ECheckOutcome } from '../checks'
import type { PrFoldState } from '../pr-fold-state'
import {
  ECheckSource,
  EPrSource,
  EPrState,
  type MergeabilitySample,
  type PullSample,
} from '../pr-observation'
import { comparePullSamples, foldPrObservations, provenanceAdvancedBetween } from '../pr-reducer'

const pull = (over: Partial<PullSample> = {}): PullSample => ({
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: EPrState.Open,
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
  baseBranch: 'main',
  pullUpdatedAt: '2026-11-18T10:00:00Z',
  closedAt: null,
  mergedAt: null,
  ...over,
})

const stateOf = (sample: PullSample): PrFoldState => ({
  repoFullName: sample.repoFullName,
  prNumber: sample.prNumber,
  pull: { ...sample, source: EPrSource.Poll },
  mergeability: null,
  checks: null,
  version: 1,
})

const mergeability = (over: Partial<MergeabilitySample> = {}): MergeabilitySample => ({
  headSha: 'abc123',
  baseBranch: 'main',
  mergeable: true,
  mergeClean: true,
  observedAt: '2026-11-18T10:00:00.000Z',
  ...over,
})

describe('pull sample ordering reads timestamps as instants', () => {
  it('treats a second-precision and a millisecond-precision equal instant as equal', () => {
    const stored = pull({ pullUpdatedAt: '2026-11-18T10:00:00.000Z' })
    const incoming = pull({ pullUpdatedAt: '2026-11-18T10:00:00Z' })

    expect(comparePullSamples({ a: incoming, b: stored })).toBe(0)
  })

  it('keeps the terminal state when a same-second open sample arrives after storage', () => {
    const closed = pull({
      state: EPrState.Closed,
      pullUpdatedAt: '2026-11-18T10:00:00Z',
      closedAt: '2026-11-18T10:00:00Z',
    })
    const stored: PrFoldState = { ...stateOf(closed), version: 2 }
    const opened = {
      kind: 'pull' as const,
      source: EPrSource.WebhookPull,
      observedAt: '2026-11-18T10:00:00Z',
      sample: pull({ pullUpdatedAt: '2026-11-18T10:00:00.000Z' }),
    }

    const folded = foldPrObservations({ state: stored, observations: [opened] })

    expect(folded.changed).toEqual([])
    expect(folded.state?.pull?.state).toBe(EPrState.Closed)
  })

  it('orders a merged and a closed sample of one second by terminal rank', () => {
    const merged = pull({
      state: EPrState.Merged,
      mergedAt: '2026-11-18T10:00:00Z',
      closedAt: '2026-11-18T10:00:00Z',
    })
    const closed = pull({
      state: EPrState.Closed,
      closedAt: '2026-11-18T10:00:00.000Z',
    })

    expect(comparePullSamples({ a: merged, b: closed })).toBe(1)
    expect(comparePullSamples({ a: closed, b: merged })).toBe(-1)
  })

  it('breaks a same-instant tie on title', () => {
    expect(comparePullSamples({ a: pull({ title: 'b' }), b: pull({ title: 'a' }) })).toBe(1)
  })

  it('rejects a mergeability sample whose instant is not newer, whatever its precision', () => {
    const stored = stateOf(pull())
    const held: PrFoldState = { ...stored, mergeability: mergeability() }
    const sample = mergeability({
      mergeable: false,
      mergeClean: false,
      observedAt: '2026-11-18T10:00:00Z',
    })

    const folded = foldPrObservations({
      state: held,
      observations: [
        { kind: 'mergeability', source: EPrSource.Poll, observedAt: sample.observedAt, sample },
      ],
    })

    expect(folded.changed).toEqual([])
    expect(folded.state?.mergeability?.mergeable).toBe(true)
  })
})

describe('provenanceAdvancedBetween', () => {
  it('reports a newer pull watermark on otherwise identical fields', () => {
    const from = stateOf(pull())
    const to = stateOf(pull({ pullUpdatedAt: '2026-11-18T10:00:01Z' }))

    expect(provenanceAdvancedBetween({ from, to })).toBe(true)
  })

  it('reports a newer mergeability observation on identical values', () => {
    const from: PrFoldState = { ...stateOf(pull()), mergeability: mergeability() }
    const to: PrFoldState = {
      ...stateOf(pull()),
      mergeability: mergeability({ observedAt: '2026-11-18T10:00:01Z' }),
    }

    expect(provenanceAdvancedBetween({ from, to })).toBe(true)
  })

  it('reports nothing when the instants match across precisions', () => {
    const from: PrFoldState = { ...stateOf(pull()), mergeability: mergeability() }
    const to: PrFoldState = {
      ...stateOf(pull({ pullUpdatedAt: '2026-11-18T10:00:00.000Z' })),
      mergeability: mergeability({ observedAt: '2026-11-18T10:00:00Z' }),
    }

    expect(provenanceAdvancedBetween({ from, to })).toBe(false)
  })

  it('reports nothing for an absent observed row', () => {
    expect(provenanceAdvancedBetween({ from: null, to: null })).toBe(false)
  })
})

describe('compareCheckAttempts on statuses', () => {
  const status = (over: Partial<CheckIdentity>): CheckIdentity => ({
    appSlug: null,
    checkKey: 'status:probe',
    name: 'probe',
    outcome: ECheckOutcome.Passed,
    source: ECheckSource.Status,
    sourceCreatedAt: '2026-11-18T10:00:00.000Z',
    sourceId: '100',
    ...over,
  })

  it('ranks same-second statuses by id, not by timestamp string', () => {
    const earlier = status({ sourceId: '100' })
    const later = status({ sourceId: '200', sourceCreatedAt: '2026-11-18T10:00:00Z' })

    expect(compareCheckAttempts({ a: later, b: earlier })).toBeGreaterThan(0)
    expect(compareCheckAttempts({ a: earlier, b: later })).toBeLessThan(0)
  })
})
