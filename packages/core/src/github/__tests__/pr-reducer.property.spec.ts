import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EChecksState } from '../checks'
import type { PrFoldResult } from '../pr-fold-state'

type FoldState = PrFoldResult['state']
import {
  ECheckSource,
  EPrSource,
  EPrState,
  pullSampleOfPayload,
  type PrObservation,
  type PullSample,
} from '../pr-observation'
import {
  checksIdentityOf,
  comparePullSamples,
  derivedChecksOf,
  foldPrObservations,
} from '../pr-reducer'

const payloadDir = fileURLToPath(
  new URL('../../../../../apps/api/src/api/cloud/github/__fixtures__/payloads/', import.meta.url),
)

const CLOSED_HEAD = '4b26d3e559172662b7567b8fc9c8992be2062691'
const PUSHED_HEAD = '27a153b84e77f1d7d7b4fde94a4a14922cff99c6'

function payloadOf(name: string): unknown {
  return JSON.parse(readFileSync(join(payloadDir, name), 'utf8'))
}

function pullSampleOf(name: string): PullSample {
  const sample = pullSampleOfPayload(payloadOf(name))
  if (sample === null) throw new Error(`fixture ${name} did not map to a pull sample`)

  return sample
}

const pullObservationOf = (name: string): PrObservation => ({
  kind: 'pull',
  source: EPrSource.WebhookPull,
  observedAt: '2026-11-18T21:06:00.000Z',
  sample: pullSampleOf(name),
})

type MergeabilityArgs = { headSha: string; mergeable: boolean | null; observedAt: string }

const mergeabilityOf = (args: MergeabilityArgs): PrObservation => ({
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

const fold = (observations: readonly PrObservation[], state: FoldState = null) =>
  foldPrObservations({ observations, state })

function randomPermutations<T>(args: { items: readonly T[]; count: number; seed: number }): T[][] {
  let seed = args.seed
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296

    return seed / 4294967296
  }
  const permutations: T[][] = []

  for (let round = 0; round < args.count; round += 1) {
    const shuffled = [...args.items]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(next() * (index + 1))
      const held = shuffled[index]
      const other = shuffled[swap]
      if (held === undefined || other === undefined) continue
      shuffled[index] = other
      shuffled[swap] = held
    }
    permutations.push(shuffled)
  }

  return permutations
}

const pullFixtureNames = [
  'pull-request-opened.json',
  'pull-request-closed-unmerged.json',
  'pull-request-synchronize.json',
  'pull-request-reopened.json',
]

const pullObservations = pullFixtureNames.map(pullObservationOf)

const mixedObservations: PrObservation[] = [
  ...pullObservations,
  mergeabilityOf({ headSha: CLOSED_HEAD, mergeable: null, observedAt: '2026-11-18T21:03:50Z' }),
  mergeabilityOf({ headSha: CLOSED_HEAD, mergeable: true, observedAt: '2026-11-18T21:03:53Z' }),
]

describe('permutation invariance', () => {
  it('agrees across 200 random arrival orders of the pull observations', () => {
    const sorted = [...pullObservations].sort((a, b) =>
      a.kind === 'pull' && b.kind === 'pull' ? comparePullSamples({ a: a.sample, b: b.sample }) : 0,
    )
    const expected = fold(sorted)

    for (const permutation of randomPermutations({
      items: pullObservations,
      count: 200,
      seed: 7,
    })) {
      expect(fold(permutation)).toEqual(expected)
    }
    expect(expected.state?.pull?.state).toBe(EPrState.Open)
    expect(expected.state?.pull?.headSha).toBe(PUSHED_HEAD)
  })

  it('agrees across 200 random arrival orders once mergeability samples join the set', () => {
    const expected = fold(mixedObservations)

    for (const permutation of randomPermutations({
      items: mixedObservations,
      count: 200,
      seed: 11,
    })) {
      expect(fold(permutation)).toEqual(expected)
    }
    expect(expected.state?.pull?.headSha).toBe(PUSHED_HEAD)
    expect(expected.state?.mergeability).toBeNull()
    expect(expected.uncertainty).toContain('mergeability-unknown')
  })

  it('reaches the same state when the mergeability samples are permuted on a known head', () => {
    const state = fold(pullObservations).state
    const samples = [
      mergeabilityOf({ headSha: PUSHED_HEAD, mergeable: null, observedAt: '2026-11-18T21:05:41Z' }),
      mergeabilityOf({ headSha: PUSHED_HEAD, mergeable: true, observedAt: '2026-11-18T21:05:43Z' }),
      mergeabilityOf({
        headSha: PUSHED_HEAD,
        mergeable: false,
        observedAt: '2026-11-18T21:05:42Z',
      }),
    ]
    const expected = fold(samples, state)

    for (const permutation of randomPermutations({ items: samples, count: 200, seed: 13 })) {
      expect(fold(permutation, state)).toEqual(expected)
    }
    expect(expected.state?.mergeability?.mergeable).toBe(true)
    expect(expected.state?.mergeability?.observedAt).toBe('2026-11-18T21:05:43Z')
  })
})

