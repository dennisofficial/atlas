import { z } from 'zod'
import type { EvalFeature } from '../src/feature'

export type CalculatorOperation = 'add' | 'subtract' | 'multiply' | 'divide'

export type CalculatorInput = { a: number; b: number; op: CalculatorOperation }
export type CalculatorExpected = { result: number }
export type CalculatorOutput = { result: number }

export const inputSchema: z.ZodType<CalculatorInput> = z.object({
  a: z.number(),
  b: z.number(),
  op: z.enum(['add', 'subtract', 'multiply', 'divide']),
})

export const expectedSchema: z.ZodType<CalculatorExpected> = z.object({ result: z.number() })

export const outputSchema: z.ZodType<CalculatorOutput> = z.object({ result: z.number() })

export function calculate(input: CalculatorInput): number {
  if (input.op === 'add') return input.a + input.b
  if (input.op === 'subtract') return input.a - input.b
  if (input.op === 'multiply') return input.a * input.b
  return input.a / input.b
}

export function createCalculatorFeature({
  evaluate,
}: {
  evaluate: (input: CalculatorInput) => number
}): EvalFeature<CalculatorInput, CalculatorExpected, CalculatorOutput> {
  return {
    id: 'calculator',
    inputSchemaVersion: '1',
    expectedSchemaVersion: '1',
    rubricVersion: '1',
    inputSchema,
    expectedSchema,
    outputSchema,
    run: async ({ input }) => ({ result: evaluate(input) }),
    evaluators: [
      {
        id: 'exact-match',
        applies: () => true,
        grade: ({ expected, actual }) =>
          expected.result === actual.result
            ? { score: 1 }
            : { score: 0, difference: `expected ${expected.result}, got ${actual.result}` },
      },
    ],
  }
}
