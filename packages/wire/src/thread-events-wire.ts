import { z } from 'zod'
import { wireEventSchema } from './session-wire'
import type { ThreadStreamFrame } from './thread-routes-wire'

export const threadEventsLiveInputSchema = z.strictObject({
  threadId: z.string().min(1),
  lastEventId: z.string().optional(),
})
export type ThreadEventsLiveInput = z.infer<typeof threadEventsLiveInputSchema>

export type ThreadEventsLiveFrame = { id: string; data: ThreadStreamFrame }

export const threadEventsLiveOutputSchema = z.custom<AsyncIterable<ThreadEventsLiveFrame>>(
  (value) => typeof value === 'object' && value !== null && Symbol.asyncIterator in value,
)

export const threadEventsSnapshotInputSchema = z.strictObject({
  threadId: z.string().min(1),
  fromSeq: z.number().int().nonnegative().optional(),
})
export type ThreadEventsSnapshotInput = z.infer<typeof threadEventsSnapshotInputSchema>

export const threadEventsSnapshotOutputSchema = z.strictObject({
  events: z.array(wireEventSchema),
  historyRev: z.number().int().nonnegative(),
  head: z.number().int().nonnegative(),
})
export type ThreadEventsSnapshot = z.infer<typeof threadEventsSnapshotOutputSchema>
