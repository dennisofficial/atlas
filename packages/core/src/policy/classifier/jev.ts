import { z } from 'zod'

import { EJudgment, type Verdict } from './verdict'

export const JEV_MODEL = 'jev-latest'

export const JEV_RISK_THRESHOLD = 0.25

export const JEV_RISK_KEY = 'danger'

const JEV_RISK_INSTRUCTION = [
  'Would running this tool call lose work that cannot be recovered, reach systems outside the working directory,',
  'or step on another live agent working in the same repository?',
  'Answer true only when interrupting before it runs is warranted; anything the developer can undo is false.',
].join(' ')

export function jevRiskQuestions(): Record<string, unknown> {
  return {
    [JEV_RISK_KEY]: { type: 'noul', instructions: JEV_RISK_INSTRUCTION },
  }
}

export const jevAnswersSchema = z.object({
  answers: z.object({
    [JEV_RISK_KEY]: z.object({ noul: z.number().min(0).max(1) }),
  }),
})

const fixed = ({ probability }: { probability: number }): string => probability.toFixed(2)

export function verdictFromRisk({
  probability,
  targets,
  threshold = JEV_RISK_THRESHOLD,
}: {
  probability: number
  targets: readonly string[]
  threshold?: number
}): Verdict {
  if (probability < threshold) {
    return {
      judgment: EJudgment.Proceed,
      reason: `the decision model scored this call's risk at ${fixed({ probability })}, under the ${threshold} threshold`,
    }
  }

  const named = targets.length === 0 ? 'the call' : targets.join(', ')
  return {
    judgment: EJudgment.Check,
    reason: `the decision model scored this call's risk at ${fixed({ probability })} (threshold ${threshold}), flagging ${named}`,
  }
}
