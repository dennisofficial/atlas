import type { Questions } from '@typesafe-ai/sdk'

import type { JevSystemOne } from '../../packages/harness/src/classifier/jev-client'

export type FakeTransportRule = {
  matchState?: string | undefined
  answers: Record<string, { noul?: number; choice?: string; score?: number; probabilities?: Record<string, number> }>
  model?: string | undefined
}

export type FakeTransport = {
  systemOne: JevSystemOne
  calls: readonly { state: string; questions: Questions; model: string }[]
}

export function createFakeTransport({ rules }: { rules: readonly FakeTransportRule[] }): FakeTransport {
  const calls: { state: string; questions: Questions; model: string }[] = []
  const systemOne: JevSystemOne = (request) => {
    calls.push({ state: request.state, questions: request.questions, model: request.model })
    const rule = rules.find((candidate) => candidate.matchState === undefined || request.state.includes(candidate.matchState))
    if (rule === undefined) return Promise.reject(new Error('fake transport has no rule for this request'))
    return Promise.resolve({ answers: rule.answers, model: rule.model ?? request.model })
  }
  return { systemOne, calls }
}

export const fakeSystemOne: JevSystemOne = createFakeTransport({
  rules: [{ answers: {} }],
}).systemOne
