import type { DecisionAnswer, DecisionQuestion } from './decision.port'

export type ClassifierQuestion = Extract<DecisionQuestion, { type: 'noul' | 'choice' }>

export enum EClassifierFault {
  Unavailable = 'unavailable',
  Rejected = 'rejected',
  Malformed = 'malformed',
  Aborted = 'aborted',
}

export type ClassifierUsage = { inputTokens: number }

export type ClassifierOutcome =
  | {
      ok: true
      answers: Readonly<Record<string, DecisionAnswer>>
      model: string
      usage?: ClassifierUsage | undefined
    }
  | { ok: false; fault: EClassifierFault; detail: string }

export type ClassifierStatus =
  | { on: true; model: string; provider: string }
  | { on: false; reason: string }

export type ClassifierCall = {
  state: string
  questions: Record<string, ClassifierQuestion>
  signal: AbortSignal
  longContext?: boolean | undefined
}

export abstract class ClassifierPort {
  abstract classify(args: ClassifierCall): Promise<ClassifierOutcome>
}
