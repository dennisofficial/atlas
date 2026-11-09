import { z } from 'zod'

import { noticeStampSchema } from './notice-stamp-schema'

export const runEventSchemas = [
  z.object({
    type: z.literal('run-event'),
    repo: z.string().min(1),
    workflowRunId: z.number().int().positive(),
    workflow: z.string().min(1),
    branch: z.string(),
    url: z.string().min(1),
    status: z.string().min(1),
    conclusion: z.string(),
    headSha: z.string().optional(),
    eventId: z.string().min(1).optional(),
    failedJobs: z.array(z.string()).optional(),
    notice: noticeStampSchema.optional(),
  }),
] as const
