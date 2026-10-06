import { z } from 'zod'

export const WORKSPACE_EXPORT_DIRECTORY_NAME = 'exports'
export const WORKSPACE_EXPORT_FILE_PATTERN = /^workspace-[A-Za-z0-9_-]+\.tar\.gz$/

export const workspaceTreeWireSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  sourcePath: z.string().min(1),
  originPath: z.string().min(1),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  baseline: z.string().nullable(),
  fingerprint: z.string().min(1),
  isMain: z.boolean(),
})

export const workspaceManifestWireSchema = z.object({
  version: z.literal(1),
  repository: z
    .object({ sourcePath: z.string().min(1), originPath: z.string().min(1) })
    .nullable(),
  activeId: z.string().min(1),
  activeRelativePath: z.string().default(''),
  trees: z.array(workspaceTreeWireSchema).min(1),
})

export const prepareWorkspaceArchiveReplySchema = z.object({
  path: z.string().min(1),
  manifest: workspaceManifestWireSchema,
  totalBytes: z.number().int().nonnegative().optional(),
})

export const restoredWorkspaceWireSchema = z.object({
  cwd: z.string().min(1),
  repository: z.string().nullable(),
  trees: z.array(
    z.object({
      id: z.string().min(1),
      sourcePath: z.string().min(1),
      path: z.string().min(1),
      branch: z.string().nullable(),
      renamedFrom: z.string().nullable(),
    }),
  ),
})

export const applyWorkspaceArchiveReplySchema = z.object({
  applied: z.boolean(),
  restored: restoredWorkspaceWireSchema,
})

export type WorkspaceManifestWire = z.infer<typeof workspaceManifestWireSchema>
export type PrepareWorkspaceArchiveReply = z.infer<typeof prepareWorkspaceArchiveReplySchema>
export type RestoredWorkspaceWire = z.infer<typeof restoredWorkspaceWireSchema>
export type ApplyWorkspaceArchiveReply = z.infer<typeof applyWorkspaceArchiveReplySchema>

export const activateSessionReplySchema = z.object({ activated: z.boolean() })
export type ActivateSessionReply = z.infer<typeof activateSessionReplySchema>
