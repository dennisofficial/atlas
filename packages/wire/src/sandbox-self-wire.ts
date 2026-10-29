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
