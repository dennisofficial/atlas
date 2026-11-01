import { z } from 'zod'
import type { Task, TaskContract } from '../../../_core/ports/job-dispatcher'

export const POD_PROVISION_TASK_ID = 'pod-provision'

export const podProvisionPayloadSchema = z.object({
  threadId: z.string().min(1),
  wakeClaim: z.iso.datetime(),
  stopSessionId: z.string().min(1).optional(),
})

export type PodProvisionPayload = z.infer<typeof podProvisionPayloadSchema>

export enum EPodProvisionOutcome {
  Running = 'running',
  Failed = 'failed',
  Superseded = 'superseded',
}

export type PodProvisionOutput = { outcome: EPodProvisionOutcome }

export type PodProvisionTask = Task<
  typeof POD_PROVISION_TASK_ID,
  PodProvisionPayload,
  PodProvisionOutput
>

export const podProvisionTaskContract: TaskContract<PodProvisionTask> = {
  id: POD_PROVISION_TASK_ID,
  schema: podProvisionPayloadSchema,
}

export const podProvisionIdempotencyKey = (payload: PodProvisionPayload): string =>
  `pod-provision:${payload.threadId}:${payload.wakeClaim}`
