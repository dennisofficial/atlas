import type { DecisionAnswer, DecisionQuestion } from './decision.port'

export type ClassifierQuestion = Extract<DecisionQuestion, { type: 'noul' | 'choice' }>

export enum EClassifierFault {
  Unavailable = 'unavailable',
  Rejected = 'rejected',
  Malformed = 'malformed',
  Aborted = 'aborted',
}

export type ClassifierOutcome =
  | { ok: true; answers: Readonly<Record<string, DecisionAnswer>>; model: string }
  | { ok: false; fault: EClassifierFault; detail: string }

export type ClassifierStatus = { on: true; model: string } | { on: false; reason: string }

export abstract class ClassifierPort {
  abstract classify(args: {
    state: string
    questions: Record<string, ClassifierQuestion>
    signal: AbortSignal
  }): Promise<ClassifierOutcome>
}
