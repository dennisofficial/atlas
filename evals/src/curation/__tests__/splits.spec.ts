import { describe, expect, test } from 'bun:test'

import { ECaseReviewState, EVerificationOutcome, type EvalCase } from '../../case'
import { splitCases, splitCounts } from '../splits'

const makeCase = ({ id, group }: { id: string; group: string }): EvalCase => ({
  schemaVersion: 1,
  id,
  featureId: 'f',
  input: null,
  expected: null,
  tags: [],
  provenance: { group, method: 'm', sourceHash: 'h', sourceVersion: 'v', completeness: 'c' },
  review: {
    state: ECaseReviewState.Accepted,
    verifications: [{ verifier: 'v', outcome: EVerificationOutcome.Confirmed, at: 't' }],
  },
})

const corpus = (): EvalCase[] =>
  Array.from({ length: 200 }, (_, index) => makeCase({ id: `case-${String(index).padStart(3, '0')}`, group: `group-${index % 40}` }))

describe('splitCases', () => {
  test('keeps whole groups together', () => {
    const { development, holdout } = splitCases({ cases: corpus(), holdoutFraction: 0.3, seed: 7 })
    const holdoutGroups = new Set(holdout.map((entry) => entry.provenance.group))
    expect(development.some((entry) => holdoutGroups.has(entry.provenance.group))).toBe(false)
    expect(development.length + holdout.length).toBe(200)
    expect(holdout.length).toBeGreaterThan(0)
    expect(development.length).toBeGreaterThan(0)
  })

  test('is deterministic regardless of input order', () => {
    const forward = splitCases({ cases: corpus(), holdoutFraction: 0.3, seed: 7 })
    const reversed = splitCases({ cases: [...corpus()].reverse(), holdoutFraction: 0.3, seed: 7 })
    expect(reversed).toEqual(forward)
  })

  test('changes with the seed', () => {
    const one = splitCases({ cases: corpus(), holdoutFraction: 0.3, seed: 1 })
    const two = splitCases({ cases: corpus(), holdoutFraction: 0.3, seed: 2 })
    expect(one.holdout.map((entry) => entry.id)).not.toEqual(two.holdout.map((entry) => entry.id))
  })

  test('returns both sides sorted by id', () => {
    const { development, holdout } = splitCases({ cases: corpus(), holdoutFraction: 0.3, seed: 7 })
    for (const side of [development, holdout]) {
      const ids = side.map((entry) => entry.id)
      expect(ids).toEqual([...ids].sort())
    }
  })

  test('fraction 0 holds out nothing', () => {
    const { holdout } = splitCases({ cases: corpus(), holdoutFraction: 0, seed: 7 })
    expect(holdout).toEqual([])
  })

  test('validates the fraction range', () => {
    for (const holdoutFraction of [-0.1, 0.51, Number.NaN]) {
      expect(() => splitCases({ cases: [], holdoutFraction, seed: 1 })).toThrow('holdoutFraction')
    }
    expect(() => splitCases({ cases: [], holdoutFraction: 0.5, seed: 1 })).not.toThrow()
  })

  test('zero groups yields empty splits', () => {
    expect(splitCases({ cases: [], holdoutFraction: 0.2, seed: 1 })).toEqual({ development: [], holdout: [] })
  })
})

describe('splitCounts', () => {
  test('counts cases and distinct groups per side', () => {
    const split = splitCases({ cases: corpus(), holdoutFraction: 0.3, seed: 7 })
    const counts = splitCounts({ split })
    expect(counts.development).toBe(split.development.length)
    expect(counts.holdout).toBe(split.holdout.length)
    expect(counts.groups.development + counts.groups.holdout).toBe(40)
  })
})
