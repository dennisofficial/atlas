import { z } from 'zod'

import { prFailedCheckSchema } from '../github/failed-check'
import { EMergeQueueMove, EPrEventKind, EPrReviewState, EPrVerdict } from './body'
import type { PrChecksTally } from './pr-body'
import { noticeStampSchema } from './notice-stamp-schema'

const prChecksTallySchema: z.ZodType<PrChecksTally> = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
})

export const prEventSchemas = [
  z.object({
    type: z.literal('pull-request-linked'),
    number: z.number().int().positive(),
    url: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().min(1),
    worktreePath: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('pr-event'),
    repo: z.string().min(1),
    prNumber: z.number().int().positive(),
    kind: z.enum(EPrEventKind),
    url: z.string().min(1),
    eventId: z.string().min(1).optional(),
    authorLogin: z.string().optional(),
    body: z.string().optional(),
    verdict: z.enum(EPrVerdict).optional(),
    headSha: z.string().optional(),
    edited: z.boolean().optional(),
    settled: z.boolean().optional(),
    failedChecks: z.array(prFailedCheckSchema).optional(),
    mergeable: z.boolean().optional(),
    baseBranch: z.string().optional(),
    state: z.string().optional(),
    queue: z.enum(EMergeQueueMove).optional(),
    checks: prChecksTallySchema.optional(),
    reviewState: z.enum(EPrReviewState).optional(),
    path: z.string().optional(),
    line: z.number().int().positive().optional(),
    startLine: z.number().int().positive().optional(),
    side: z.string().optional(),
    diffHunk: z.string().optional(),
    inReplyTo: z.string().optional(),
    notice: noticeStampSchema.optional(),
  }),
] as const
