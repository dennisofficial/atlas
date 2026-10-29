import { z } from 'zod'

export const MAX_POD_EVENTS_PER_FLUSH = 500

export const podEventSchema = z.object({
  seq: z.number().int().min(1),
  runId: z.string().min(1),
  parentRunId: z.string().min(1).optional(),
  depth: z.number().int().min(0),
  at: z.iso.datetime(),
  type: z.string().min(1),
  body: z.string(),
  contextSlot: z.string().optional(),
  contextKey: z.string().optional(),
  contextDigest: z.string().optional(),
})
export type PodEvent = z.infer<typeof podEventSchema>

export const podEventsPostSchema = z.object({
  threadId: z.string().min(1).optional(),
  events: z.array(podEventSchema).min(1).max(MAX_POD_EVENTS_PER_FLUSH),
})
export type PodEventsPost = z.infer<typeof podEventsPostSchema>

export const podEventsReplySchema = z.object({ head: z.number().int().min(0) })
export type PodEventsReply = z.infer<typeof podEventsReplySchema>

export const podEventsTruncateSchema = z.object({
  threadId: z.string().min(1).optional(),
  toSeq: z.number().int().min(0),
})
export type PodEventsTruncate = z.infer<typeof podEventsTruncateSchema>

export const podChildRegisterSchema = z.strictObject({
  threadId: z.string().min(1),
  spawnedBy: z.string().min(1),
  agentType: z.string().min(1),
  title: z.string().min(1).optional(),
})
export type PodChildRegister = z.infer<typeof podChildRegisterSchema>

export const POD_EVENT_CONFLICT_CODE = 'pod-event-conflict'
