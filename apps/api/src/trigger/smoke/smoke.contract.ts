import { z } from 'zod'
import type { Task, TaskContract } from '../../_core/ports/job-dispatcher'

export const SMOKE_TASK_ID = 'atlas-smoke'

export const smokePayloadSchema = z.object({})

export type SmokePayload = z.infer<typeof smokePayloadSchema>

export interface SmokeOutput {
  ok: true
  at: string
}

export type SmokeTask = Task<typeof SMOKE_TASK_ID, SmokePayload, SmokeOutput>

export const smokeTaskContract: TaskContract<SmokeTask> = {
  id: SMOKE_TASK_ID,
  schema: smokePayloadSchema,
}
