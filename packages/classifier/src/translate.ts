import {
  EClassifierFault,
  openAiDecisionsResponseSchema,
  translateAnswers,
  translateQuestions,
  type ClassifierQuestion,
  type DecisionAnswer,
  type OpenAiWireQuestion,
} from '@dltech/atlas-core'

export type TranslatedAnswers =
  | { ok: true; answers: Readonly<Record<string, DecisionAnswer>> }
  | { ok: false; fault: EClassifierFault; detail: string }

export type JevWireQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }

export type DecisionsWireQuestion = OpenAiWireQuestion

const unreadable = (detail: string): TranslatedAnswers => ({
  ok: false,
  fault: EClassifierFault.Malformed,
  detail,
})

const missingAnswer = (name: string): TranslatedAnswers =>
  unreadable(`no answer for question ${name}`)

const jevQuestionOf = (question: ClassifierQuestion): JevWireQuestion =>
  question.type === 'noul'
    ? { type: 'noul', instructions: question.instructions }
    : { type: 'choice', instructions: question.instructions, criteria: question.criteria }

export const jevRequestOf = (args: {
  questions: Record<string, ClassifierQuestion>
}): Record<string, JevWireQuestion> =>
  Object.fromEntries(
    Object.entries(args.questions).map(([name, question]) => [name, jevQuestionOf(question)]),
  )

export const decisionsRequestOf = (args: {
  questions: Record<string, ClassifierQuestion>
}): readonly DecisionsWireQuestion[] => translateQuestions({ questions: args.questions })

const bodyOf = (body: unknown): Record<string, unknown> | undefined => {
  if (typeof body !== 'object' || body === null) return undefined
  const answers = (body as { answers?: unknown }).answers
  if (typeof answers !== 'object' || answers === null) return undefined
  return answers as Record<string, unknown>
}

const jevAnswerOf = (answer: unknown): DecisionAnswer | undefined => {
  if (typeof answer !== 'object' || answer === null) return undefined
  const held = answer as Record<string, unknown>
  const out: DecisionAnswer = {}
  if (typeof held.noul === 'number') out.noul = held.noul
  if (typeof held.choice === 'string') out.choice = held.choice
  if (typeof held.score === 'number') out.score = held.score
  if (typeof held.confidence === 'number') out.confidence = held.confidence
  if (typeof held.probabilities === 'object' && held.probabilities !== null) {
    out.probabilities = held.probabilities as Record<string, number>
  }
  return out
}

export function jevAnswersOf(args: {
  questions: Record<string, ClassifierQuestion>
  body: unknown
}): TranslatedAnswers {
  const answers = bodyOf(args.body)
  if (answers === undefined) return unreadable('the classifier answered without answers')

  const out: Record<string, DecisionAnswer> = {}
  for (const [name, question] of Object.entries(args.questions)) {
    const answer = jevAnswerOf(answers[name])
    if (answer === undefined) return missingAnswer(name)
    if (question.type === 'noul' && answer.noul === undefined) return missingAnswer(name)
    if (question.type === 'choice' && answer.choice === undefined) return missingAnswer(name)
    out[name] = answer
  }
  return { ok: true, answers: out }
}

export function decisionsAnswersOf(args: {
  questions: Record<string, ClassifierQuestion>
  body: unknown
}): TranslatedAnswers {
  const parsed = openAiDecisionsResponseSchema.safeParse(args.body)
  if (!parsed.success) return unreadable('the classifier answered in a shape that was not readable')

  const names = new Set(Object.keys(args.questions))
  for (const answer of parsed.data.answers) {
    if (answer.type === 'refusal' && names.has(answer.name)) {
      return {
        ok: false,
        fault: EClassifierFault.Rejected,
        detail: `the classifier refused question ${answer.name}`,
      }
    }
  }

  const answers = translateAnswers({ answers: parsed.data.answers })
  for (const name of names) {
    if (answers[name] === undefined) return missingAnswer(name)
  }
  return { ok: true, answers }
}
