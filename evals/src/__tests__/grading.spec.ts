import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { createCalculatorFeature } from '../../__fixtures__/calculator'
import type { EvalEvaluator, EvalFeature } from '../feature'
import { EScoreErrorKind, ScoringError, gradeRow, validateGrade } from '../grading'

const capture = ({ run }: { run: () => unknown }): unknown => {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

const numberFeature = ({
  evaluators,
}: {
  evaluators: readonly EvalEvaluator<number, number, number>[]
}): EvalFeature<number, number, number> => ({
  id: 'numbers',
  inputSchemaVersion: '1',
  expectedSchemaVersion: '1',
  rubricVersion: '1',
  inputSchema: z.number(),
  expectedSchema: z.number(),
  outputSchema: z.number(),
  run: async ({ input }) => input,
  evaluators,
})

describe('validateGrade', () => {
  it('accepts scores at and inside the unit interval', () => {
    expect(validateGrade({ evaluatorId: 'e', grade: { score: 0 } })).toBe(0)
    expect(validateGrade({ evaluatorId: 'e', grade: { score: 0.4 } })).toBe(0.4)
    expect(validateGrade({ evaluatorId: 'e', grade: { score: 1 } })).toBe(1)
  })

  it.each([-0.01, 1.01, 7])('rejects out-of-range score %p', (score) => {
    const error = capture({ run: () => validateGrade({ evaluatorId: 'range', grade: { score } }) })
    expect(error).toBeInstanceOf(ScoringError)
    expect(error).toMatchObject({ kind: EScoreErrorKind.OutOfRange, evaluatorId: 'range' })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects non-finite score %p', (score) => {
    const error = capture({ run: () => validateGrade({ evaluatorId: 'finite', grade: { score } }) })
    expect(error).toMatchObject({ kind: EScoreErrorKind.NonFinite, evaluatorId: 'finite' })
  })

  it('rejects a grade with no numeric score', () => {
    const grade = JSON.parse('{}')
    const error = capture({ run: () => validateGrade({ evaluatorId: 'missing', grade }) })
    expect(error).toMatchObject({ kind: EScoreErrorKind.Missing, evaluatorId: 'missing' })
  })
})

describe('gradeRow', () => {
  it('returns a map of evaluator id to score', () => {
    const feature = createCalculatorFeature({ evaluate: () => 0 })
    const scores = gradeRow({ feature, input: { a: 1, b: 2, op: 'add' }, expected: { result: 3 }, actual: { result: 3 } })
    expect(scores).toEqual({ 'exact-match': 1 })
  })

  it('skips evaluators whose applies is false', () => {
    const feature = numberFeature({
      evaluators: [
        { id: 'always', applies: () => true, grade: () => ({ score: 1 }) },
        { id: 'never', applies: () => false, grade: () => ({ score: 1 }) },
        { id: 'positive-only', applies: ({ expected }) => expected > 0, grade: () => ({ score: 0.5 }) },
      ],
    })
    expect(gradeRow({ feature, input: 0, expected: 1, actual: 1 })).toEqual({ always: 1, 'positive-only': 0.5 })
    expect(gradeRow({ feature, input: 0, expected: -1, actual: 1 })).toEqual({ always: 1 })
  })

  it('propagates scorer exceptions unchanged', () => {
    const feature = numberFeature({
      evaluators: [
        {
          id: 'boom',
          applies: () => true,
          grade: () => {
            throw new Error('scorer exploded')
          },
        },
      ],
    })
    expect(() => gradeRow({ feature, input: 0, expected: 0, actual: 0 })).toThrow('scorer exploded')
  })

  it('throws a ScoringError for an invalid grade from an evaluator', () => {
    const feature = numberFeature({ evaluators: [{ id: 'bad', applies: () => true, grade: () => ({ score: 2 }) }] })
    const error = capture({ run: () => gradeRow({ feature, input: 0, expected: 0, actual: 0 }) })
    expect(error).toMatchObject({ kind: EScoreErrorKind.OutOfRange, evaluatorId: 'bad' })
  })
})
