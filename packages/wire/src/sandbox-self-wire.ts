import { z } from 'zod'

export enum ESandboxProvisionState {
  Booting = 'booting',
  Running = 'running',
  NotConfigured = 'not-configured',
}

export enum EVercelCredentialGap {
  UserCredential = 'user-credential',
}

export const sandboxProvisionReplySchema = z.object({
  state: z.enum(ESandboxProvisionState),
  error: z.string().optional(),
  gap: z.enum(EVercelCredentialGap).optional(),
})
export type SandboxProvisionReply = z.infer<typeof sandboxProvisionReplySchema>

export const sandboxExposePortRequestSchema = z.object({
  port: z.number().int().min(1).max(65_535),
})
export type SandboxExposePortRequest = z.infer<typeof sandboxExposePortRequestSchema>

export const sandboxExposePortReplySchema = z.object({
  url: z.string().url(),
  tunnelToken: z.string().min(1),
})
export type SandboxExposePortReply = z.infer<typeof sandboxExposePortReplySchema>

export const sandboxSelfStopRequestSchema = z.object({ sessionId: z.string().min(1).optional() })
export type SandboxSelfStopRequest = z.infer<typeof sandboxSelfStopRequestSchema>

export const sandboxActivityPostSchema = z.object({
  threadId: z.string().min(1).optional(),
  working: z.boolean(),
  awaiting: z.enum(['approval', 'input']).nullable(),
  lastOutcome: z.enum(['completed', 'failed', 'stopped']).nullable().optional(),
  waitingForModel: z.string().min(1).nullable().optional(),
})
export type SandboxActivityPost = z.infer<typeof sandboxActivityPostSchema>

export const sandboxSelfRenewDeadlineRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
  until: z.number().int().nonnegative(),
})
export type SandboxSelfRenewDeadlineRequest = z.infer<typeof sandboxSelfRenewDeadlineRequestSchema>

export const sandboxDeadlineObservationSchema = z.object({
  sessionId: z.string().min(1),
  expiresAt: z.number().int().nullable(),
  startedAt: z.number().int().nullable(),
  extendedByMs: z.number().int().nonnegative(),
})
export type SandboxDeadlineObservation = z.infer<typeof sandboxDeadlineObservationSchema>

export const sandboxRolloverRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
})
export type SandboxRolloverRequest = z.infer<typeof sandboxRolloverRequestSchema>

export const sandboxRolloverReplySchema = z.object({ dispatched: z.boolean() })
export type SandboxRolloverReply = z.infer<typeof sandboxRolloverReplySchema>
