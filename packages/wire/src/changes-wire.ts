import { z } from 'zod'

export enum EChangeScope {
  All = 'all',
  Uncommitted = 'uncommitted',
  LastCommit = 'last-commit',
}

export enum EChangeStatus {
  Added = 'added',
  Modified = 'modified',
  Deleted = 'deleted',
}

export enum EDiffLineKind {
  Add = 'add',
  Remove = 'remove',
  Context = 'context',
}

export const diffLineWireSchema = z.object({
  kind: z.enum(EDiffLineKind),
  text: z.string(),
  oldNumber: z.number().int().positive().optional(),
  newNumber: z.number().int().positive().optional(),
})

export type DiffLineWire = z.infer<typeof diffLineWireSchema>

export const diffHunkWireSchema = z.object({
  header: z.string(),
  lines: z.array(diffLineWireSchema),
})

export type DiffHunkWire = z.infer<typeof diffHunkWireSchema>

export const changedFileWireSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum(EChangeStatus),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  truncated: z.boolean(),
  hunks: z.array(diffHunkWireSchema),
})

export type ChangedFileWire = z.infer<typeof changedFileWireSchema>

export const readGitChangesParamsSchema = z.object({ scope: z.enum(EChangeScope) })
export type ReadGitChangesParams = z.infer<typeof readGitChangesParamsSchema>

export const readGitChangesReplySchema = z.object({
  scope: z.enum(EChangeScope),
  base: z.string().nullable(),
  files: z.array(changedFileWireSchema),
  truncated: z.boolean(),
})

export type ReadGitChangesReply = z.infer<typeof readGitChangesReplySchema>
