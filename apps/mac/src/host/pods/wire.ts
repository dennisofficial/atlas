import { z } from 'zod'
import { wireEventSchema } from '@dltech/atlas-wire'

export enum ELocalPodState {
  Running = 'running',
  Stopped = 'stopped',
  Missing = 'missing',
}

export const localPodSchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  model: z.string().optional(),
  effort: z.string().optional(),
  title: z.string().optional(),
  archivedAt: z.iso.datetime().nullish(),
  createdAt: z.iso.datetime(),
  state: z.enum(ELocalPodState),
})
export type LocalPod = z.infer<typeof localPodSchema>

export const createPodInputSchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
})
export type CreatePodInput = z.infer<typeof createPodInputSchema>

export const capabilitiesSchema = z.object({
  docker: z.boolean(),
  reason: z.string().optional(),
})
export type DesktopCapabilities = z.infer<typeof capabilitiesSchema>

export const POD_NOT_RUNNING_CODE = 'pod-not-running'

export const localThreadSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().optional(),
  projectId: z.string().nullable(),
  head: z.number().int().nonnegative(),
  readSeq: z.number().int().nonnegative().nullable(),
  model: z.string().optional(),
  effort: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.iso.datetime().nullish(),
})
export type LocalThread = z.infer<typeof localThreadSchema>

export const threadListSchema = z.object({ threads: z.array(localThreadSchema) })

export const THREAD_EVENTS_PAGE_LIMIT = 500

export const threadEventsQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(THREAD_EVENTS_PAGE_LIMIT)
    .default(THREAD_EVENTS_PAGE_LIMIT),
})
export type ThreadEventsQuery = z.infer<typeof threadEventsQuerySchema>

export const threadEventsReplySchema = z.object({
  events: z.array(wireEventSchema),
  head: z.number().int().nonnegative(),
  nextAfter: z.number().int().nonnegative().nullable(),
})
export type ThreadEventsReply = z.infer<typeof threadEventsReplySchema>

export const archiveInputSchema = z.object({ archived: z.boolean() })

export const renameInputSchema = z.object({ title: z.string().trim().min(1).max(200) })

export const markReadInputSchema = z.object({ seq: z.number().int().nonnegative() })

export const readCursorReplySchema = z.object({ seq: z.number().int().nonnegative().nullable() })
