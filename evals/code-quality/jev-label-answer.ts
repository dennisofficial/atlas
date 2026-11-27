import { z } from 'zod'

import { EQualityImpact } from '@dltech/atlas-core'

import type { JevLabelScopeState } from './jev-label-state'

export enum EJevLabel {
  Nudge = 'nudge',
  NoNudge = 'no_nudge',
  Unsure = 'unsure',
}

export const JEV_LABEL_MODELS: readonly string[] = ['anthropic/claude-opus-5.5', 'openai/gpt-5.5']

export const JEV_LABEL_RUBRIC_PATH = 'evals/code-quality/srp-label-rubric.md'

export const JEV_LABEL_INSTRUCTION = `Answer with ONE JSON object and nothing else:
{"mixes": true|false,
 "change_reasons": ["..."],
 "impact": "introduced|worsened|improved|resolved|unchanged|not_applicable|uncertain",
 "label": "nudge|no_nudge|unsure",
 "reason": "one or two plain sentences"}`

export class JevLabelAnswerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JevLabelAnswerError'
  }
}

export const jevLabelAnswerSchema = z.object({
  mixes: z.boolean(),
  change_reasons: z.array(z.string()),
  impact: z.enum(EQualityImpact),
  label: z.enum(EJevLabel),
  reason: z.string().min(1),
})

export type JevLabelAnswer = z.infer<typeof jevLabelAnswerSchema>

export type JevLabelMessages = { system: string; user: string }

const section = ({ title, body }: { title: string; body: string | null }): string =>
  `## ${title}\n\`\`\`\n${body ?? 'null'}\n\`\`\``

export function labelView({
  path,
  scope,
}: {
  path: string | null
  scope: JevLabelScopeState
}): string {
  const collaborators = scope.dependencyContext.join('\n')
  return [
    `Path: ${path ?? 'unknown'}`,
    section({ title: 'BEFORE (null = new scope)', body: scope.before }),
    section({ title: 'AFTER', body: scope.after }),
    `## DIFF\n\`\`\`diff\n${scope.diff}\n\`\`\``,
    `## Imports and collaborators\n\`\`\`\n${collaborators}\n\`\`\``,
  ].join('\n\n')
}

export function labelMessages({
  rubric,
  view,
}: {
  rubric: string
  view: string
}): JevLabelMessages {
  return { system: rubric, user: `${view}\n\n${JEV_LABEL_INSTRUCTION}` }
}

export function parseLabelAnswer({ text }: { text: string }): JevLabelAnswer {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start)
    throw new JevLabelAnswerError('the labeller answer holds no JSON object')
  let decoded: unknown
  try {
    decoded = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new JevLabelAnswerError('the labeller answer JSON does not parse')
  }
  const parsed = jevLabelAnswerSchema.safeParse(decoded)
  if (!parsed.success)
    throw new JevLabelAnswerError(
      `the labeller answer is not a label: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    )
  return parsed.data
}

export type JevLabelVerdict = {
  label: EJevLabel
  notify: boolean
  agreed: boolean
  impact: EQualityImpact
  impactDisputed: readonly EQualityImpact[] | null
}

export function resolveJevLabel({
  answers,
}: {
  answers: readonly JevLabelAnswer[]
}): JevLabelVerdict {
  const first = answers[0]
  if (first === undefined) throw new JevLabelAnswerError('a label needs at least one answer')
  const agreed =
    answers.every((answer) => answer.label === first.label) && first.label !== EJevLabel.Unsure
  const label = agreed ? first.label : EJevLabel.Unsure
  const distinctImpacts = [...new Set(answers.map((answer) => answer.impact))]
  const impact = distinctImpacts.length === 1 ? (distinctImpacts[0] as EQualityImpact) : null
  const resolved =
    impact ?? (label === EJevLabel.Nudge ? EQualityImpact.Introduced : EQualityImpact.Unchanged)
  return {
    label,
    notify: label === EJevLabel.Nudge,
    agreed,
    impact: resolved,
    impactDisputed: impact === null ? distinctImpacts : null,
  }
}
