import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { EvalRegistryError, createFeatureRegistry } from '../../src/feature-registry'
import type { AnyEvalFeature } from '../../src/feature-registry'
import { gradeRow } from '../../src/grading'
import { meanScore } from '../../src/metrics'
import { type CalculatorInput, createCalculatorFeature, expectedSchema, inputSchema, outputSchema } from '../calculator'

const compute = (input: CalculatorInput): number => {
  if (input.op === 'add') return input.a + input.b
  if (input.op === 'subtract') return input.a - input.b
  if (input.op === 'multiply') return input.a * input.b
  return input.a / input.b
}

const feature = createCalculatorFeature({ evaluate: compute })
const evaluator = feature.evaluators[0]

const dummyFeature = (): AnyEvalFeature => ({
  id: 'dummy',
  inputSchemaVersion: '1',
  expectedSchemaVersion: '1',
  rubricVersion: '1',
  inputSchema: z.unknown(),
  expectedSchema: z.unknown(),
  outputSchema: z.unknown(),
  run: async () => null,
  evaluators: [],
})

describe('calculator fixture', () => {
  it('declares id, versions and a single exact-match evaluator', () => {
    expect(feature.id).toBe('calculator')
    expect([feature.inputSchemaVersion, feature.expectedSchemaVersion, feature.rubricVersion]).toEqual(['1', '1', '1'])
    expect(feature.evaluators.map((entry) => entry.id)).toEqual(['exact-match'])
  })

  it('runs the injected evaluate function', async () => {
    const context = { invocationId: 'i', caseId: 'c', trialId: 't', variantId: 'v', model: 'm', deadlineMs: 1000 }
    expect(await feature.run({ input: { a: 6, b: 3, op: 'divide' }, context })).toEqual({ result: 2 })
  })

  it('scores strict equality as 1 and anything else as 0 with a difference', () => {
    const input: CalculatorInput = { a: 2, b: 3, op: 'add' }
    expect(evaluator?.grade({ input, expected: { result: 5 }, actual: { result: 5 } })).toEqual({ score: 1 })
    expect(evaluator?.grade({ input, expected: { result: 5 }, actual: { result: 6 } })).toEqual({
      score: 0,
      difference: 'expected 5, got 6',
    })
  })

  it('always applies', () => {
    expect(evaluator?.applies({ input: { a: 0, b: 1, op: 'divide' }, expected: { result: 0 } })).toBe(true)
  })

  it('validates input, expected and output shapes', () => {
    expect(inputSchema.safeParse({ a: 1, b: 2, op: 'add' }).success).toBe(true)
    expect(inputSchema.safeParse({ a: 1, b: 2, op: 'modulo' }).success).toBe(false)
    expect(expectedSchema.safeParse({ result: 'x' }).success).toBe(false)
    expect(outputSchema.safeParse({ result: 3 }).success).toBe(true)
  })

  it('coexists with another feature in a registry and rejects duplicates', () => {
    const registry = createFeatureRegistry({ features: [feature, dummyFeature()] })
    expect(registry.ids()).toEqual(['calculator', 'dummy'])
    expect(registry.get({ id: 'dummy' }).id).toBe('dummy')
    expect(() => createFeatureRegistry({ features: [dummyFeature(), dummyFeature()] })).toThrow(EvalRegistryError)
  })

  it('yields a mean exact-match score of 0.8 for 8 of 10 correct', () => {
    const inputs: CalculatorInput[] = Array.from({ length: 10 }, (_, index) => ({ a: index, b: 2, op: 'add' }))
    const values = inputs.map((input, index) => {
      const expected = { result: input.a + input.b }
      const actual = { result: index < 8 ? expected.result : expected.result + 1 }
      return gradeRow({ feature, input, expected, actual })['exact-match'] ?? Number.NaN
    })
    expect(meanScore({ values })).toBe(0.8)
  })
})
