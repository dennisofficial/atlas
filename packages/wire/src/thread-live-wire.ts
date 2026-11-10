import { z } from 'zod'

import { projectSchema } from './project-wire'
import { wireThreadSchema } from './session-wire'

export enum EThreadLiveFrame {
  Snapshot = 'snapshot',
  Upsert = 'upsert',
  Remove = 'remove',
  ProjectUpsert = 'project-upsert',
  ProjectRemove = 'project-remove',
  Resync = 'resync',
  Heartbeat = 'heartbeat',
}

export enum ESessionBucket {
  Active = 'active',
  Inactive = 'inactive',
  Archived = 'archived',
}

export const sessionBucketCountsSchema = z.strictObject({
  active: z.number().int().min(0),
  inactive: z.number().int().min(0),
  archived: z.number().int().min(0),
})
export type SessionBucketCounts = z.infer<typeof sessionBucketCountsSchema>

export const liveThreadRowSchema = z.strictObject({
  sessionId: z.string().min(1),
  projectId: z.string().nullable(),
  managedBySessionId: z.string().nullable(),
  sortAt: z.string(),
  rev: z.number().int().min(0),
  thread: wireThreadSchema,
})
export type LiveThreadRow = z.infer<typeof liveThreadRowSchema>

export const threadLiveFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal(EThreadLiveFrame.Snapshot),
    rows: z.array(liveThreadRowSchema),
    projects: z.array(projectSchema),
    counts: sessionBucketCountsSchema.optional(),
  }),
  z.strictObject({ type: z.literal(EThreadLiveFrame.Upsert), row: liveThreadRowSchema }),
  z.strictObject({
    type: z.literal(EThreadLiveFrame.Remove),
    sessionId: z.string().min(1),
    threadId: z.string().min(1),
    rev: z.number().int().min(0),
  }),
  z.strictObject({ type: z.literal(EThreadLiveFrame.ProjectUpsert), project: projectSchema }),
  z.strictObject({
    type: z.literal(EThreadLiveFrame.ProjectRemove),
    projectId: z.string().min(1),
  }),
  z.strictObject({ type: z.literal(EThreadLiveFrame.Resync), reason: z.string().min(1) }),
  z.strictObject({ type: z.literal(EThreadLiveFrame.Heartbeat) }),
])
export type ThreadLiveFrame = z.infer<typeof threadLiveFrameSchema>

const isLiveFrames = (value: unknown): value is AsyncIterable<ThreadLiveFrame> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value

export const threadLiveOutputSchema = z.custom<AsyncIterable<ThreadLiveFrame>>(isLiveFrames)

export const sessionPageInputSchema = z.strictObject({
  bucket: z.enum([ESessionBucket.Inactive, ESessionBucket.Archived]),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  search: z.string().max(200).optional(),
})
export type SessionPageInput = z.infer<typeof sessionPageInputSchema>

export const sessionPageOutputSchema = z.strictObject({
  rows: z.array(liveThreadRowSchema),
  counts: sessionBucketCountsSchema,
  next: z.string().min(1).optional(),
})
export type SessionPageOutput = z.infer<typeof sessionPageOutputSchema>
