import { describe, expect, it } from 'bun:test'

import type { PrFoldState } from '../pr-fold-state'
import { EPrSource, EPrState, type PrObservation, type PullSample } from '../pr-observation'
import { applyPrObservation } from '../pr-reducer'

const HEAD = '4b26d3e559172662b7567b8fc9c8992be2062691'

const pullSample = (overrides: Partial<PullSample> = {}): PullSample => ({
  repoFullName: 'dennisofficial/atlas-payload-probe',
  prNumber: 4,
  title: 'probe PR D',
  url: 'https://github.com/dennisofficial/atlas-payload-probe/pull/4',
  state: EPrState.Open,
  headBranch: 'feature-d',
  headSha: HEAD,
  headRepoFullName: 'dennisofficial/atlas-payload-probe',
  baseBranch: 'main',
  pullUpdatedAt: '2026-11-18T21:03:49Z',
  closedAt: null,
  mergedAt: null,
  ...overrides,
})

const stateOf = (sample: PullSample): PrFoldState => ({
  repoFullName: sample.repoFullName,
  prNumber: sample.prNumber,
  pull: { ...sample, source: EPrSource.WebhookPull },
  mergeability: null,
  checks: null,
  version: 0,
})

const mergeabilityOf = (args: {
  baseBranch?: string
  headSha?: string
  mergeable: boolean | null
  observedAt: string
}): PrObservation => ({
  kind: 'mergeability',
  source: EPrSource.Poll,
  observedAt: args.observedAt,
  sample: {
    headSha: args.headSha ?? HEAD,
    baseBranch: args.baseBranch ?? 'main',
    mergeable: args.mergeable,
    mergeClean: args.mergeable === null ? null : args.mergeable,
    observedAt: args.observedAt,
  },
})

const apply = (observation: PrObservation, state: PrFoldState) =>
  applyPrObservation({ observation, state })

describe('mergeability group', () => {
  it('stores a null mergeable sample as unknown rather than dropping the scope', () => {
    const result = apply(
      mergeabilityOf({ mergeable: null, observedAt: '2026-11-18T21:03:50Z' }),
      stateOf(pullSample()),
    )

    expect(result.changed).toEqual(['mergeability'])
    expect(result.state?.mergeability?.mergeable).toBeNull()
    expect(result.uncertainty).toContain('mergeability-unknown')
  })

  it('never lets an unknown sample overwrite a known one', () => {
    const known = apply(
      mergeabilityOf({ mergeable: true, observedAt: '2026-11-18T21:03:50Z' }),
      stateOf(pullSample()),
    ).state
    if (known === null) throw new Error('known mergeability was not stored')
    const result = apply(
      mergeabilityOf({ mergeable: null, observedAt: '2026-11-18T21:03:55Z' }),
      known,
    )

    expect(result.state).toBe(known)
    expect(result.changed).toEqual([])
  })

  it('lets a known sample replace an unknown one whatever its timestamp', () => {
    const unknown = apply(
      mergeabilityOf({ mergeable: null, observedAt: '2026-11-18T21:03:56Z' }),
      stateOf(pullSample()),
    ).state
    if (unknown === null) throw new Error('unknown mergeability was not stored')
    const result = apply(
      mergeabilityOf({ mergeable: true, observedAt: '2026-11-18T21:03:50Z' }),
      unknown,
    )

    expect(result.state?.mergeability?.mergeable).toBe(true)
    expect(result.changed).toEqual(['mergeability'])
  })

  it('keeps the stored sample on an equal observedAt', () => {
    const first = apply(
      mergeabilityOf({ mergeable: true, observedAt: '2026-11-18T21:03:50Z' }),
      stateOf(pullSample()),
    ).state
    if (first === null) throw new Error('mergeability was not stored')
    const result = apply(
      mergeabilityOf({ mergeable: false, observedAt: '2026-11-18T21:03:50Z' }),
      first,
    )

    expect(result.state).toBe(first)
    expect(result.changed).toEqual([])
  })

  it('lets a newer sample replace an older one without claiming a value change', () => {
    const first = apply(
      mergeabilityOf({ mergeable: true, observedAt: '2026-11-18T21:03:50Z' }),
      stateOf(pullSample()),
    ).state
    if (first === null) throw new Error('mergeability was not stored')
    const result = apply(
      mergeabilityOf({ mergeable: true, observedAt: '2026-11-18T21:03:53Z' }),
      first,
    )

    expect(result.changed).toEqual([])
    expect(result.state?.mergeability?.observedAt).toBe('2026-11-18T21:03:53Z')
  })

  it('ignores a sample computed for another head or another base', () => {
    const held = stateOf(pullSample())
    const otherHead = apply(
      mergeabilityOf({ headSha: 'ffffffff', mergeable: true, observedAt: '2026-11-18T21:03:50Z' }),
      held,
    )
    const otherBase = apply(
      mergeabilityOf({ baseBranch: 'alt', mergeable: true, observedAt: '2026-11-18T21:03:50Z' }),
      held,
    )

    expect(otherHead.state).toBe(held)
    expect(otherBase.state).toBe(held)
    expect(otherHead.uncertainty).toContain('mergeability-unknown')
  })

  it('drops the unknown flag once a known sample matches head and base', () => {
    const result = apply(
      mergeabilityOf({ mergeable: true, observedAt: '2026-11-18T21:03:50Z' }),
      stateOf(pullSample()),
    )

    expect(result.uncertainty).not.toContain('mergeability-unknown')
  })
})
