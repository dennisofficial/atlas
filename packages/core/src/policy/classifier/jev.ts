import { z } from 'zod'

import type { DecisionQuestion } from '../../ports/decision.port'
import { EJudgment, type Verdict } from './verdict'

export const JEV_MODEL = 'jev-latest'

export const JEV_RISK_THRESHOLD = 0.25

export const JEV_RISK_KEY = 'danger'

const JEV_RISK_INSTRUCTION = [
  'Would running this tool call lose work that cannot be recovered, reach systems outside the working directory,',
  'or step on another live agent working in the same repository?',
  'The state quotes the recent exchange between the agent and the operator who runs it.',
  'When the operator has seen what this call does and authorised it in their own words, interrupting is not warranted.',
  'Answer true only when interrupting before it runs is warranted; anything the developer can undo is false.',
].join(' ')

export function jevRiskQuestions(): Record<string, DecisionQuestion> {
  return {
    [JEV_RISK_KEY]: { type: 'noul', instructions: JEV_RISK_INSTRUCTION },
  }
}

export const JEV_SERVICE_KEY = 'service'

const JEV_SERVICE_INSTRUCTION = [
  'Does this shell command start a process that keeps running — a dev server, a watcher, a daemon, a database —',
  'rather than doing its work and exiting?',
  'Answer true only when the process is meant to stay up after the command returns; a build, a test run,',
  'or a script that prints and exits is false, even when its name sounds like a server.',
].join(' ')

export function jevServiceQuestions(): Record<string, DecisionQuestion> {
  return {
    [JEV_SERVICE_KEY]: { type: 'noul', instructions: JEV_SERVICE_INSTRUCTION },
  }
}

export const JEV_LOOP_KEY = 'loop'

export const JEV_LOOP_THRESHOLD = 0.5

const JEV_LOOP_INSTRUCTION = [
  'Is the agent stuck in a loop — repeating the same kind of step, such as re-checking, re-verifying,',
  'or re-deploying, without new information arriving between rounds, even when the exact words or commands differ?',
  "The state quotes the agent's steps since the operator last spoke, oldest first.",
  'A build-test-fix cycle where each round acts on what the previous one found is progress, not a loop.',
  'Answer true only when another round of the same is unlikely to produce anything the earlier rounds did not.',
].join(' ')

export function jevLoopQuestions(): Record<string, DecisionQuestion> {
  return {
    [JEV_LOOP_KEY]: { type: 'noul', instructions: JEV_LOOP_INSTRUCTION },
  }
}

export const jevAnswersSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({
      noul: z.number().min(0).max(1).optional(),
      choice: z.string().optional(),
      score: z.number().optional(),
    }),
  ),
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
