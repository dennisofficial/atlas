export type DecisionQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: readonly string[] }

export type DecisionAnswer = {
  noul?: number | undefined
  choice?: string | undefined
  score?: number | undefined
  probabilities?: Record<string, number> | undefined
  confidence?: number | undefined
}

export type DecisionOutcome =
  | { ok: true; answers: Record<string, DecisionAnswer>; model?: string | undefined }
  | { ok: false; fault: string }

export abstract class DecisionPort {
  abstract decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
    model?: string | undefined
  }): Promise<DecisionOutcome>
}
