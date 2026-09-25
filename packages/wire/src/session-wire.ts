import { z } from 'zod'

export const wireThreadSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  head: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  parent: z.object({ threadId: z.string(), forkSeq: z.number().int() }).optional(),
  forkMode: z.enum(['reference', 'copy']).optional(),
  agent: z.object({ spawnedBy: z.string(), type: z.string() }).optional(),
  workspace: z.string().nullable(),
  repo: z.string().nullable(),
  model: z.object({ ref: z.string(), effort: z.string() }).optional(),
  worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
  pullRequests: z
    .array(z.object({ number: z.number(), url: z.string(), repo: z.string(), branch: z.string() }))
    .optional(),
  executionLocation: z.string().optional(),
})

export type WireThread = z.infer<typeof wireThreadSchema>

export const wireEventSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  seq: z.number().int(),
  runId: z.string(),
  parentRunId: z.string().optional(),
  depth: z.number().int(),
  at: z.string(),
  type: z.string(),
  body: z.string(),
  contextSlot: z.string().optional(),
  contextKey: z.string().optional(),
  contextDigest: z.string().optional(),
})

export type WireEvent = z.infer<typeof wireEventSchema>

export const wireTurnSchema = z.object({
  runId: z.string(),
  threadId: z.string(),
  status: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  steps: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().int(),
})

export type WireTurn = z.infer<typeof wireTurnSchema>

export type WireDraft = {
  type: string
  body: string
  contextSlot?: string | undefined
  contextKey?: string | undefined
  contextDigest?: string | undefined
}
