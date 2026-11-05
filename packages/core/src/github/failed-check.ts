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
  title?: string | undefined
  summary?: string | undefined
  annotations?: PrFailedCheckAnnotation[] | undefined
}

export const prFailedCheckSchema = z.object({
  name: z.string().min(1),
  app: z.string().optional(),
  url: z.string().optional(),
  checkRunId: z.string().optional(),
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

export const failedCheckLogCommand = (args: {
  check: PrFailedCheck
  repoFullName: string
}): string | undefined =>
  args.check.app === GITHUB_ACTIONS_APP && args.check.checkRunId !== undefined
    ? `gh run view --job ${args.check.checkRunId} --log-failed -R ${args.repoFullName}`
    : undefined
