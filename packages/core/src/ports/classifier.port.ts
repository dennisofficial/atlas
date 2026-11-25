import type { DecisionAnswer, DecisionQuestion } from './decision.port'

export type ClassifierQuestion = Extract<DecisionQuestion, { type: 'noul' | 'choice' }>

export enum EClassifierFault {
  Unavailable = 'unavailable',
  Rejected = 'rejected',
  Malformed = 'malformed',
  Aborted = 'aborted',
}

export type ClassifierUsage = { inputTokens: number; outputTokens: number | null }

export type ClassifierCallContext = {
  path: string
  scopeId: string
  policyIds: readonly string[]
  lineStart: number | null
  lineEnd: number | null
}

export type ClassifierOutcome =
  | {
      ok: true
      answers: Readonly<Record<string, DecisionAnswer>>
      model: string
      usage?: ClassifierUsage | undefined
    }
  | { ok: false; fault: EClassifierFault; detail: string }

export type ClassifierPricing = {
  endpoint: string
  inputUsdPerMillion: number
  outputUsdPerMillion: number
}

export type ClassifierStatus =
  | { on: true; model: string; provider: string; pricing?: ClassifierPricing | undefined }
  | { on: false; reason: string }

export abstract class ClassifierPort {
  abstract classify(args: {
    state: string
    questions: Record<string, ClassifierQuestion>
    signal: AbortSignal
    context?: ClassifierCallContext | undefined
  }): Promise<ClassifierOutcome>
}
