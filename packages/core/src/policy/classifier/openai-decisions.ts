import { z } from 'zod'

import type { DecisionAnswer, DecisionQuestion } from '../../ports/decision.port'

export type OpenAiWireQuestion =
  | { type: 'predicate'; name: string; instructions: string }
  | { type: 'choice'; name: string; instructions: string; choices: { value: string; description: string }[] }
  | { type: 'score'; name: string; instructions: string; levels: { label: string }[] }

// The decisions API echoes `model` and a refusal answer carries no probability:
// https://platform.openai.com/docs/api-reference/decisions
export const openAiDecisionsResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('predicate'), name: z.string(), probability: z.number() }),
      z.object({
        type: z.literal('choice'),
        name: z.string(),
        choice: z.string(),
        probabilities: z.array(z.object({ value: z.string(), probability: z.number() })).optional(),
        confidence: z.number().optional(),
      }),
      z.object({
        type: z.literal('score'),
        name: z.string(),
        score: z.number(),
        confidence: z.number().optional(),
      }),
      z.object({ type: z.literal('refusal'), name: z.string() }),
    ]),
  ),
})

export type OpenAiWireAnswer = z.infer<typeof openAiDecisionsResponseSchema>['answers'][number]

export function translateQuestions(args: {
  questions: Record<string, DecisionQuestion>
}): OpenAiWireQuestion[] {
  return Object.entries(args.questions).map(([name, question]): OpenAiWireQuestion => {
    if (question.type === 'noul') return { type: 'predicate', name, instructions: question.instructions }
    if (question.type === 'choice') {
      return {
        type: 'choice',
        name,
        instructions: question.instructions,
        choices: Object.entries(question.criteria).map(([value, description]) => ({ value, description })),
      }
    }
    return {
      type: 'score',
      name,
      instructions: question.instructions,
      levels: question.criteria.map((label) => ({ label })),
    }
  })
}

export function translateAnswers(args: {
  answers: readonly OpenAiWireAnswer[]
}): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {}
  for (const answer of args.answers) {
    if (answer.type === 'predicate') {
      out[answer.name] = { noul: answer.probability }
      continue
    }
    if (answer.type === 'choice') {
      const probabilities: Record<string, number> = {}
      for (const entry of answer.probabilities ?? []) probabilities[entry.value] = entry.probability
      out[answer.name] = {
        choice: answer.choice,
        ...(Object.keys(probabilities).length > 0 ? { probabilities } : {}),
        ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
      }
      continue
    }
    if (answer.type === 'score') {
      out[answer.name] = {
        score: answer.score,
        ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
      }
    }
  }
  return out
}
