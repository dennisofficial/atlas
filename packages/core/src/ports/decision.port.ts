export type DecisionQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: readonly string[] }

export type DecisionAnswer = {
  noul?: number | undefined
  choice?: string | undefined
  score?: number | undefined
  probabilities?: Record<string, number> | undefined
}

export type DecisionOutcome =
  | { ok: true; answers: Record<string, DecisionAnswer> }
  | { ok: false; fault: string }

export abstract class DecisionPort {
  abstract decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
  }): Promise<DecisionOutcome>
}
