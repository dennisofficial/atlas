import { z } from 'zod'

export enum ESandboxLifecycleState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
}

export const sandboxThreadInputSchema = z.strictObject({ threadId: z.string().min(1) })
export type SandboxThreadInput = z.infer<typeof sandboxThreadInputSchema>

export const registerSandboxMetadataSchema = z.strictObject({
  title: z.string().optional(),
  repo: z.string().optional(),
  model: z.string().optional(),
})
export type RegisterSandboxMetadata = z.infer<typeof registerSandboxMetadataSchema>

export const claimWorkspaceSpecSchema = z.strictObject({ remoteUrl: z.string().nullable() })
export type ClaimWorkspaceSpec = z.infer<typeof claimWorkspaceSpecSchema>

export const claimSandboxInputSchema = z.strictObject({
  threadId: z.string().min(1),
  clientToken: z.string().min(64).optional(),
  serveUrl: z.string().optional(),
  serveVersion: z.string().optional(),
  metadata: registerSandboxMetadataSchema.optional(),
  workspace: claimWorkspaceSpecSchema.optional(),
  gitToken: z.string().optional(),
  driveName: z.string().min(1).nullable().optional(),
  contextPending: z.boolean().optional(),
})
export type ClaimSandboxInput = z.infer<typeof claimSandboxInputSchema>

export const sandboxListEntrySchema = z.object({
  threadId: z.string(),
  name: z.string(),
  state: z.enum(ESandboxLifecycleState),
  lastActivityAt: z.string(),
})
export type SandboxListEntry = z.infer<typeof sandboxListEntrySchema>

export const sandboxAttachmentSchema = z.object({
  threadId: z.string(),
  name: z.string(),
  region: z.string(),
  state: z.enum(ESandboxLifecycleState),
  lastActivityAt: z.string(),
  contextPending: z.boolean(),
  url: z.string().optional(),
  token: z.string(),
})
export type SandboxAttachment = z.infer<typeof sandboxAttachmentSchema>
