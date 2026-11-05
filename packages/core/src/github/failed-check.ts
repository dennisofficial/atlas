import { z } from 'zod'

export const GITHUB_ACTIONS_APP = 'github-actions'

export const FAILED_CHECK_LIMIT = 10

export const FAILED_CHECK_TEXT_LIMIT = 1_000

export const FAILED_CHECK_ANNOTATION_LIMIT = 3

export const FAILED_CHECK_ANNOTATION_MESSAGE_LIMIT = 300

export type PrFailedCheckAnnotation = {
  path?: string | undefined
  line?: number | undefined
  message: string
  title?: string | undefined
}

export const prFailedCheckAnnotationSchema = z.object({
  path: z.string().optional(),
  line: z.number().optional(),
  message: z.string().min(1),
  title: z.string().optional(),
})

export type PrFailedCheck = {
  name: string
  app?: string | undefined
  url?: string | undefined
  checkRunId?: string | undefined
  conclusion?: string | undefined
  title?: string | undefined
  summary?: string | undefined
  annotations?: PrFailedCheckAnnotation[] | undefined
}

export const prFailedCheckSchema = z.object({
  name: z.string().min(1),
  app: z.string().optional(),
  url: z.string().optional(),
  checkRunId: z.string().optional(),
  conclusion: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  annotations: z.array(prFailedCheckAnnotationSchema).optional(),
})

export const clipCheckText = (text: string | null | undefined): string | undefined => {
  const trimmed = text?.trim() ?? ''
  if (trimmed === '') return undefined
  return trimmed.length <= FAILED_CHECK_TEXT_LIMIT
    ? trimmed
    : `${trimmed.slice(0, FAILED_CHECK_TEXT_LIMIT - 1)}…`
}

const CONCLUSION_LABELS: Record<string, string> = {
  cancelled: 'cancelled',
  timed_out: 'timed out',
  startup_failure: 'failed to start',
  action_required: 'needs action',
}

const CONCLUSIONS_WITHOUT_LOGS = new Set(['cancelled', 'startup_failure'])

export const failedCheckConclusionLabel = (check: PrFailedCheck): string | undefined =>
  check.conclusion === undefined ? undefined : CONCLUSION_LABELS[check.conclusion]

export const failedCheckLogCommand = (args: {
  check: PrFailedCheck
  repoFullName: string
}): string | undefined => {
  if (args.check.app !== GITHUB_ACTIONS_APP || args.check.checkRunId === undefined) return undefined
  if (args.check.conclusion !== undefined && CONCLUSIONS_WITHOUT_LOGS.has(args.check.conclusion))
    return undefined
  return `gh run view --job ${args.check.checkRunId} --log-failed -R ${args.repoFullName}`
}