describe('idempotence', () => {
  it('folding the same set twice equals folding it once', () => {
    const once = fold(mixedObservations)
    const twice = fold([...mixedObservations].reverse(), once.state)

    expect(twice.state).toEqual(once.state)
    expect(twice.changed).toEqual([])
  })
})

describe('monotonicity', () => {
  const sequence: PrObservation[] = [
    ...pullObservations,
    mergeabilityOf({ headSha: PUSHED_HEAD, mergeable: true, observedAt: '2026-11-18T21:05:44Z' }),
  ]

  it('never lowers the pull timestamp and never drops a known mergeability for the same scope', () => {
    for (let index = 1; index < sequence.length; index += 1) {
      const before = fold(sequence.slice(0, index))
      const after = fold(sequence.slice(0, index + 1))
      const step = sequence[index]
      if (before.state?.pull !== null && before.state?.pull !== undefined && after.state?.pull) {
        expect(
          comparePullSamples({ a: after.state.pull, b: before.state.pull }),
        ).toBeGreaterThanOrEqual(0)
      }
      const headKept =
        before.state?.pull?.headSha === after.state?.pull?.headSha &&
        before.state?.pull?.baseBranch === after.state?.pull?.baseBranch
      const knownMergeability = before.state?.mergeability?.mergeable ?? null
      if (step?.kind === 'mergeability' && knownMergeability !== null && headKept) {
        expect(after.state?.mergeability?.mergeable).toBe(knownMergeability)
      }
    }
  })

  it('a mergeability observation never touches the pull or the checks group', () => {
    const held = fold(pullObservations).state
    const step = mergeabilityOf({
      headSha: PUSHED_HEAD,
      mergeable: true,
      observedAt: '2026-11-18T21:05:44Z',
    })
    const after = fold([step], held)

    expect(after.changed).toEqual(['mergeability'])
    expect(after.state?.pull).toEqual(held?.pull ?? null)
    expect(after.state?.checks).toEqual(held?.checks ?? null)
  })
})

describe('the delayed opened delivery', () => {
  it('stays closed in both arrival orders', () => {
    const opened = pullObservationOf('pull-request-opened.json')
    const edited = pullObservationOf('pull-request-edited-title.json')

    for (const observations of [
      [opened, edited],
      [edited, opened],
    ]) {
      const state = fold(observations).state
      expect(state?.pull?.state).toBe(EPrState.Closed)
      expect(state?.pull?.closedAt).toBe('2026-11-18T21:03:49Z')
      expect(state?.pull?.pullUpdatedAt).toBe('2026-11-18T21:03:49Z')
    }
  })
})

describe('re-run identity', () => {
  const headSha = '5778f502a0e59405ebbe1a67518ffe791b194b56'
  const attempt = (args: { id: number; status: string; conclusion: string | null }) =>
    checksIdentityOf({
      sample: {
        source: ECheckSource.Run,
        id: args.id,
        name: 'fails',
        appSlug: 'github-actions',
        headSha,
        status: args.status,
        conclusion: args.conclusion,
        startedAt: '2026-11-18T21:03:47Z',
        completedAt: args.status === 'completed' ? '2026-11-18T21:03:51Z' : null,
      },
    })

  it('tallies a re-run and its sibling as one check', () => {
    const attempts = [
      attempt({ id: 101, status: 'completed', conclusion: 'failure' }),
      attempt({ id: 202, status: 'completed', conclusion: 'success' }),
    ]
    const derived = derivedChecksOf({ attempts, headSha, requiredContexts: ['probe'] })

    expect(derived).toMatchObject({
      running: 0,
      passed: 1,
      failed: 0,
      rollup: EChecksState.Passing,
      requiredContexts: ['probe'],
    })
  })

  it('tallies the newest queued attempt as running', () => {
    const derived = derivedChecksOf({
      attempts: [
        attempt({ id: 101, status: 'completed', conclusion: 'failure' }),
        attempt({ id: 202, status: 'completed', conclusion: 'success' }),
        attempt({ id: 303, status: 'queued', conclusion: null }),
      ],
      headSha,
      requiredContexts: [],
    })

    expect(derived).toMatchObject({
      running: 1,
      passed: 0,
      failed: 0,
      rollup: EChecksState.Running,
    })
  })
})
