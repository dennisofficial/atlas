import { z } from 'zod'

import { workspaceFamilySchema, type RestoredFamily } from './family-manifest'

export type { RestoredFamily, WorkspaceFamily, WorkspaceFamilyCapture } from './family-manifest'

export const workspaceTreeSchema = z.object({
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

export const workspaceManifestSchema = z.object({
  version: z.literal(1),
  repository: z.object({
    sourcePath: z.string().min(1),
    originPath: z.string().min(1),
  }).nullable(),
  activeId: z.string().min(1),
  activeRelativePath: z.string().default(''),
  trees: z.array(workspaceTreeSchema).min(1),
  family: workspaceFamilySchema.optional(),
})

export type WorkspaceTree = z.infer<typeof workspaceTreeSchema>
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>

export const workspaceReceiptSchema = z.object({
  version: z.literal(1),
  repositoryOrigin: z.string().min(1),
  trees: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    path: z.string().min(1),
    originPath: z.string().min(1),
    baseline: z.string().min(1),
  })),
})

export type WorkspaceReceipt = z.infer<typeof workspaceReceiptSchema>

export type RestoredTree = {
  id: string
  sourcePath: string
  path: string
  branch: string | null
  renamedFrom: string | null
}

export type RestoredWorkspace = {
  cwd: string
  repository: string | null
  trees: readonly RestoredTree[]
  family?: RestoredFamily | undefined
}
