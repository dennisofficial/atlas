import { z } from 'zod'

import { EExecutionLocation } from '../execution/location'
import { ETldrStatus } from '../tldr/status'
import {
  EAssistantPlaceholder,
  ECompactionAnchor,
  EDecision,
  ELocationChangeCause,
  EMessageOrigin,
  EOperatorInputOutcome,
  EWorktreeExit,
  type EventBody,
} from './body'
import type { EventEnvelope } from './envelope'
import {
  assistantPartSchema,
  saidFileSchema,
  saidImageSchema,
  saidUploadSchema,
  toolResultPartSchema,
} from './part-schema'
import { agentEventSchemas } from './agent-schema'
import { policyEventSchemas } from './policy-schema'
import { prEventSchemas } from './pr-schema'
import { shellEventSchemas } from './shell-schema'
import { runFailureSchema } from './run-failure'
import { threadIdSchema, callIdSchema, eventIdSchema, runIdSchema } from './ids'
import {
  codeQualityReviewedSchema,
  qualityAssessmentSchema,
  qualityFindingSchema,
  qualityScopeIdentitySchema,
} from '../quality/schema'
import { EQualityReviewStatus, EQualitySkipReason } from '../quality/policy'
import {
  subscriptionChangedSchema,
  subscriptionCreatedSchema,
  subscriptionEndedSchema,
} from '../subscriptions/schema'

export { saidUploadSchema }

export const eventEnvelopeSchema: z.ZodType<EventEnvelope> = z.object({
  id: eventIdSchema,
  seq: z.number().int().positive(),
  threadId: threadIdSchema,
  runId: runIdSchema,
  parentRunId: runIdSchema.optional(),
  depth: z.number().int().nonnegative(),
  at: z.string().min(1),
})

export const eventBodySchema: z.ZodType<EventBody> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user-said'),
    text: z.string(),
    via: z.enum(EMessageOrigin).optional(),
    requestId: z.string().min(1).optional(),
    images: z.array(saidImageSchema).optional(),
    files: z.array(saidFileSchema).optional(),
    uploads: z.array(saidUploadSchema).optional(),
  }),
  z.object({
    type: z.literal('assistant-said'),
    parts: z.array(assistantPartSchema),
    interrupted: z.boolean().optional(),
    placeholder: z.enum(EAssistantPlaceholder).optional(),
  }),
  // Zod 4 requires a z.unknown() key to be present, where Zod 3 inferred it optional. A tool call or
  // result whose input or output is undefined loses the key to JSON.stringify, so both must say .optional()
  // or the stored row stops decoding.
  z.object({
    type: z.literal('tool-called'),
    callId: callIdSchema,
    name: z.string(),
    input: z.unknown().optional(),
    ordinal: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('tool-dispatched'),
    callId: callIdSchema,
    name: z.string(),
  }),
  z.object({
    type: z.literal('tool-result'),
    callId: callIdSchema,
    name: z.string(),
    output: z.unknown().optional(),
    modelText: z.string().optional(),
    modelParts: z.array(toolResultPartSchema).optional(),
    error: z.object({ message: z.string() }).optional(),
    interrupted: z.boolean().optional(),
    qualityReviews: z.array(codeQualityReviewedSchema).optional(),
  }),
  z.object({
    type: z.literal('tool-denied'),
    callId: callIdSchema,
    name: z.string(),
    reason: z.string(),
    interrupted: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('approval-requested'),
    callId: callIdSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('approval-answered'),
    callId: callIdSchema,
    decision: z.enum(EDecision),
    editedInput: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('context-loaded'),
    slot: z.string(),
    key: z.string(),
    content: z.string(),
    triggeredBy: z.string().optional(),
  }),
  z.object({
    type: z.literal('nudge'),
    text: z.string(),
    lifetimeSteps: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('sandbox-setup-reported'),
    text: z.string(),
    failed: z.boolean(),
  }),
  z.object({
    type: z.literal('turn-failed'),
    message: z.string(),
    modelId: z.string().optional(),
    providerId: z.string().optional(),
  }),
  z.object({
    type: z.literal('code-quality-reviewed'),
    callId: callIdSchema,
    workspaceNamespace: z.string().min(1),
    path: z.string().min(1),
    scope: qualityScopeIdentitySchema.optional(),
    beforeHash: z.string().nullable(),
    afterHash: z.string().nullable(),
    status: z.enum(EQualityReviewStatus),
    reason: z.enum(EQualitySkipReason).optional(),
    detail: z.string().optional(),
    assessments: z.array(qualityAssessmentSchema),
    findings: z.array(qualityFindingSchema),
    durationMs: z.number().nonnegative(),
    requestedModel: z.string().min(1).optional(),
    resolvedModel: z.string().min(1).optional(),
    evidencePath: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('loop-watch-verdict'),
    consulted: z.boolean(),
    looping: z.boolean(),
    probability: z.number().min(0).max(1).optional(),
    loopStartSeq: z.number().int().positive().optional(),
    steps: z.number().int().nonnegative(),
    fault: z.string().optional(),
  }),
  z.object({
    type: z.literal('worktree-entered'),
    path: z.string().min(1),
    branch: z.string().min(1),
    base: z.string().min(1).optional(),
    adopted: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('worktree-exited'),
    path: z.string().min(1),
    action: z.enum(EWorktreeExit),
    returnTo: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('location-changed'),
    from: z.enum(EExecutionLocation),
    to: z.enum(EExecutionLocation),
    cwd: z.string().min(1).optional(),
    remoteUrl: z.string().min(1).nullable().optional(),
    branch: z.string().min(1).nullable().optional(),
    cause: z.enum(ELocationChangeCause).optional(),
  }),
  z.object({
    type: z.literal('rotated'),
    predecessor: threadIdSchema,
    handoffPath: z.string().min(1),
    instructions: z.string().optional(),
  }),
  z.object({
    type: z.literal('parked'),
    reason: z.string(),
    turnRunning: z.boolean(),
    childrenRunning: z.number().int().nonnegative(),
    shellsRunning: z.number().int().nonnegative(),
    servicesRunning: z.number().int().nonnegative(),
    clientsAttached: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('operator-input-requested'),
    requestId: z.string().min(1),
    description: z.string(),
    url: z.string().optional(),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal('operator-input-resolved'),
    requestId: z.string().min(1),
    outcome: z.enum(EOperatorInputOutcome),
    bytes: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('directory-changed'),
    path: z.string().min(1),
    repo: z.string().min(1).nullable().optional(),
  }),
  z.object({
    type: z.literal('history-compacted'),
    anchor: z.enum(ECompactionAnchor),
    fromSeq: z.number().int().positive(),
    throughSeq: z.number().int().positive(),
    summary: z.string(),
    replaced: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('permission-revoked'), grantId: z.string().min(1) }),
  z.object({
    type: z.literal('tldr-written'),
    anchorSeq: z.number().int().positive(),
    throughSeq: z.number().int().positive(),
    text: z.string().min(1),
    modelId: z.string().min(1),
    status: z.enum(ETldrStatus).optional(),
  }),
  ...agentEventSchemas,
  ...shellEventSchemas,
  ...prEventSchemas,
  ...policyEventSchemas,
  subscriptionCreatedSchema,
  subscriptionChangedSchema,
  subscriptionEndedSchema,
  z.object({ type: z.literal('run-failed'), failure: runFailureSchema }),
  z.object({
    type: z.literal('run-failure-dismissed'),
    failureSeq: z.number().int().nonnegative(),
  }),
])
