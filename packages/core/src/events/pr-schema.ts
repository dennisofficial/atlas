import { z } from 'zod'

import { EPrEventKind, EPrReviewState, EPrVerdict } from './body'

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
    authorLogin: z.string().optional(),
    body: z.string().optional(),
    verdict: z.enum(EPrVerdict).optional(),
    headSha: z.string().optional(),
    edited: z.boolean().optional(),
    settled: z.boolean().optional(),
    mergeable: z.boolean().optional(),
    state: z.string().optional(),
    reviewState: z.enum(EPrReviewState).optional(),
  }),
] as const
