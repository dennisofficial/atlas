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

const treeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/)

const unsafeRelativePath = (path: string): boolean =>
  path.startsWith('/') ||
  path.includes('\0') ||
  /^[a-zA-Z]:|\\/.test(path) ||
  path.split('/').some((segment) => segment === '.' || segment === '..' || (segment === '' && path !== ''))

export const workspaceFamilyWireSchema = z.object({
  rootId: z.string().min(1),
  checkouts: z.array(z.object({ id: z.string().min(1), treeId: treeIdSchema, claimedBy: z.string().min(1) })),
  threads: z.array(
    z.object({
      threadId: z.string().min(1),
      home: z.object({
        treeId: treeIdSchema,
        relativePath: z.string().refine((path) => !unsafeRelativePath(path), 'unsafe home path'),
      }),
      active: z.object({ treeId: treeIdSchema, base: z.string().nullable(), adopted: z.boolean() }).nullable(),
    }),
  ),
})

export const restoredFamilyWireSchema = z.object({
  rootId: z.string().min(1),
  checkouts: z.array(z.object({ id: z.string().min(1), path: z.string().min(1), claimedBy: z.string().min(1) })),
  threads: z.array(
    z.object({
      threadId: z.string().min(1),
      home: z.string().min(1),
      active: z
        .object({ path: z.string().min(1), branch: z.string().min(1), base: z.string().nullable(), adopted: z.boolean() })
        .nullable(),
    }),
  ),
})

export const workspaceCleanupWireSchema = z.object({
  generation: z.string().min(1),
  sourceSessionId: z.string(),
  safe: z.boolean(),
  reasons: z.array(z.string()),
})

export const workspaceManifestWireSchema = z.object({
  version: z.literal(1),
  repository: z
    .object({ sourcePath: z.string().min(1), originPath: z.string().min(1) })
    .nullable(),
  activeId: z.string().min(1),
  activeRelativePath: z.string().default(''),
  trees: z.array(workspaceTreeWireSchema).min(1),
  family: workspaceFamilyWireSchema.optional(),
  administrationFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
})

export const prepareWorkspaceArchiveReplySchema = z.object({
  path: z.string().min(1),
  manifest: workspaceManifestWireSchema,
  totalBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  cleanup: workspaceCleanupWireSchema.optional(),
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
  family: restoredFamilyWireSchema.optional(),
})

export const applyWorkspaceArchiveReplySchema = z.object({
  applied: z.boolean(),
  restored: restoredWorkspaceWireSchema,
})

export type WorkspaceFamilyWire = z.infer<typeof workspaceFamilyWireSchema>
export type RestoredFamilyWire = z.infer<typeof restoredFamilyWireSchema>
export type WorkspaceCleanupWire = z.infer<typeof workspaceCleanupWireSchema>
export type WorkspaceManifestWire = z.infer<typeof workspaceManifestWireSchema>
export type PrepareWorkspaceArchiveReply = z.infer<typeof prepareWorkspaceArchiveReplySchema>
export type RestoredWorkspaceWire = z.infer<typeof restoredWorkspaceWireSchema>
export type ApplyWorkspaceArchiveReply = z.infer<typeof applyWorkspaceArchiveReplySchema>

export const activateSessionReplySchema = z.object({ activated: z.boolean() })
export type ActivateSessionReply = z.infer<typeof activateSessionReplySchema>
