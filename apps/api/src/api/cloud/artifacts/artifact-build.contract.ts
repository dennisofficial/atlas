import { z } from 'zod'
import type { Task, TaskContract } from '../../../_core/ports/job-dispatcher'

export const ARTIFACT_BUILD_TASK_ID = 'artifact-build'

export const artifactBuildPayloadSchema = z.object({
  artifactId: z.string().min(1),
  version: z.number().int().positive(),
  userId: z.string().min(1),
  threadId: z.string().min(1).optional(),
})

export type ArtifactBuildPayload = z.infer<typeof artifactBuildPayloadSchema>

export enum EArtifactBuildOutcome {
  Building = 'building',
  Ready = 'ready',
  Failed = 'failed',
  Superseded = 'superseded',
}

export type ArtifactBuildTaskOutput = { outcome: EArtifactBuildOutcome }

export type ArtifactBuildTask = Task<
  typeof ARTIFACT_BUILD_TASK_ID,
  ArtifactBuildPayload,
  ArtifactBuildTaskOutput
>

export const artifactBuildTaskContract: TaskContract<ArtifactBuildTask> = {
  id: ARTIFACT_BUILD_TASK_ID,
  schema: artifactBuildPayloadSchema,
}

export const artifactBuildIdempotencyKey = (payload: ArtifactBuildPayload): string =>
  `artifact-build:${payload.artifactId}:${payload.version}`
