import { z } from 'zod'

import { EArtifactBuildOutcome } from './artifact-build-body'
import { noticeStampSchema } from './notice-stamp-schema'

const outcomes = [
  EArtifactBuildOutcome.Ready,
  EArtifactBuildOutcome.Failed,
  EArtifactBuildOutcome.Superseded,
] as const

export const artifactBuildEventSchemas = [
  z.object({
    type: z.literal('artifact-build-event'),
    subdomain: z.string().min(1),
    version: z.number().int().positive(),
    url: z.string().min(1).optional(),
    outcome: z.enum(outcomes),
    failure: z.string().optional(),
    log: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    supersededBy: z.number().int().positive().optional(),
    eventId: z.string().min(1).optional(),
    notice: noticeStampSchema.optional(),
  }),
] as const
